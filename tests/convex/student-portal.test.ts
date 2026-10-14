/**
 * Student portal identity resolution (convex/studentPortal.ts) for accounts
 * created by the school: Convex Auth user → membership → student → current
 * enrollment, server-side only, for every account-creation path.
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { liveStudentPortalUser } from "../../src/features/auth/live-user";

const NEW_PASSWORD = "MyChoice2026";

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  const admin = await as(t, A.users.admin);
  // A student with a real class placement and no account yet.
  const studentId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "ADM-777", firstName: "Meera", lastName: "Nair", status: "active", admissionDate: "2026-04-01", dateOfBirth: "2013-02-03", gender: "female" });
    await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: id, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionB, rollNo: 9, status: "active", startDate: "2026-04-01" });
    return id;
  });
  return { t, A, B, admin, studentId };
}

const userOf = (t: T, membershipId: Id<"schoolMemberships">) => t.run(async (ctx) => (await ctx.db.get(membershipId))!.userId! as Id<"users">);

/** Sign in as the new account, prove it is locked until the temporary password is replaced, replace it. */
async function firstLogin(t: T, userId: Id<"users">, temporaryPassword: string) {
  const me = await as(t, userId);
  const s = await me.query(api.users.session, {});
  expect(s.status === "signedIn" && s.viewer.mustChangePassword).toBe(true);
  expect(await errorCode(me.query(api.studentPortal.myProfile, {}))).toBe("PASSWORD_CHANGE_REQUIRED");
  await me.action(api.account.changePassword, { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD });
  return me;
}

function expectOwnRecord(p: Awaited<ReturnType<typeof myProfileOf>>, studentId: Id<"students">) {
  expect(p.state).toBe("ok");
  if (p.state !== "ok") throw new Error("unreachable");
  expect(p.student.studentId).toBe(studentId);
  expect(p.relation).toBe("self");
  return p;
}
const myProfileOf = (me: Awaited<ReturnType<typeof as>>, studentId?: Id<"students">) =>
  me.query(api.studentPortal.myProfile, studentId ? { studentId } : {});

describe("student portal: identity resolution after account creation", () => {
  test("individual account creation → sign in → password change → own profile with class, section and year", async () => {
    const { t, admin, studentId, A } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId } });
    const me = await firstLogin(t, await userOf(t, r.membershipId), r.temporaryPassword);

    const s = await me.query(api.users.session, {});
    expect(s.status === "signedIn" && !s.viewer.mustChangePassword && s.viewer.student?.studentId === studentId).toBe(true);
    const p = expectOwnRecord(await myProfileOf(me), studentId);
    expect(p.student).toMatchObject({ name: "Meera Nair", admissionNo: "ADM-777", dateOfBirth: "2013-02-03", gender: "female", status: "active" });
    expect(p.academicYear).toMatchObject({ academicYearId: A.yearId, name: "2026-27" });
    expect(p.enrollmentState).toBe("active");
    expect(p.enrollment).toMatchObject({ className: "Grade 8", sectionName: "B", sectionDisplayName: "8-B", status: "active", rollNo: 9 });
    // The rest of the student's own data resolves for the same id.
    expect((await me.query(api.attendance.studentHistory, { studentId })).studentId).toBe(studentId);
  });

  test("bulk account creation → sign in → password change → own profile", async () => {
    const { t, admin, studentId } = await setup();
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: [studentId] } });
    await admin.mutation(api.bulkAccounts.startJob, { jobId });
    const res = await admin.action(api.bulkAccounts.processBatch, { jobId });
    expect(res.credentials).toHaveLength(1);
    const membership = await t.run(async (ctx) => (await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()));
    expect(membership).toHaveLength(1);
    const me = await firstLogin(t, membership[0].userId!, res.credentials[0].temporaryPassword);
    const p = expectOwnRecord(await myProfileOf(me), studentId);
    expect(p.enrollment?.sectionDisplayName).toBe("8-B");
  });

  test("a student imported without an account later gets one and resolves the SAME student record", async () => {
    const { t, A, admin } = await setup();
    const imp = await admin.mutation(api.imports.commitStudentRows, {
      rows: [{ rowNumber: 2, values: { fullName: "Zoya Khan", className: "Grade 8", section: "A", admissionNo: "IMP-1" } }],
      createAccounts: false, today: "2026-07-01",
    });
    const importedId = imp.created[0].studentId;
    const before = await t.run(async (ctx) => (await ctx.db.query("students").collect()).length);
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: importedId } });
    const me = await firstLogin(t, await userOf(t, r.membershipId), r.temporaryPassword);
    const p = expectOwnRecord(await myProfileOf(me), importedId);
    expect(p.student.admissionNo).toBe("IMP-1");
    expect(p.enrollment).toMatchObject({ sectionDisplayName: "8-A", status: "active" });
    expect(typeof p.enrollment?.rollNo).toBe("number");
    expect(await t.run(async (ctx) => (await ctx.db.query("students").collect()).length)).toBe(before);
    expect(p.academicYear?.academicYearId).toBe(A.yearId);
  });
});

describe("student portal: authorization", () => {
  test("a student cannot read another student's profile (same school or another school)", async () => {
    const { t, A, B, admin, studentId } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId } });
    const me = await firstLogin(t, await userOf(t, r.membershipId), r.temporaryPassword);
    expect(await errorCode(myProfileOf(me, A.studentA))).toBe("NOT_FOUND");
    expect(await errorCode(myProfileOf(me, A.studentB))).toBe("NOT_FOUND");
    expect(await errorCode(myProfileOf(me, B.studentA))).toBe("NOT_FOUND");
    expect(await errorCode(me.query(api.attendance.studentHistory, { studentId: A.studentA }))).toBe("NOT_FOUND");
    // The fixture student of school B only ever sees school B's record.
    const other = await as(t, B.users.student);
    const p = await myProfileOf(other);
    expect(p.state === "ok" && p.student.studentId === B.studentA).toBe(true);
    expect(await errorCode(myProfileOf(other, studentId))).toBe("NOT_FOUND");
    // A forged membership id (someone else's) is refused by the actor resolution.
    expect(await errorCode(me.query(api.studentPortal.myProfile, { membershipId: B.memberships.student }))).not.toBe("NO_ERROR");
  });

  test("guardians resolve only their linked children", async () => {
    const { t, A } = await setup();
    const g = await as(t, A.users.guardian);
    const p = await myProfileOf(g);
    expect(p.state === "ok" && p.student.studentId === A.studentA && p.relation === "guardian").toBe(true);
    expect((await myProfileOf(g, A.studentA)).state).toBe("ok");
    expect(await errorCode(myProfileOf(g, A.studentB))).toBe("NOT_FOUND");
  });

  test("staff roles are not student-portal identities", async () => {
    const { t, A } = await setup();
    expect(await errorCode((await as(t, A.users.admin)).query(api.studentPortal.myProfile, {}))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.studentPortal.myProfile, {}))).toBe("FORBIDDEN");
    // …and their own workspaces keep working.
    expect((await (await as(t, A.users.admin)).query(api.users.viewer, {})).role).toBe("admin");
    expect((await (await as(t, A.users.classTeacher)).query(api.attendance.studentHistory, { studentId: A.studentA })).studentId).toBe(A.studentA);
  });
});

describe("student portal: missing data is explicit", () => {
  test("missing student link, ended enrollment, missing enrollment and no current year", async () => {
    const { t, A, admin, studentId } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId } });
    const userId = await userOf(t, r.membershipId);
    const me = await firstLogin(t, userId, r.temporaryPassword);

    // Enrollment withdrawn by the office → "ended", no roll number.
    const enr = await t.run(async (ctx) => (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", studentId).eq("academicYearId", A.yearId)).first())!);
    await admin.mutation(api.academics.endEnrollment, { enrollmentId: enr._id, status: "withdrawn", endDate: "2026-09-30" });
    let p = await myProfileOf(me);
    expect(p.state === "ok" && p.enrollmentState === "ended" && p.enrollment?.status === "withdrawn" && p.enrollment.rollNo === null).toBe(true);

    // No enrollment at all in the current year → "missing".
    await t.run(async (ctx) => ctx.db.delete(enr._id));
    p = await myProfileOf(me);
    expect(p.state === "ok" && p.enrollmentState === "missing" && p.enrollment === null).toBe(true);

    // The school has no current academic year → "no_current_year".
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", A.schoolId)).first())!;
      await ctx.db.patch(s._id, { currentAcademicYearId: undefined });
    });
    p = await myProfileOf(me);
    expect(p.state === "ok" && p.enrollmentState === "no_current_year" && p.academicYear === null).toBe(true);

    // A student-portal membership with no student link → explicit "no_student_record".
    await t.run(async (ctx) => ctx.db.patch(r.membershipId, { studentId: undefined }));
    expect(await myProfileOf(me)).toEqual({ state: "no_student_record" });
  });
});

describe("student portal: no demo binding, no duplicates", () => {
  test("the live portal user is built only from the server viewer (Convex ids, server role)", async () => {
    const { t, admin, studentId } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId } });
    const me = await firstLogin(t, await userOf(t, r.membershipId), r.temporaryPassword);
    const s = await me.query(api.users.session, {});
    if (s.status !== "signedIn") throw new Error("not signed in");
    const u = liveStudentPortalUser(s.viewer);
    expect(u).toMatchObject({ id: r.membershipId, role: "student", loginId: r.loginId, studentIds: [studentId] });
    expect(u.guardianId).toBeUndefined();
    expect(u.studentIds?.every((id) => !id.startsWith("stu_"))).toBe(true); // never a demo-data id
  });

  test("re-running account creation never duplicates accounts; the diagnostic is read-only and reports them resolved", async () => {
    const { t, A, admin, studentId } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId } });
    await firstLogin(t, await userOf(t, r.membershipId), r.temporaryPassword);
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "student", studentId } }))).toBe("CONFLICT");
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: [studentId] } });
    expect((await admin.query(api.bulkAccounts.getJob, { jobId })).skipped).toBe(1);

    const snapshot = () => t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      memberships: (await ctx.db.query("schoolMemberships").collect()).length,
      students: (await ctx.db.query("students").collect()).length,
      enrollments: (await ctx.db.query("enrollments").collect()).length,
    }));
    const before = await snapshot();
    const d = await t.query(internal.studentPortal.diagnoseStudentAccounts, { schoolSlug: "alpha" });
    expect(d.found && d.studentAccounts === 2 && d.fullyResolved === 2 && d.studentsWithMoreThanOneAccount === 0 && d.problems.length === 0).toBe(true);
    expect(await snapshot()).toEqual(before);
    // It does report a broken link when there is one.
    await t.run(async (ctx) => ctx.db.patch(A.memberships.student, { studentId: undefined }));
    const d2 = await t.query(internal.studentPortal.diagnoseStudentAccounts, { schoolSlug: "alpha" });
    expect(d2.found && d2.problems.map((p) => p.problem)).toEqual(["membership_not_linked_to_student"]);
  });
});
