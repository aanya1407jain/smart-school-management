/**
 * One-off OPERATOR migration (internal: never callable from the browser):
 * existing STUDENT accounts move to the new sign-in rule — Login ID = scholar
 * number, password reset to a random TEMPORARY password per student (SEC-01:
 * no shared default), which must be changed at first sign-in. The temporary
 * passwords are returned ONCE in the result (`credentials`) for the operator to
 * hand over privately; they are never stored. Sessions are signed out.
 *
 *   npx convex run studentLoginMigration:run '{"dryRun":true}'
 *   npx convex run studentLoginMigration:run '{}'
 *
 * Skipped (and listed): accounts already on their scholar number, students
 * without a usable scholar number, scholar numbers already used as another
 * Login ID, and the seeded DEMO personas (development fixtures documented on
 * the login screen; pass includeDemo: true to convert them too). Safe to
 * re-run: converted accounts are skipped the second time.
 */
import { v } from "convex/values";
import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { conflict, notFound } from "./core/errors";
import { PASSWORD_PROVIDER, generateSecurePassword, isLoginIdTaken, passwordIssuedFields, renameLoginId } from "./model/accounts";
import { canonicalLoginId } from "./model/loginIds";
import { accountTarget, writeAudit } from "./model/audit";
import { DEMO_STUDENT_LOGIN_IDS } from "./demo.generated";

/** Student logins created by the demo seed (README / login-screen helper, used by the E2E suite): development fixtures. */
const DEMO_STUDENT_LOGINS = new Set(DEMO_STUDENT_LOGIN_IDS);

async function schoolBySlugOrOnly(ctx: QueryCtx, schoolSlug: string | undefined) {
  if (schoolSlug !== undefined) {
    const s = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug.trim().toLowerCase())).first();
    if (!s) throw notFound("School");
    return s;
  }
  const schools = await ctx.db.query("schools").take(2);
  if (schools.length === 0) throw notFound("School");
  if (schools.length > 1) throw conflict("This deployment has more than one school; pass schoolSlug.");
  return schools[0];
}

type Planned = { membershipId: Id<"schoolMemberships">; userId: Id<"users"> | null; name: string; from: string; to: string };
type Skipped = { name: string; loginId: string | null; reason: string };

/** What the migration would do (read-only). */
export const plan = internalQuery({
  args: { schoolSlug: v.optional(v.string()), includeDemo: v.optional(v.boolean()) },
  handler: async (ctx, { schoolSlug, includeDemo }): Promise<{ school: string; convert: Planned[]; skipped: Skipped[] }> => {
    const school = await schoolBySlugOrOnly(ctx, schoolSlug);
    const members = await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", school._id).eq("role", "student")).collect();
    const convert: Planned[] = [];
    const skipped: Skipped[] = [];
    const targets = new Set<string>();
    for (const m of members) {
      if (!m.studentId || !m.loginId) continue;
      const student = await ctx.db.get(m.studentId);
      const name = m.displayName;
      if (!includeDemo && DEMO_STUDENT_LOGINS.has(m.loginId)) { skipped.push({ name, loginId: m.loginId, reason: "Demo persona (development login)" }); continue; }
      const to = student?.scholarNoKey ? canonicalLoginId(student.scholarNoKey) : null;
      if (!to) { skipped.push({ name, loginId: m.loginId, reason: student?.scholarNo ? `Scholar number ${student.scholarNo} cannot be a Login ID` : "No scholar number" }); continue; }
      if (to === m.loginId) continue; // already converted
      if (targets.has(to) || (await isLoginIdTaken(ctx, to))) { skipped.push({ name, loginId: m.loginId, reason: `Login ID ${to} is already in use` }); continue; }
      targets.add(to);
      convert.push({ membershipId: m._id, userId: m.userId ?? null, name, from: m.loginId, to });
    }
    return { school: school.slug, convert, skipped };
  },
});

/** Rename one account to its scholar number and flag the temporary password (it is set right after, in the action). */
export const convertOne = internalMutation({
  args: { membershipId: v.id("schoolMemberships"), to: v.string() },
  handler: async (ctx, { membershipId, to }) => {
    const m = await ctx.db.get(membershipId);
    if (!m || m.role !== "student" || !m.loginId) throw notFound("Student account");
    const from = m.loginId;
    await renameLoginId(ctx, m, to);
    if (m.userId) await ctx.db.patch(m.userId, passwordIssuedFields({ requiresPasswordChange: true }));
    await writeAudit(ctx, {
      schoolId: m.schoolId, action: "account.login_id_changed", entity: { table: "schoolMemberships", id: m._id },
      summary: `Student login ${from} → ${to} (scholar number); password reset to a temporary password`,
      metadata: { ...accountTarget({ ...m, loginId: to }), from, to, passwordReset: !!m.userId },
    });
  },
});

/** Run (or with dryRun preview) the migration for one school. */
export const run = internalAction({
  args: { schoolSlug: v.optional(v.string()), dryRun: v.optional(v.boolean()), includeDemo: v.optional(v.boolean()) },
  handler: async (ctx, { schoolSlug, dryRun, includeDemo }) => {
    const p: { school: string; convert: Planned[]; skipped: Skipped[] } = await ctx.runQuery(internal.studentLoginMigration.plan, { schoolSlug, includeDemo });
    const failed: { name: string; from: string; reason: string }[] = [];
    const credentials: { name: string; loginId: string; temporaryPassword: string }[] = [];
    let converted = 0;
    if (!dryRun) {
      for (const item of p.convert) {
        try {
          await ctx.runMutation(internal.studentLoginMigration.convertOne, { membershipId: item.membershipId, to: item.to });
          if (item.userId) {
            const temporaryPassword = generateSecurePassword();
            await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id: item.to, secret: temporaryPassword } });
            await invalidateSessions(ctx, { userId: item.userId });
            credentials.push({ name: item.name, loginId: item.to, temporaryPassword });
          }
          converted++;
        } catch (e) {
          failed.push({ name: item.name, from: item.from, reason: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return {
      school: p.school, dryRun: !!dryRun,
      toConvert: p.convert.length, converted, failed,
      /** Shown once: hand each password over privately (it must be changed at first sign-in). */
      credentials,
      sample: p.convert.slice(0, 10).map(({ name, from, to }) => ({ name, from, to })),
      skipped: p.skipped,
    };
  },
});
