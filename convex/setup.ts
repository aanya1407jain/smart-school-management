/**
 * Deployment setup — how a real school is onboarded onto its own deployment.
 *
 * Each client school gets its own customised deployment of the base product.
 * These are INTERNAL functions: they cannot be called from the browser, only
 * by whoever operates the deployment (Convex dashboard or CLI), e.g.
 *
 *   npx convex run setup:initSchool '{
 *     "school": { "name": "Green Valley School", "shortName": "Green Valley", "code": "GVS",
 *                 "slug": "green-valley", "timezone": "Asia/Kolkata", "locale": "en-IN", "currency": "INR" },
 *     "academicYear": { "name": "2026-27", "startDate": "2026-04-01", "endDate": "2027-03-31" },
 *     "admin": { "displayName": "Principal" }
 *   }'
 *
 * Optional `"modules": ["students", "academics", ...]` writes the school's
 * module entitlements in the same transaction (convex/core/modules.ts); without
 * it the school is unconfigured and keeps every original module. They can be
 * changed later with `schoolModules:setSchoolModules`.
 *
 * → returns the first administrator's Login ID (ADMIN-001 unless given) and a
 *   one-time temporary password. Everything else (classes, sections,
 *   subjects, teachers, students, accounts) is then done by that admin in the
 *   app — manually or by import. Nothing here depends on demo data; the demo
 *   seed (convex/seed.ts) is a separate, development-only path.
 *
 * Break-glass (operator only): `setup:addAdministrator` and
 * `setup:issueTemporaryPassword` (e.g. the only admin forgot their password).
 */
import { v } from "convex/values";
import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { conflict, invalid, notFound } from "./core/errors";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { generateTemporaryPassword, PASSWORD_PROVIDER, provisionAccount, reserveAccount, temporaryPasswordFields } from "./model/accounts";
import { canonicalLoginId } from "./model/loginIds";
import { vModuleKey } from "./core/modules";
import { applyModuleSelection } from "./model/modules";

const vSchoolInput = v.object({
  name: v.string(),
  shortName: v.string(),
  /** Short uppercase prefix for generated numbers (admission, employee, receipt), e.g. "GVS". */
  code: v.string(),
  slug: v.string(),
  timezone: v.string(),
  locale: v.string(),
  currency: v.string(),
  tagline: v.optional(v.string()),
  address: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  website: v.optional(v.string()),
  affiliation: v.optional(v.string()),
});

const vSettingsInput = v.optional(v.object({
  workingDays: v.optional(v.array(v.number())),
  lateCountsAsPresent: v.optional(v.boolean()),
  lowAttendanceThreshold: v.optional(v.number()),
  gradingScheme: v.optional(v.string()),
  passPercentage: v.optional(v.number()),
}));

const vAdminInput = v.object({ displayName: v.string(), loginId: v.optional(v.string()), email: v.optional(v.string()) });

async function onlySchoolId(ctx: MutationCtx): Promise<Id<"schools">> {
  const schools = await ctx.db.query("schools").take(2);
  if (schools.length === 0) throw notFound("School (run setup:initSchool first)");
  if (schools.length > 1) throw conflict("This deployment has more than one school; pass a schoolId.");
  return schools[0]._id;
}

const vModulesInput = v.optional(v.array(vModuleKey));

export const createSchoolAndAdmin = internalMutation({
  args: { school: vSchoolInput, academicYear: v.object({ name: v.string(), startDate: v.string(), endDate: v.string() }), settings: vSettingsInput, admin: vAdminInput, modules: vModulesInput },
  handler: async (ctx, { school, academicYear, settings, admin, modules }) => {
    if (await ctx.db.query("schools").first()) {
      throw conflict("This deployment already has a school. Setup can only run once per deployment.");
    }
    const code = school.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(code)) throw invalid("School code must be 1–8 letters or digits.", { code: "Invalid code" });
    const slug = school.slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw invalid("Slug must be lowercase letters, digits and dashes.", { slug: "Invalid slug" });
    assertIsoDate(academicYear.startDate, "startDate");
    assertIsoDate(academicYear.endDate, "endDate");
    if (academicYear.endDate <= academicYear.startDate) throw invalid("The academic year must end after it starts.");

    const schoolId = await ctx.db.insert("schools", {
      ...school,
      name: assertNonEmpty(school.name, "name", 160),
      shortName: assertNonEmpty(school.shortName, "shortName", 60),
      code, slug, status: "active",
    });
    const yearId = await ctx.db.insert("academicYears", { schoolId, name: assertNonEmpty(academicYear.name, "academicYear.name", 40), startDate: academicYear.startDate, endDate: academicYear.endDate, status: "active" });
    await ctx.db.insert("schoolSettings", {
      schoolId,
      currentAcademicYearId: yearId,
      workingDays: settings?.workingDays ?? [1, 2, 3, 4, 5, 6],
      attendance: { lateCountsAsPresent: settings?.lateCountsAsPresent ?? true, lowAttendanceThreshold: settings?.lowAttendanceThreshold ?? 75 },
      grading: { scheme: settings?.gradingScheme ?? "percentage", passPercentage: settings?.passPercentage ?? 33 },
      notifications: { attendanceAlerts: true, feeReminders: true, homeworkAlerts: true, examAlerts: true, noticeAlerts: true },
    });
    if (modules !== undefined) {
      await applyModuleSelection(ctx, { schoolId, enabled: modules, updatedBy: "setup:initSchool", reason: "Initial school setup" });
    }
    const reserved = await reserveAccount(ctx, {
      schoolId, role: "admin", kind: "admin", displayName: assertNonEmpty(admin.displayName, "admin.displayName", 120),
      loginId: admin.loginId, email: admin.email,
    });
    return { schoolId, ...reserved };
  },
});

export const initSchool = internalAction({
  args: { school: vSchoolInput, academicYear: v.object({ name: v.string(), startDate: v.string(), endDate: v.string() }), settings: vSettingsInput, admin: vAdminInput, modules: vModulesInput },
  handler: async (ctx, args): Promise<{ schoolId: Id<"schools">; adminLoginId: string; temporaryPassword: string }> => {
    const { schoolId, loginId }: { schoolId: Id<"schools">; loginId: string } = await ctx.runMutation(internal.setup.createSchoolAndAdmin, args);
    const temporaryPassword = generateTemporaryPassword();
    await provisionAccount(ctx, { loginId, password: temporaryPassword, mustChangePassword: true });
    return { schoolId, adminLoginId: loginId, temporaryPassword };
  },
});

export const reserveAdministrator = internalMutation({
  args: { admin: vAdminInput },
  handler: async (ctx, { admin }) => {
    const schoolId = await onlySchoolId(ctx);
    return await reserveAccount(ctx, {
      schoolId, role: "admin", kind: "admin", displayName: assertNonEmpty(admin.displayName, "admin.displayName", 120),
      loginId: admin.loginId, email: admin.email,
    });
  },
});

/** Operator: add another administrator account. */
export const addAdministrator = internalAction({
  args: { admin: vAdminInput },
  handler: async (ctx, { admin }): Promise<{ loginId: string; temporaryPassword: string }> => {
    const { loginId }: { loginId: string } = await ctx.runMutation(internal.setup.reserveAdministrator, { admin });
    const temporaryPassword = generateTemporaryPassword();
    await provisionAccount(ctx, { loginId, password: temporaryPassword, mustChangePassword: true });
    return { loginId, temporaryPassword };
  },
});

export const userForLoginId = internalMutation({
  args: { loginId: v.string() },
  handler: async (ctx, { loginId }) => {
    const id = canonicalLoginId(loginId);
    if (!id) throw invalid("Invalid Login ID.");
    const user = await ctx.db.query("users").withIndex("by_login_id", (q) => q.eq("loginId", id)).first();
    if (!user) throw notFound("Account");
    await ctx.db.patch(user._id, temporaryPasswordFields(Date.now()));
    return { userId: user._id, loginId: id };
  },
});

/** Operator break-glass: new temporary password for any account (signs it out everywhere). */
export const issueTemporaryPassword = internalAction({
  args: { loginId: v.string() },
  handler: async (ctx, { loginId }): Promise<{ loginId: string; temporaryPassword: string }> => {
    const { userId, loginId: id }: { userId: Id<"users">; loginId: string } = await ctx.runMutation(internal.setup.userForLoginId, { loginId });
    const temporaryPassword = generateTemporaryPassword();
    await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id, secret: temporaryPassword } });
    await invalidateSessions(ctx, { userId });
    return { loginId: id, temporaryPassword };
  },
});
