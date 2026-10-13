/**
 * Account management for administrators (`users:manage`).
 *
 * Accounts are never self-registered. An administrator creates the account
 * for an existing student / teacher / guardian record; the server reserves a
 * Login ID (generated, or the admin's choice — normalised and unique), creates
 * the Convex Auth password account with a random TEMPORARY password, and
 * returns that password exactly once so it can be handed to the person.
 * Temporary passwords are never stored in plain text and the person is asked
 * to change it after signing in (`users.mustChangePassword`).
 *
 * Every function authorizes on the server through `requireActor` +
 * `requirePermission`; actions do so inside internal mutations/queries, which
 * run with the caller's identity. Records of another school are NOT_FOUND.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type ActionCtx, type QueryCtx } from "./_generated/server";
import { schoolAction, schoolQuery } from "./core/functions";
import { requireActor, type Actor } from "./core/actor";
import { getCurrentAcademicYearId, getInSchool, requirePermission } from "./core/authorization";
import { forbidden, invalid } from "./core/errors";
import { fullName, teacherDisplayName } from "./model/academics";
import { generateTemporaryPassword, PASSWORD_PROVIDER, provisionAccount, reserveAccount, temporaryPasswordFields } from "./model/accounts";
import { accountTarget, writeAudit } from "./model/audit";

const vPersonRef = v.union(
  v.object({ kind: v.literal("student"), studentId: v.id("students") }),
  v.object({ kind: v.literal("teacher"), teacherId: v.id("teachers") }),
  v.object({ kind: v.literal("guardian"), guardianId: v.id("guardians") }),
);

type AccountState = "pending" | "active" | "suspended";
const accountState = (m: Doc<"schoolMemberships">): AccountState =>
  m.status === "invited" ? "pending" : m.status === "suspended" ? "suspended" : "active";

/** Year used in generated student Login IDs: admission year, else the current academic year's start. */
async function studentIdYear(ctx: QueryCtx, actor: Actor, student: Doc<"students">): Promise<string> {
  if (student.admissionDate) return student.admissionDate.slice(0, 4);
  const year = await ctx.db.get(await getCurrentAcademicYearId(ctx, actor.schoolId));
  return year?.startDate.slice(0, 4) ?? new Date().toISOString().slice(0, 4);
}

// ================================================================ internal (authorize + DB work)

export const reserveForPerson = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), person: vPersonRef, loginId: v.optional(v.string()) },
  handler: async (ctx, { callerMembershipId, person, loginId }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requirePermission(actor, "users:manage");
    const scoped = { ...ctx, actor };
    const base = { schoolId: actor.schoolId, loginId, createdByUserId: actor.userId };
    let reserved: { membershipId: Id<"schoolMemberships">; loginId: string };
    let displayName: string;
    if (person.kind === "student") {
      const s = await getInSchool(scoped, "students", person.studentId, "Student");
      displayName = fullName(s);
      reserved = await reserveAccount(ctx, { ...base, role: "student", kind: "student", year: await studentIdYear(ctx, actor, s), displayName, email: s.email, studentId: s._id });
    } else if (person.kind === "teacher") {
      const t = await getInSchool(scoped, "teachers", person.teacherId, "Teacher");
      displayName = `${t.firstName} ${t.lastName}`;
      reserved = await reserveAccount(ctx, { ...base, role: "teacher", kind: "teacher", displayName, email: t.email, teacherId: t._id });
    } else {
      const g = await getInSchool(scoped, "guardians", person.guardianId, "Guardian");
      displayName = g.name;
      reserved = await reserveAccount(ctx, { ...base, role: "student", kind: "guardian", displayName, email: g.email, guardianId: g._id });
    }
    return { ...reserved, displayName };
  },
});

/** Authorize a credential operation on an existing account of the caller's school. */
export const targetForCredentials = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), targetMembershipId: v.id("schoolMemberships") },
  handler: async (ctx, { callerMembershipId, targetMembershipId }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requirePermission(actor, "users:manage");
    const target = await getInSchool({ ...ctx, actor }, "schoolMemberships", targetMembershipId, "Account");
    if (target._id === actor.membershipId) throw forbidden("Use “Change password” on your profile for your own account.");
    if (target.status === "suspended") throw invalid("Enable this account before issuing new credentials.");
    if (!target.loginId) throw invalid("This account has no Login ID.");
    return { loginId: target.loginId, userId: target.userId ?? null, displayName: target.displayName };
  },
});

export const recordCredentialsIssued = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), targetMembershipId: v.id("schoolMemberships"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { callerMembershipId, targetMembershipId, userId }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requirePermission(actor, "users:manage");
    const target = await getInSchool({ ...ctx, actor }, "schoolMemberships", targetMembershipId, "Account");
    if (userId) await ctx.db.patch(userId, temporaryPasswordFields(Date.now()));
    await writeAudit(ctx, {
      schoolId: actor.schoolId, actor, action: "account.credentials_issued",
      entity: { table: "schoolMemberships", id: target._id },
      summary: `Issued a temporary password for ${target.loginId} (${target.displayName})`,
      metadata: accountTarget(target),
    });
  },
});

export const applyStatus = internalMutation({
  args: {
    callerMembershipId: v.optional(v.id("schoolMemberships")),
    targetMembershipId: v.id("schoolMemberships"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  handler: async (ctx, { callerMembershipId, targetMembershipId, status }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requirePermission(actor, "users:manage");
    const target = await getInSchool({ ...ctx, actor }, "schoolMemberships", targetMembershipId, "Account");
    if (target._id === actor.membershipId) throw forbidden("You cannot disable your own account.");
    if (target.status === "invited") throw invalid("This account has no credentials yet. Issue a temporary password first.");
    if (target.status !== status) {
      await ctx.db.patch(target._id, { status });
      await writeAudit(ctx, {
        schoolId: actor.schoolId, actor, action: status === "suspended" ? "account.disabled" : "account.enabled",
        entity: { table: "schoolMemberships", id: target._id },
        summary: `${status === "suspended" ? "Disabled" : "Enabled"} account ${target.loginId ?? ""} (${target.displayName})`,
        metadata: accountTarget(target),
      });
    }
    return { userId: target.userId ?? null };
  },
});

/** Sign a user out everywhere (scheduled by mutations that suspend access). */
export const revokeSessions = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await invalidateSessions(ctx, { userId });
  },
});

// ================================================================ public actions

type IssuedCredentials = { membershipId: Id<"schoolMemberships">; loginId: string; displayName: string; temporaryPassword: string };

/**
 * Create the sign-in account for a student, teacher or guardian record.
 * Returns the Login ID and a one-time temporary password.
 */
export const create = schoolAction({
  args: { person: vPersonRef, loginId: v.optional(v.string()) },
  handler: async (ctx, { person, loginId }): Promise<IssuedCredentials> => {
    const reserved: { membershipId: Id<"schoolMemberships">; loginId: string; displayName: string } =
      await ctx.runMutation(internal.accounts.reserveForPerson, { callerMembershipId: ctx.membershipId, person, loginId });
    const temporaryPassword = generateTemporaryPassword();
    await provisionAccount(ctx, { loginId: reserved.loginId, password: temporaryPassword, mustChangePassword: true });
    return { ...reserved, temporaryPassword };
  },
});

/**
 * Issue a new temporary password (reset), or finish creating an account whose
 * credentials were never issued (e.g. after an import). Signs out every
 * existing session of that account.
 */
export const issueTemporaryPassword = schoolAction({
  args: { targetMembershipId: v.id("schoolMemberships") },
  handler: async (ctx, { targetMembershipId }): Promise<IssuedCredentials> => {
    return await issueFor(ctx, ctx.membershipId, targetMembershipId);
  },
});

/** Issue credentials for many pending accounts (after an import). Max 50 per call. */
export const issuePendingCredentials = schoolAction({
  args: { targetMembershipIds: v.array(v.id("schoolMemberships")) },
  handler: async (ctx, { targetMembershipIds }) => {
    if (targetMembershipIds.length > 50) throw invalid("Issue credentials for at most 50 accounts at a time.");
    const results: ({ ok: true } & IssuedCredentials | { ok: false; membershipId: Id<"schoolMemberships">; error: string })[] = [];
    for (const id of targetMembershipIds) {
      try {
        results.push({ ok: true, ...(await issueFor(ctx, ctx.membershipId, id)) });
      } catch (e) {
        const data = (e as { data?: { message?: string } }).data;
        results.push({ ok: false, membershipId: id, error: data?.message ?? "Could not issue credentials." });
      }
    }
    return results;
  },
});

async function issueFor(
  ctx: ActionCtx,
  callerMembershipId: Id<"schoolMemberships"> | undefined,
  targetMembershipId: Id<"schoolMemberships">,
): Promise<IssuedCredentials> {
  const target: { loginId: string; userId: Id<"users"> | null; displayName: string } =
    await ctx.runMutation(internal.accounts.targetForCredentials, { callerMembershipId, targetMembershipId });
  const temporaryPassword = generateTemporaryPassword();
  if (target.userId) {
    // Flag first: if a later step fails, the account is still forced to change
    // its password rather than holding a new password that is not temporary.
    await ctx.runMutation(internal.accounts.recordCredentialsIssued, { callerMembershipId, targetMembershipId, userId: target.userId });
    await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id: target.loginId, secret: temporaryPassword } });
    await invalidateSessions(ctx, { userId: target.userId });
  } else {
    await provisionAccount(ctx, { loginId: target.loginId, password: temporaryPassword, mustChangePassword: true });
    await ctx.runMutation(internal.accounts.recordCredentialsIssued, { callerMembershipId, targetMembershipId });
  }
  return { membershipId: targetMembershipId, loginId: target.loginId, displayName: target.displayName, temporaryPassword };
}

/** Disable (suspend) or re-enable an account. Disabling signs it out everywhere immediately. */
export const setStatus = schoolAction({
  args: { targetMembershipId: v.id("schoolMemberships"), status: v.union(v.literal("active"), v.literal("suspended")) },
  handler: async (ctx, { targetMembershipId, status }) => {
    const { userId }: { userId: Id<"users"> | null } = await ctx.runMutation(internal.accounts.applyStatus, {
      callerMembershipId: ctx.membershipId, targetMembershipId, status,
    });
    if (status === "suspended" && userId) await invalidateSessions(ctx, { userId });
    return { ok: true as const };
  },
});

// ================================================================ queries

async function accountFor(ctx: QueryCtx, actor: Actor, field: "studentId" | "teacherId", id: Id<"students"> | Id<"teachers">) {
  const rows = field === "studentId"
    ? await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", id as Id<"students">)).collect()
    : await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", id as Id<"teachers">)).collect();
  const m = rows.find((r) => r.schoolId === actor.schoolId && r.role === (field === "studentId" ? "student" : "teacher"));
  return m ? { membershipId: m._id, loginId: m.loginId ?? null, state: accountState(m) } : null;
}

/**
 * Students or teachers of the caller's school with their account state
 * (paginated). Students can be narrowed to one section (current roster, in
 * roll-number order); `rollNo` is the system-assigned roll number.
 */
export const listPeople = schoolQuery({
  args: { kind: v.union(v.literal("student"), v.literal("teacher")), sectionId: v.optional(v.id("sections")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { kind, sectionId, paginationOpts }) => {
    const { actor } = ctx;
    requirePermission(actor, "users:manage");
    if (kind === "student") {
      const yearId = await getCurrentAcademicYearId(ctx, actor.schoolId);
      const row = async (s: Doc<"students">) => {
        const enr = (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", s._id).eq("academicYearId", yearId)).collect()).find((e) => e.status === "active");
        const section = enr ? await ctx.db.get(enr.sectionId) : null;
        return {
          personId: s._id as string, name: fullName(s), number: s.admissionNo, detail: section ? `Class ${section.displayName}` : "Not enrolled",
          rollNo: enr?.rollNo ?? null,
          account: await accountFor(ctx, actor, "studentId", s._id),
        };
      };
      if (sectionId) {
        await getInSchool({ ...ctx, actor }, "sections", sectionId, "Section");
        const result = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).paginate(paginationOpts);
        const page = [];
        for (const e of result.page) {
          const s = await ctx.db.get(e.studentId);
          if (s && s.schoolId === actor.schoolId && s.status === "active") page.push(await row(s));
        }
        return { ...result, page };
      }
      const result = await ctx.db.query("students")
        .withIndex("by_school_status_name", (q) => q.eq("schoolId", actor.schoolId).eq("status", "active"))
        .paginate(paginationOpts);
      const page = [];
      for (const s of result.page) page.push(await row(s));
      return { ...result, page };
    }
    const result = await ctx.db.query("teachers")
      .withIndex("by_school_status", (q) => q.eq("schoolId", actor.schoolId).eq("status", "active"))
      .paginate(paginationOpts);
    const page = [];
    for (const t of result.page) {
      page.push({
        personId: t._id as string, name: teacherDisplayName(t), number: t.employeeId, detail: t.designation ?? "Teacher", rollNo: null,
        account: await accountFor(ctx, actor, "teacherId", t._id),
      });
    }
    return { ...result, page };
  },
});
