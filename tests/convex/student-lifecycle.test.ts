/**
 * Student administration engine: scholar-number uniqueness, duplicate-person
 * check, promotion, pass-out and transfer certificates (convex/academics.ts,
 * convex/studentLifecycle.ts).
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseScholarNo } from "../../convex/model/scholarNumbers";
import { as, createSchool, errorCode, makeTest, type SchoolFixture, type T } from "./fixtures";

const admission = (A: SchoolFixture, over: Record<string, unknown> = {}) => ({
  firstName: "Meera", lastName: "Rao", dateOfBirth: "2014-05-02", admissionDate: "2026-06-01", address: "1 Lane",
  classId: A.classId, sectionId: A.sectionA,
  parentContact: { name: "Parent Rao", relation: "Mother", phone: "+91 98765 43210" },
  ...over,
});

async function nextYear(t: T, A: SchoolFixture) {
  return await t.run(async (ctx) => {
    const yearId = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });
    const class9 = await ctx.db.insert("classes", { schoolId: A.schoolId, name: "Grade 9", level: 9, active: true });
    const class7 = await ctx.db.insert("classes", { schoolId: A.schoolId, name: "Grade 7", level: 7, active: true });
    const nineA = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: class9, name: "A", displayName: "9-A" });
    const eightA = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: A.classId, name: "A", displayName: "8-A" });
    const sevenA = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: class7, name: "A", displayName: "7-A" });
    return { yearId, nineA, eightA, sevenA };
  });
}

async function enrollmentsOf(t: T, studentId: Id<"students">) {
  return await t.run((ctx) => ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", studentId)).collect());
}

describe("scholar numbers", () => {
  test("normalisation: case and spaces do not make a different number", () => {
    expect(parseScholarNo(" sr  104 ")).toEqual({ scholarNo: "sr 104", scholarNoKey: "SR104" });
    expect(parseScholarNo("")).toBeNull();
    expect(() => parseScholarNo("#1")).toThrow();
    expect(() => parseScholarNo("x".repeat(31))).toThrow();
  });

  test("unique per school on admission and on edit; other schools are independent", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const first = await admin.mutation(api.students.createStudentWithEnrollment, admission(A, { scholarNo: "SR 104" }));
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, admission(A, { firstName: "Nila", scholarNo: "sr104" })))).toBe("CONFLICT");
    // Nothing was written by the refused admission.
    expect((await t.run((ctx) => ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", A.schoolId).eq("status", "active").eq("lastName", "Rao")).collect())).length).toBe(1);
    expect(await errorCode(admin.mutation(api.students.updateStudentProfile, { studentId: A.studentB, scholarNo: "Sr 104" }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.students.updateStudentProfile, { studentId: first.studentId, scholarNo: "SR104" }))).toBe("NO_ERROR"); // its own number
    expect(await errorCode(admin.mutation(api.students.updateStudentProfile, { studentId: A.studentB, scholarNo: "SR-105" }))).toBe("NO_ERROR");
    // Another school may use the same number.
    const bAdmin = await as(t, B.users.admin);
    expect(await errorCode(bAdmin.mutation(api.students.createStudentWithEnrollment, admission(B, { scholarNo: "SR104" })))).toBe("NO_ERROR");
    // Lookup is school-scoped.
    expect((await admin.query(api.studentLifecycle.findByScholarNo, { scholarNo: "sr 104" }))?.studentId).toBe(first.studentId);
    expect(await admin.query(api.studentLifecycle.findByScholarNo, { scholarNo: "SR 999" })).toBeNull();
    // Clearing frees the number.
    await admin.mutation(api.students.updateStudentProfile, { studentId: first.studentId, scholarNo: "" });
    expect(await errorCode(admin.mutation(api.students.updateStudentProfile, { studentId: A.studentB, scholarNo: "SR 104" }))).toBe("NO_ERROR");
    // Teachers cannot set scholar numbers.
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.students.updateStudentProfile, { studentId: A.studentA, scholarNo: "SR 1" }))).toBe("FORBIDDEN");
  });

  test("the same child cannot be admitted twice without an explicit confirmation", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.students.createStudentWithEnrollment, admission(A));
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, admission(A, { firstName: " meera ", parentContact: { name: "X", relation: "Father", phone: "+91 90000 00001" } })))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, admission(A, { dateOfBirth: "2014-05-03" })))).toBe("NO_ERROR"); // different DOB
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, admission(A, { confirmNotDuplicate: true })))).toBe("NO_ERROR");
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", A.schoolId).eq("action", "student.admitted")).collect());
    expect(audit.some((r) => Array.isArray((r.metadata as { confirmedNotDuplicateOf?: unknown }).confirmedNotDuplicateOf))).toBe(true);
  });
});

describe("promotion", () => {
  test("moves the same student into the next year; history and roll numbers are kept", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const Y = await nextYear(t, A);
    const admin = await as(t, A.users.admin);
    const studentsBefore = (await t.run((ctx) => ctx.db.query("students").collect())).length;
    const before = (await enrollmentsOf(t, A.studentA))[0];

    const plan = await admin.query(api.studentLifecycle.promotionPlan, { fromSectionId: A.sectionA, toSectionId: Y.nineA });
    expect(plan.kind).toBe("promote");
    expect(plan.rows.map((r) => [r.studentId, r.eligible])).toEqual([[A.studentA, true]]);

    expect(await admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: Y.nineA, studentIds: [A.studentA] })).toEqual({ promoted: 1, kind: "promote" });
    const after = await enrollmentsOf(t, A.studentA);
    const old = after.find((e) => e._id === before._id)!;
    const fresh = after.find((e) => e._id !== before._id)!;
    expect(old).toMatchObject({ status: "promoted", rollNo: before.rollNo, sectionId: A.sectionA, endDate: "2027-03-31" });
    expect(fresh).toMatchObject({ status: "active", sectionId: Y.nineA, academicYearId: Y.yearId, rollNo: 1, startDate: "2027-04-01" });
    expect((await t.run((ctx) => ctx.db.query("students").collect())).length).toBe(studentsBefore); // no new student
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("active");

    // Twice → refused; already in the target year.
    expect(await errorCode(admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: Y.nineA, studentIds: [A.studentA] }))).toBe("CONFLICT");
    const history = await admin.query(api.students.enrollmentHistory, { studentId: A.studentA });
    expect(history).toHaveLength(2);
  });

  test("atomic: one ineligible student refuses the whole request", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const Y = await nextYear(t, A);
    const admin = await as(t, A.users.admin);
    // studentB is in section B, not A.
    expect(await errorCode(admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: Y.nineA, studentIds: [A.studentA, A.studentB] }))).toBe("CONFLICT");
    expect((await enrollmentsOf(t, A.studentA)).map((e) => e.status)).toEqual(["active"]);
  });

  test("refused: same year, an earlier year, a lower class; repeating the class is allowed", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const Y = await nextYear(t, A);
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: A.sectionB, studentIds: [A.studentA] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: Y.sevenA, studentIds: [A.studentA] }))).toBe("INVALID_ARGUMENT");
    expect(await admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: Y.eightA, studentIds: [A.studentA] })).toEqual({ promoted: 1, kind: "repeat" });
  });

  test("permissions, module and tenant checks", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const Y = await nextYear(t, A);
    const args = { fromSectionId: A.sectionA, toSectionId: Y.nineA, studentIds: [A.studentA] };
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.studentLifecycle.promote, args))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.studentLifecycle.promote, args))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, B.users.admin)).mutation(api.studentLifecycle.promote, args))).toBe("NOT_FOUND");
    // Office login: Students view+create+edit is not enough; Approve is.
    const office = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "office@alpha.test" });
      const membershipId = await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, displayName: "Office", role: "admin", status: "active", permissionSets: [], grants: [{ module: "students", actions: ["view", "create", "edit"] }] });
      return { userId, membershipId };
    });
    const clerk = await as(t, office.userId);
    expect(await errorCode(clerk.mutation(api.studentLifecycle.promote, args))).toBe("FORBIDDEN");
    await (await as(t, A.users.admin)).mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "students", actions: ["view", "approve"] }] });
    expect(await errorCode(clerk.mutation(api.studentLifecycle.promote, args))).toBe("NO_ERROR");
    // Student Management switched off for the school → refused, data kept.
    await t.run(async (ctx) => {
      for (const module of ["students", "academics", "attendance", "finance"] as const) await ctx.db.insert("schoolModules", { schoolId: A.schoolId, module, enabled: false, updatedAt: 0, updatedBy: "test", reason: "test" });
      await ctx.db.insert("schoolModules", { schoolId: A.schoolId, module: "administration", enabled: true, updatedAt: 0, updatedBy: "test", reason: "test" });
    });
    expect(await errorCode((await as(t, A.users.admin)).query(api.studentLifecycle.transferCertificates, {}))).toBe("MODULE_DISABLED");
    expect((await enrollmentsOf(t, A.studentA))).toHaveLength(2);
  });
});

describe("pass-out and transfer certificates", () => {
  test("pass-out completes the enrollment and makes the student an alumnus", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    expect(await admin.mutation(api.studentLifecycle.passOut, { sectionId: A.sectionA, studentIds: [A.studentA], date: "2027-03-31" })).toEqual({ passedOut: 1 });
    const [e] = await enrollmentsOf(t, A.studentA);
    expect(e).toMatchObject({ status: "completed", endDate: "2027-03-31", rollNo: 1 });
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("alumni");
    expect(await errorCode(admin.mutation(api.studentLifecycle.passOut, { sectionId: A.sectionA, studentIds: [A.studentA], date: "2027-03-31" }))).toBe("CONFLICT");
  });

  test("a TC ends the enrollment, numbers the certificate, and can be cancelled without losing history", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.students.updateStudentProfile, { studentId: A.studentA, scholarNo: "SR 7" });
    const first = await admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, leavingDate: "2026-11-30", reason: "Family relocating", conduct: "Good" });
    expect(first.tcNo).toBe("TC/AL/26-27/0001");
    const [e] = await enrollmentsOf(t, A.studentA);
    expect(e).toMatchObject({ status: "withdrawn", endDate: "2026-11-30", rollNo: 1 });
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("transferred");
    const tc = await admin.query(api.studentLifecycle.transferCertificate, { tcId: first.tcId });
    expect(tc.snapshot).toMatchObject({ studentName: "Asha S", scholarNo: "SR 7", lastSection: "8-A", academicYear: "2026-27", parentName: "Parent Contact" });
    expect(await errorCode(admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, leavingDate: "2026-12-01", reason: "Again" }))).toBe("CONFLICT");

    await admin.mutation(api.studentLifecycle.cancelTransferCertificate, { tcId: first.tcId, reason: "Issued by mistake" });
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("active");
    const second = await admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, leavingDate: "2026-12-15", reason: "Moving" });
    expect(second.tcNo).toBe("TC/AL/26-27/0002");
    const list = await admin.query(api.studentLifecycle.transferCertificates, { studentId: A.studentA });
    expect(list.map((x) => [x.tcNo, x.status])).toEqual([["TC/AL/26-27/0002", "issued"], ["TC/AL/26-27/0001", "cancelled"]]);
  });

  test("other schools cannot see or touch a TC", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const { tcId } = await admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, leavingDate: "2026-11-30", reason: "Moving" });
    const bAdmin = await as(t, B.users.admin);
    expect(await errorCode(bAdmin.query(api.studentLifecycle.transferCertificate, { tcId }))).toBe("NOT_FOUND");
    expect(await errorCode(bAdmin.mutation(api.studentLifecycle.cancelTransferCertificate, { tcId, reason: "x" }))).toBe("NOT_FOUND");
    expect(await bAdmin.query(api.studentLifecycle.transferCertificates, {})).toEqual([]);
  });
});
