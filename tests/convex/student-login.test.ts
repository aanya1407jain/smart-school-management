/**
 * Students sign in with their SCHOLAR NUMBER and start with the school default
 * password (model/accounts.ts STUDENT_DEFAULT_PASSWORD), which must be changed
 * at first sign-in and does not expire. Covers: Login ID follows scholar-number
 * edits, the one-off migration of existing student accounts, and that renaming
 * never touches another person's sign-in.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { STUDENT_DEFAULT_PASSWORD } from "../../convex/model/accounts";
import { as, createSchool, enableSignIn, errorCode, makeTest, overwritePassword, signInResult, type T } from "./fixtures";

const memberOf = (t: T, id: Id<"schoolMemberships">) => t.run(async (ctx) => {
  const m = (await ctx.db.get(id))!;
  const user = m.userId ? await ctx.db.get(m.userId) : null;
  const account = await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", m.loginId!)).first();
  return { m, user, account };
});

/** A student account still on a legacy STU-… Login ID with a password the student chose (as before this change). */
async function legacyAccount(t: T, schoolId: Id<"schools">, admin: Awaited<ReturnType<typeof as>>, studentId: Id<"students">, legacyId: string) {
  const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId } });
  await overwritePassword(admin, r.membershipId, "Chosen#2026"); // set by an administrator, before the legacy rename
  await t.run(async (ctx) => {
    const m = (await ctx.db.get(r.membershipId))!;
    await ctx.db.patch(m._id, { loginId: legacyId });
    await ctx.db.patch(m.userId!, { loginId: legacyId });
    const acc = await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", r.loginId)).first();
    await ctx.db.patch(acc!._id, { providerAccountId: legacyId });
  });
  const userId = (await memberOf(t, r.membershipId)).m.userId!;
  return { membershipId: r.membershipId, userId, schoolId };
}

beforeAll(() => enableSignIn());

describe("Login ID follows the scholar number", () => {
  test("changing a student's scholar number renames the Login ID everywhere; it cannot be removed while they have an account", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    expect(r.loginId).toBe("ALPHABALA");

    await admin.mutation(api.students.updateStudentProfile, { studentId: A.studentB, scholarNo: "0246cbse 0042" });
    const { m, user, account } = await memberOf(t, r.membershipId);
    expect([m.loginId, user?.loginId, account?.providerAccountId]).toEqual(["0246CBSE0042", "0246CBSE0042", "0246CBSE0042"]);
    // The password still works under the new Login ID.
    expect(user?._id).toBeDefined();
    expect(await signInResult(t, "0246CBSE0042", STUDENT_DEFAULT_PASSWORD)).toBe("OK");

    expect(await errorCode(admin.mutation(api.students.updateStudentProfile, { studentId: A.studentB, scholarNo: "" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.students.updateStudentProfile, { studentId: A.studentB, scholarNo: "SR/1" }))).toBe("INVALID_ARGUMENT"); // not usable to sign in
  });

  test("an administrator can set the student's password back to the default (OTP-authorized)", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    await overwritePassword(admin, r.membershipId, "Bala#2026x");
    expect((await memberOf(t, r.membershipId)).user?.defaultPassword).toBeUndefined();
    expect(await signInResult(t, r.loginId, STUDENT_DEFAULT_PASSWORD)).toMatch(/InvalidSecret/);
    await overwritePassword(admin, r.membershipId, STUDENT_DEFAULT_PASSWORD);
    expect(await signInResult(t, r.loginId, STUDENT_DEFAULT_PASSWORD)).toBe("OK");
  });

  test("teachers and office logins keep random one-time passwords", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const teacherId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-1", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
    const r = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId } });
    expect(r.temporaryPassword).not.toBe(STUDENT_DEFAULT_PASSWORD);
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect((await memberOf(t, r.membershipId)).user?.defaultPassword).toBeUndefined();
  });
});

describe("migration of existing student accounts (studentLoginMigration)", () => {
  test("dry run changes nothing; the run moves Login IDs to scholar numbers and resets passwords to the default", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const legacy = await legacyAccount(t, A.schoolId, admin, A.studentB, "STU-2026-00099");
    // A student without a scholar number is reported, not converted.
    const noScholar = await t.run((ctx) => ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "X-9", firstName: "No", lastName: "Number", status: "active" }));
    await t.run((ctx) => ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, loginId: "STU-2026-00098", displayName: "No Number", role: "student", status: "invited", permissionSets: [], studentId: noScholar }));

    const dry = await t.action(internal.studentLoginMigration.run, { schoolSlug: "alpha", dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, toConvert: 1, converted: 0, sample: [{ from: "STU-2026-00099", to: "ALPHABALA" }] });
    expect(dry.skipped).toEqual([{ name: "No Number", loginId: "STU-2026-00098", reason: "No scholar number" }]);
    expect((await memberOf(t, legacy.membershipId)).m.loginId).toBe("STU-2026-00099");

    const run = await t.action(internal.studentLoginMigration.run, { schoolSlug: "alpha" });
    expect(run).toMatchObject({ toConvert: 1, converted: 1, failed: [] });
    const { m, user, account } = await memberOf(t, legacy.membershipId);
    expect([m.loginId, user?.loginId, account?.providerAccountId]).toEqual(["ALPHABALA", "ALPHABALA", "ALPHABALA"]);
    expect(user).toMatchObject({ defaultPassword: true });
    // Old password gone, default works.
    expect(await signInResult(t, "ALPHABALA", "Chosen#2026")).toMatch(/InvalidSecret/);
    expect(await signInResult(t, "ALPHABALA", STUDENT_DEFAULT_PASSWORD)).toBe("OK");
    // Re-running converts nothing more.
    expect(await t.action(internal.studentLoginMigration.run, { schoolSlug: "alpha" })).toMatchObject({ toConvert: 0, converted: 0 });
  });

  test("the documented demo persona is skipped unless includeDemo; a scholar number taken by someone else is reported", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const persona = await legacyAccount(t, A.schoolId, admin, A.studentB, "STU-2026-00001");
    // Another person already signs in with what would be the new Login ID.
    const otherStudent = await t.run((ctx) => ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "Y-1", firstName: "Taken", lastName: "Id", status: "active", scholarNo: "TCH-00001", scholarNoKey: "TCH-00001" }));
    await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { loginId: "TCH-00001" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, loginId: "TCH-00001", userId: u, displayName: "Teacher", role: "teacher", status: "active", permissionSets: [] });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, loginId: "STU-2026-00050", displayName: "Taken Id", role: "student", status: "invited", permissionSets: [], studentId: otherStudent });
    });

    const dry = await t.action(internal.studentLoginMigration.run, { schoolSlug: "alpha", dryRun: true });
    expect(dry.toConvert).toBe(0);
    expect(dry.skipped.map((s) => s.reason).sort()).toEqual(["Demo persona (development login)", "Login ID TCH-00001 is already in use"]);
    const withDemo = await t.action(internal.studentLoginMigration.run, { schoolSlug: "alpha", dryRun: true, includeDemo: true });
    expect(withDemo.sample).toEqual([{ name: expect.any(String), from: "STU-2026-00001", to: "ALPHABALA" }]);
    expect((await memberOf(t, persona.membershipId)).m.loginId).toBe("STU-2026-00001");
  });
});
