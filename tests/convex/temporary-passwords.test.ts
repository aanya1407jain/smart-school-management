/**
 * Temporary passwords are enforced on the SERVER:
 *  - while users.mustChangePassword is set, every school function refuses with
 *    PASSWORD_CHANGE_REQUIRED (only users.session and account.changePassword work);
 *  - they expire (TEMPORARY_PASSWORD_TTL_MS): no new session, no password change;
 *  - an admin reset re-issues one and re-imposes the forced change;
 *  - suspended accounts cannot use the password-change endpoint.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { assertSessionAllowed, TEMPORARY_PASSWORD_TTL_MS } from "../../convex/model/accounts";

afterEach(() => vi.useRealTimers());

async function newStudentAccount() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const admin = await as(t, A.users.admin);
  const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
  const userId = (await t.run(async (ctx) => (await ctx.db.get(r.membershipId))!.userId!)) as Id<"users">;
  const extraTeacher = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-X", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
  return { t, A, admin, r, userId, extraTeacher };
}

/** Teachers (and office logins) get random one-time passwords that expire; the student default does not. */
async function newTeacherAccount() {
  const base = await newStudentAccount();
  const r = await base.admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: base.extraTeacher } });
  const userId = (await base.t.run(async (ctx) => (await ctx.db.get(r.membershipId))!.userId!)) as Id<"users">;
  return { ...base, r, userId };
}

const userRow = (t: T, id: Id<"users">) => t.run((ctx) => ctx.db.get(id));
const sessionGate = (t: T, userId: Id<"users">, now: number) =>
  t.run(async (ctx) => { await assertSessionAllowed(ctx, userId, now); return "allowed"; });

describe("forced password change", () => {
  test("a new account is flagged with a server issue time and is locked out of school functions", async () => {
    const before = Date.now();
    const { t, A, r, userId } = await newStudentAccount();
    const u = await userRow(t, userId);
    expect(u?.mustChangePassword).toBe(true);
    expect(u?.temporaryPasswordIssuedAt).toBeGreaterThanOrEqual(before);

    const student = await as(t, userId);
    const s = await student.query(api.users.session, {});
    // Students start with the school default password: forced change, but no expiry.
    expect(s.status === "signedIn" && s.viewer.mustChangePassword && s.viewer.temporaryPasswordExpiresAt === null).toBe(true);
    expect(u?.defaultPassword).toBe(true);
    expect(await errorCode(student.query(api.users.viewer, {}))).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(await errorCode(student.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(await errorCode(student.query(api.studentPortal.myProfile, { studentId: A.studentB }))).toBe("PASSWORD_CHANGE_REQUIRED");

    // A wrong current password changes nothing; the flag stays.
    expect(await errorCode(student.action(api.account.changePassword, { currentPassword: "Wrong-pass-1", newPassword: "MyChoice2026" }))).toBe("INVALID_ARGUMENT");
    expect((await userRow(t, userId))?.mustChangePassword).toBe(true);

    await student.action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "MyChoice2026" });
    const after = await userRow(t, userId);
    expect(after?.mustChangePassword).toBeUndefined();
    expect(after?.temporaryPasswordIssuedAt).toBeUndefined();
    expect((await student.query(api.users.viewer, {})).role).toBe("student");
    expect((await student.query(api.attendance.studentHistory, { studentId: A.studentB })).studentId).toBe(A.studentB);
  });

  test("an administrator with a temporary password cannot manage accounts until they change it", async () => {
    const { t, A, admin, extraTeacher } = await newStudentAccount();
    // Reset the admin's flag the way setup/break-glass does.
    await t.run((ctx) => ctx.db.patch(A.users.admin, { mustChangePassword: true, temporaryPasswordIssuedAt: Date.now() }));
    expect(await errorCode(admin.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 5, cursor: null } }))).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: extraTeacher } }))).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(await errorCode(admin.mutation(api.imports.commitStudentRows, { rows: [{ rowNumber: 2, values: { fullName: "New Kid", className: "8", section: "B" } }], createAccounts: false, today: "2026-07-01" }))).toBe("PASSWORD_CHANGE_REQUIRED");
    const s = await admin.query(api.users.session, {});
    expect(s.status === "signedIn" && s.viewer.role === "admin" && s.viewer.mustChangePassword).toBe(true);
  });
});

describe("temporary-password expiry", () => {
  test("the student default password never expires (it must still be changed at first sign-in)", async () => {
    const { t, userId } = await newStudentAccount();
    expect(await sessionGate(t, userId, Date.now() + 100 * TEMPORARY_PASSWORD_TTL_MS)).toBe("allowed");
    expect((await userRow(t, userId))?.mustChangePassword).toBe(true);
  });

  test("no new session and no password change with an expired temporary password (teacher one-time password)", async () => {
    const { t, r, userId } = await newTeacherAccount();
    const issuedAt = (await userRow(t, userId))!.temporaryPasswordIssuedAt!;
    expect(await sessionGate(t, userId, issuedAt + TEMPORARY_PASSWORD_TTL_MS - 1)).toBe("allowed");
    expect(await errorCode(sessionGate(t, userId, issuedAt + TEMPORARY_PASSWORD_TTL_MS))).toBe("TEMPORARY_PASSWORD_EXPIRED");

    vi.useFakeTimers({ now: issuedAt + TEMPORARY_PASSWORD_TTL_MS + 1000 });
    const teacher = await as(t, userId);
    expect(await errorCode(teacher.action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "MyChoice2026" }))).toBe("TEMPORARY_PASSWORD_EXPIRED");
    expect((await userRow(t, userId))?.mustChangePassword).toBe(true);
  });

  test("an admin reset issues a fresh temporary password, a new expiry and the forced change again", async () => {
    const { t, A, admin, r, userId } = await newStudentAccount();
    const student = await as(t, userId);
    await student.action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "MyChoice2026" });
    expect(await sessionGate(t, userId, Date.now() + 10 * TEMPORARY_PASSWORD_TTL_MS)).toBe("allowed"); // ordinary passwords do not expire

    const reset = await admin.action(api.accounts.issueTemporaryPassword, { targetMembershipId: r.membershipId });
    const u = await userRow(t, userId);
    expect(u?.mustChangePassword).toBe(true);
    expect(u?.temporaryPasswordIssuedAt).toBeDefined();
    // The reset signed every session out.
    expect(await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect())).toHaveLength(0);
    const fresh = await as(t, userId);
    expect(await errorCode(fresh.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(await errorCode(fresh.action(api.account.changePassword, { currentPassword: "MyChoice2026", newPassword: "Another2026" }))).toBe("INVALID_ARGUMENT");
    await fresh.action(api.account.changePassword, { currentPassword: reset.temporaryPassword, newPassword: "Another2026" });
    expect((await userRow(t, userId))?.mustChangePassword).toBeUndefined();
  });
});

describe("disabled accounts and the password endpoint", () => {
  test("a suspended account cannot change its password or start a session", async () => {
    const { t, admin, r, userId } = await newStudentAccount();
    const student = await as(t, userId);
    await admin.action(api.accounts.setStatus, { targetMembershipId: r.membershipId, status: "suspended" });
    expect(await errorCode(student.action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "MyChoice2026" }))).toBe("NO_SCHOOL_ACCESS");
    expect(await errorCode(sessionGate(t, userId, Date.now()))).toBe("NO_SCHOOL_ACCESS");
    expect(await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect())).toHaveLength(0);
  });

  test("memberships.updateAccess: suspending revokes sessions; pending accounts cannot be toggled", async () => {
    vi.useFakeTimers();
    const { t, A, admin, r, userId, extraTeacher } = await newStudentAccount();
    await as(t, userId); // an open session
    await admin.mutation(api.memberships.updateAccess, { targetMembershipId: r.membershipId, status: "suspended" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect())).toHaveLength(0);

    const pending = await t.run((ctx) => ctx.db.insert("schoolMemberships", {
      schoolId: A.schoolId, loginId: "PENDING-1", displayName: "Pending", role: "teacher", status: "invited", permissionSets: [], teacherId: extraTeacher,
    }));
    expect(await errorCode(admin.mutation(api.memberships.updateAccess, { targetMembershipId: pending, status: "suspended" }))).toBe("INVALID_ARGUMENT");
  });
});
