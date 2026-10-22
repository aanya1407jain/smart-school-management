/**
 * Admin account management (convex/accounts.ts) and the Login ID identity model.
 * Sign-in itself (Convex Auth HTTP flow) is covered by the integration suite;
 * here a temporary password is proven valid by using it with
 * account.changePassword, which verifies it through Convex Auth.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { canonicalLoginId, formatLoginId, parseGeneratedLoginId } from "../../convex/model/loginIds";

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  return { t, A, B };
}

async function memberFor(t: T, id: Id<"schoolMemberships">) {
  return await t.run(async (ctx) => {
    const m = (await ctx.db.get(id))!;
    const user = m.userId ? await ctx.db.get(m.userId) : null;
    const account = await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", m.loginId!)).first();
    return { m, user, account };
  });
}

describe("Login IDs", () => {
  test("canonical form: trimmed, upper-case, restricted charset", () => {
    expect(canonicalLoginId(" stu-2026-00451 ")).toBe("STU-2026-00451");
    expect(canonicalLoginId("tch.anita_r")).toBe("TCH.ANITA_R");
    expect(canonicalLoginId("ab")).toBeNull();
    expect(canonicalLoginId("admin@school.edu")).toBeNull();
    expect(canonicalLoginId("has space")).toBeNull();
    expect(canonicalLoginId("-LEADING")).toBeNull();
  });
  test("generated formats round-trip", () => {
    expect(formatLoginId("teacher", 124)).toBe("TCH-00124");
    expect(formatLoginId("student", 451, "2026")).toBe("STU-2026-00451");
    expect(formatLoginId("admin", 1)).toBe("ADMIN-001");
    expect(parseGeneratedLoginId("STU-2026-00451")).toEqual({ kind: "student", n: 451, year: "2026" });
    expect(parseGeneratedLoginId("CUSTOM-ID")).toBeNull();
  });
});

describe("accounts.create", () => {
  test("admin creates a student account linked to the student record", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    expect(r.loginId).toMatch(/^STU-\d{4}-00001$/);
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    const { m, user, account } = await memberFor(t, r.membershipId);
    expect(m).toMatchObject({ schoolId: A.schoolId, role: "student", status: "active", studentId: A.studentB, loginId: r.loginId });
    expect(m.teacherId).toBeUndefined();
    expect(user).toMatchObject({ loginId: r.loginId, mustChangePassword: true });
    // Only a hash is stored, never the password itself.
    expect(account?.secret).toBeDefined();
    expect(account?.secret).not.toContain(r.temporaryPassword);
  });

  test("admin creates a teacher account with an explicit (normalised) Login ID", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const teacherId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-9", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
    const r = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId }, loginId: "  tch-00124 " });
    expect(r.loginId).toBe("TCH-00124");
    const { m } = await memberFor(t, r.membershipId);
    expect(m).toMatchObject({ role: "teacher", teacherId, status: "active" });
    // The generator continues after an explicit generated-shape ID.
    const t2 = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-10", firstName: "Om", lastName: "Das", specializationSubjectIds: [], status: "active" }));
    expect((await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: t2 } })).loginId).toBe("TCH-00125");
  });

  test("the temporary password works (verified by Convex Auth) and the user can replace it", async () => {
    const { t, A } = await setup();
    const r = await (await as(t, A.users.admin)).action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    const { m } = await memberFor(t, r.membershipId);
    const student = await as(t, m.userId!);
    expect(await errorCode(student.action(api.account.changePassword, { currentPassword: "wrong-pass-1", newPassword: "MyNewPass9" }))).toBe("INVALID_ARGUMENT");
    await student.action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "MyNewPass9" });
    expect((await memberFor(t, r.membershipId)).user?.mustChangePassword).toBeUndefined();
    const s = await student.query(api.users.session, {});
    expect(s.status === "signedIn" && s.viewer.loginId === r.loginId && s.viewer.role === "student").toBe(true);
  });

  test("duplicate Login ID and a second account for the same person are rejected", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB }, loginId: "STU-X-1" });
    const t2 = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-11", firstName: "Ravi", lastName: "K", specializationSubjectIds: [], status: "active" }));
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: t2 }, loginId: "stu-x-1" }))).toBe("CONFLICT");
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } }))).toBe("CONFLICT");
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: t2 }, loginId: "bad id!" }))).toBe("INVALID_ARGUMENT");
  });

  test("non-admins cannot create accounts; other schools' records are NOT_FOUND", async () => {
    const { t, A, B } = await setup();
    for (const u of [A.users.classTeacher, A.users.student]) {
      expect(await errorCode((await as(t, u)).action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } }))).toBe("FORBIDDEN");
    }
    expect(await errorCode((await as(t, A.users.admin)).action(api.accounts.create, { person: { kind: "student", studentId: B.studentB } }))).toBe("NOT_FOUND");
    expect(await t.run((ctx) => ctx.db.query("users").withIndex("by_login_id").collect()).then((u) => u.filter((x) => x.loginId).length)).toBe(0);
  });

  test("a forged role or school in the arguments is rejected by validation", async () => {
    const { t, A, B } = await setup();
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB }, role: "admin" } as never))).toMatch(/THROWN/);
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB }, schoolId: B.schoolId } as never))).toMatch(/THROWN/);
  });
});

describe("disable / enable / reset", () => {
  test("disabling cuts school access immediately; enabling restores it; admins cannot disable themselves", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    const userId = (await memberFor(t, r.membershipId)).m.userId!;
    const student = await as(t, userId);
    expect((await student.query(api.users.session, {})).status).toBe("signedIn");
    await admin.action(api.accounts.setStatus, { targetMembershipId: r.membershipId, status: "suspended" });
    // Disabling revokes every session: the old token no longer identifies anyone.
    expect((await student.query(api.users.session, {})).status).toBe("signedOut");
    expect(await errorCode(student.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("UNAUTHENTICATED");
    // Even a fresh session (had one been created) has no school access while disabled.
    expect(await errorCode((await as(t, userId)).query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("NO_SCHOOL_ACCESS");
    expect(await errorCode(admin.action(api.accounts.issueTemporaryPassword, { targetMembershipId: r.membershipId }))).toBe("INVALID_ARGUMENT");
    await admin.action(api.accounts.setStatus, { targetMembershipId: r.membershipId, status: "active" });
    expect((await (await as(t, userId)).query(api.users.session, {})).status).toBe("signedIn");
    expect(await errorCode(admin.action(api.accounts.setStatus, { targetMembershipId: A.memberships.admin, status: "suspended" }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.classTeacher)).action(api.accounts.setStatus, { targetMembershipId: r.membershipId, status: "suspended" }))).toBe("FORBIDDEN");
  });

  test("a reset issues a new working temporary password and requires a change again", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    const userId = (await memberFor(t, r.membershipId)).m.userId!;
    await (await as(t, userId)).action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "Chosen123" });
    const reset = await admin.action(api.accounts.issueTemporaryPassword, { targetMembershipId: r.membershipId });
    expect(reset.loginId).toBe(r.loginId);
    expect((await memberFor(t, r.membershipId)).user?.mustChangePassword).toBe(true);
    const fresh = await as(t, userId);
    expect(await errorCode(fresh.action(api.account.changePassword, { currentPassword: "Chosen123", newPassword: "Another123" }))).toBe("INVALID_ARGUMENT");
    await fresh.action(api.account.changePassword, { currentPassword: reset.temporaryPassword, newPassword: "Another123" });
  });

  test("listPeople shows account state per person (admin only)", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    const page = await admin.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 50, cursor: null } });
    const byName = Object.fromEntries(page.page.map((p) => [p.name, p]));
    expect(byName["Bala S"].account?.state).toBe("active");
    expect(byName["Asha S"].account?.state).toBe("active"); // fixture student membership
    expect(byName["Bala S"].detail).toBe("Class 8-B");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 5, cursor: null } }))).toBe("FORBIDDEN");
  });
});
