/**
 * Account management for administrators (`users:manage`).
 *
 * Accounts are never self-registered. An administrator creates the account
 * for an existing student or teacher record (or an office/admin login); the server reserves a
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
import { getCurrentAcademicYearId, getInSchool, hasPermission, requirePermission } from "./core/authorization";
import { AppError, forbidden, invalid } from "./core/errors";
import { assertNonEmpty } from "./core/validators";
import { describeAccess } from "./core/grants";
import { fullName, teacherDisplayName } from "./model/academics";
import { generateTemporaryPassword, PASSWORD_PROVIDER, provisionAccount, reserveAccount, temporaryPasswordFields } from "./model/accounts";
import { accountTarget, writeAudit } from "./model/audit";
import { MAX_SECTION_ROSTER } from "./model/rollNumbers";
import { paginateSorted, sortKeyOf } from "./model/sortedPagination";

const vPersonRef = v.union(
  v.object({ kind: v.literal("student"), studentId: v.id("students") }),
  v.object({ kind: v.literal("teacher"), teacherId: v.id("teachers") }),
  /**
   * Office staff with an ADMIN-portal login that is not linked to a teacher
   * record (e.g. a second administrator, or the accountant). `accountantOnly`
   * restricts it to the finance permission set (core/permissions.ts).
   */
  v.object({ kind: v.literal("staff"), displayName: v.string(), email: v.optional(v.string()), accountantOnly: v.boolean() }),
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
      displayName = assertNonEmpty(person.displayName, "displayName", 120);
      const email = person.email?.trim() ? assertNonEmpty(person.email, "email", 200) : undefined;
      reserved = await reserveAccount(ctx, { ...base, role: "admin", kind: "admin", displayName, email, permissionSets: person.accountantOnly ? ["accountant"] : [] });
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
    if (target.guardianId) throw invalid("This sign-in type no longer exists; accounts are for administrators, teachers and students only.");
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
    if (target.guardianId) throw invalid("This sign-in type no longer exists; accounts are for administrators, teachers and students only.");
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
 * Create the sign-in account for a student or teacher record, or an office
 * (admin-portal) login. Admin, teacher and student are the only account roles.
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

/** Largest active-student list sorted for the all-students view (one bounded read; filter by section above this). */
export const MAX_SCHOOL_STUDENT_LIST = 5000;

/**
 * Students or teachers of the caller's school with their account state
 * (paginated). `rollNo` is the stored, system-assigned roll number.
 *
 * Students are listed in the documented roster order (model/rollNumbers.ts):
 * first name, then last name — case-, accent- and whitespace-insensitive —
 * then student id (and enrollment id). That order cannot be expressed by an
 * index, so the bounded list is read, filtered (active students only), sorted
 * and then paginated by sort-key cursors (model/sortedPagination.ts: complete
 * and duplicate-free across pages). Bounds: a section ≤ MAX_SECTION_ROSTER
 * (1,000) active enrollments; the whole school ≤ MAX_SCHOOL_STUDENT_LIST
 * (5,000) active students — above that the caller is asked to filter by section.
 * Teachers keep the index order.
 */
export const listPeople = schoolQuery({
  args: {
    kind: v.union(v.literal("student"), v.literal("teacher")), sectionId: v.optional(v.id("sections")),
    /** Students only: case-insensitive match on name or admission number (filters the list, never the totals). */
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { kind, sectionId, search, paginationOpts }) => {
    const needle = search?.trim().toLowerCase() ?? "";
    const matches = (s: Doc<"students">) => !needle || fullName(s).toLowerCase().includes(needle) || s.admissionNo.toLowerCase().includes(needle) || (!!s.scholarNo && s.scholarNo.toLowerCase().includes(needle));
    const { actor } = ctx;
    // Students: account managers, or anyone who may read every student record (the
    // admin students list); sign-in account details are returned only to users:manage.
    // Teachers: account managers only.
    if (kind === "student" && !hasPermission(actor, "users:manage")) requirePermission(actor, "students:read:all");
    else requirePermission(actor, "users:manage");
    const withAccounts = hasPermission(actor, "users:manage");
    if (kind === "student") {
      if (sectionId) {
        const section = await getInSchool({ ...ctx, actor }, "sections", sectionId, "Section");
        const enrollments = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).take(MAX_SECTION_ROSTER + 1);
        if (enrollments.length > MAX_SECTION_ROSTER) throw new AppError("CONFLICT", `${section.displayName} has more than ${MAX_SECTION_ROSTER} active students.`);
        const rows: { s: Doc<"students">; e: Doc<"enrollments"> }[] = [];
        const seen = new Set<Id<"students">>(); // a stray duplicate enrollment never lists a student twice
        for (const e of enrollments) {
          if (e.schoolId !== actor.schoolId || seen.has(e.studentId)) continue;
          seen.add(e.studentId);
          const s = await ctx.db.get(e.studentId);
          if (s && s.schoolId === actor.schoolId && s.status === "active" && matches(s)) rows.push({ s, e });
        }
        const result = paginateSorted(rows, ({ s, e }) => sortKeyOf({ firstName: s.firstName, lastName: s.lastName, studentId: s._id, enrollmentId: e._id }), paginationOpts);
        const page = [];
        for (const { s, e } of result.page) {
          page.push({
            personId: s._id as string, name: fullName(s), number: s.admissionNo, detail: `Class ${section.displayName}`,
            rollNo: e.rollNo ?? null,
            account: withAccounts ? await accountFor(ctx, actor, "studentId", s._id) : null,
          });
        }
        return { ...result, page };
      }
      const students = await ctx.db.query("students")
        .withIndex("by_school_status_name", (q) => q.eq("schoolId", actor.schoolId).eq("status", "active"))
        .take(MAX_SCHOOL_STUDENT_LIST + 1);
      if (students.length > MAX_SCHOOL_STUDENT_LIST) throw new AppError("CONFLICT", `More than ${MAX_SCHOOL_STUDENT_LIST} active students — filter the list by section.`);
      const result = paginateSorted(students.filter(matches), (s) => sortKeyOf({ firstName: s.firstName, lastName: s.lastName, studentId: s._id }), paginationOpts);
      const yearId = await getCurrentAcademicYearId(ctx, actor.schoolId);
      const page = [];
      for (const s of result.page) {
        const enr = (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", s._id).eq("academicYearId", yearId)).collect()).find((e) => e.status === "active");
        const section = enr ? await ctx.db.get(enr.sectionId) : null;
        page.push({
          personId: s._id as string, name: fullName(s), number: s.admissionNo, detail: section ? `Class ${section.displayName}` : "Not enrolled",
          rollNo: enr?.rollNo ?? null,
          account: withAccounts ? await accountFor(ctx, actor, "studentId", s._id) : null,
        });
      }
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

/**
 * Administrative (admin-portal) logins of the school — principals, office
 * staff and accountant-only logins — with their access state. Bounded.
 * Change access with memberships.updateAccess (suspend / reactivate,
 * accountant-only) and passwords with issueTemporaryPassword.
 */
export const MAX_STAFF_ACCOUNTS = 500;
export const listStaffAccounts = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "users:manage");
    const rows = await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("role", "admin")).take(MAX_STAFF_ACCOUNTS);
    return rows
      .map((m) => ({
        membershipId: m._id, loginId: m.loginId ?? null, displayName: m.displayName, email: m.email ?? null,
        state: accountState(m), accountantOnly: m.grants === undefined && m.permissionSets.includes("accountant"), isSelf: m._id === ctx.actor.membershipId,
        /** Set by the Principal on Staff & Permissions (module × action grants); manage it there. */
        customAccess: m.grants !== undefined ? describeAccess(m.role, m.grants, m.permissionSets) : null,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});
