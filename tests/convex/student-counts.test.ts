/**
 * Students page totals (academics.studentCounts) — regression for "a student is
 * admitted but the Students page total does not change". The admission is made
 * through the same mutation the admin form calls; the list (accounts.listPeople)
 * and the totals must both reflect it, follow one counting rule (shared with the
 * admin dashboard), ignore pagination/search, never double count and never
 * include another school's students.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;
const admit = (A: School, firstName: string, sectionId: Id<"sections"> = A.sectionA) => ({
  firstName, lastName: "Menon", gender: "female" as const, dateOfBirth: "2012-05-14", admissionDate: "2026-06-01", address: "12, 4th Main, Bengaluru",
  classId: A.classId, sectionId, parentContact: { name: "Kavita Menon", relation: "Mother", phone: "98450 77777" },
});
const page = { numItems: 50, cursor: null };

describe("student totals", () => {
  test("admitting a student updates the list and the totals; other schools are excluded; dashboard agrees", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const before = await admin.query(api.academics.studentCounts, {});
    expect(before).toMatchObject({ enrolled: 2, activeRecords: 2, notEnrolled: 0, section: null });

    const { studentId } = await admin.mutation(api.academics.createStudentWithEnrollment, admit(A, "Ishita"));
    const after = await admin.query(api.academics.studentCounts, {});
    expect(after).toMatchObject({ enrolled: 3, activeRecords: 3, notEnrolled: 0 });
    const list = await admin.query(api.accounts.listPeople, { kind: "student", paginationOpts: page });
    expect(list.page.map((p) => p.personId)).toContain(studentId);
    expect(list.page).toHaveLength(3);
    // The admin dashboard uses the same rule and records.
    expect((await admin.query(api.reports.adminDashboard, {})).overview?.students).toBe(3);
    // School B is untouched and sees none of A's students.
    const adminB = await as(t, B.users.admin);
    expect(await adminB.query(api.academics.studentCounts, {})).toMatchObject({ enrolled: 2, activeRecords: 2 });
    expect((await adminB.query(api.accounts.listPeople, { kind: "student", paginationOpts: page })).page.map((p) => p.personId)).not.toContain(studentId);
    expect(await errorCode(adminB.query(api.academics.studentCounts, { sectionId: A.sectionA }))).toBe("NOT_FOUND");
  });

  test("pagination and search filter the list, never the totals; section count is separate", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    for (const n of ["Ira", "Ivan", "Zara"]) await admin.mutation(api.academics.createStudentWithEnrollment, admit(A, n, A.sectionB));
    const firstPage = await admin.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 2, cursor: null } });
    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
    const found = await admin.query(api.accounts.listPeople, { kind: "student", search: "zara", paginationOpts: page });
    expect(found.page.map((p) => p.name)).toEqual(["Zara Menon"]);
    expect((await admin.query(api.accounts.listPeople, { kind: "student", search: "alpha-Asha", paginationOpts: page })).page.map((p) => p.name)).toEqual(["Asha S"]); // admission no.
    expect((await admin.query(api.accounts.listPeople, { kind: "student", sectionId: A.sectionB, search: "iv", paginationOpts: page })).page.map((p) => p.name)).toEqual(["Ivan Menon"]);
    const totals = await admin.query(api.academics.studentCounts, { sectionId: A.sectionB });
    expect(totals).toMatchObject({ enrolled: 5, activeRecords: 5, section: { label: "8-B", enrolled: 4 } });
  });

  test("a student is counted once despite a duplicate enrollment or several accounts; unenrolled and withdrawn students are reported correctly", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await t.run(async (ctx) => {
      // A stray duplicate active enrollment and a second membership for the same student.
      await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionB, status: "active", startDate: "2026-04-01" });
      const u = await ctx.db.insert("users", { email: "dup@x.test" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: u, displayName: "Dup", role: "student", status: "active", permissionSets: [], studentId: A.studentA });
      // An active student record not yet placed in a class.
      await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "NEW-9", firstName: "Unplaced", lastName: "Kid", status: "active" });
    });
    expect(await admin.query(api.academics.studentCounts, {})).toMatchObject({ enrolled: 2, activeRecords: 3, notEnrolled: 1 });
    // Withdrawing a student lowers "enrolled"; the record stays (history), counted under active records until its status changes.
    const enrollmentId = await t.run(async (ctx) => (await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", A.sectionB).eq("status", "active")).collect()).find((e) => e.studentId === A.studentB)!._id);
    await admin.mutation(api.academics.endEnrollment, { enrollmentId, status: "withdrawn", endDate: "2026-09-30" });
    expect(await admin.query(api.academics.studentCounts, {})).toMatchObject({ enrolled: 1, notEnrolled: 2 });
  });

  test("the totals and the list follow the same records: inactive records and duplicate rows never count", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await t.run(async (ctx) => {
      // studentB's record is no longer active but an enrollment was left open (legacy/imported data).
      await ctx.db.patch(A.studentB, { status: "alumni" });
      // studentA has a duplicate active enrollment in the SAME section.
      await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionA, status: "active", startDate: "2026-04-01" });
    });
    const counts = await admin.query(api.academics.studentCounts, { sectionId: A.sectionA });
    expect(counts).toMatchObject({ enrolled: 1, activeRecords: 1, notEnrolled: 0 });
    const all = await admin.query(api.accounts.listPeople, { kind: "student", paginationOpts: page });
    expect(all.page.map((p) => p.personId)).toEqual([A.studentA]);
    const inSection = await admin.query(api.accounts.listPeople, { kind: "student", sectionId: A.sectionA, paginationOpts: page });
    expect(inSection.page.map((p) => p.personId)).toEqual([A.studentA]); // listed once
    expect(counts.section?.enrolled).toBe(inSection.page.length);
    expect((await admin.query(api.reports.adminDashboard, {})).overview?.students).toBe(counts.enrolled);
  });

  test("the list survives a fresh session (persisted records, not client state)", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { studentId, admissionNo } = await (await as(t, A.users.admin)).mutation(api.academics.createStudentWithEnrollment, admit(A, "Persist"));
    const again = await as(t, A.users.admin); // new client session
    const found = await again.query(api.accounts.listPeople, { kind: "student", search: admissionNo, paginationOpts: page });
    expect(found.page.map((p) => p.personId)).toEqual([studentId]);
    expect((await again.query(api.academics.studentCounts, {})).enrolled).toBe(3);
  });

  test("who may read the totals: student readers (admin, accountant-only), not teachers or students", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    expect(await errorCode((await as(t, A.users.admin)).query(api.academics.studentCounts, {}))).toBe("NO_ERROR");
    for (const u of [A.users.classTeacher, A.users.student]) {
      expect(await errorCode((await as(t, u)).query(api.academics.studentCounts, {}))).toBe("FORBIDDEN");
      expect(await errorCode((await as(t, u)).query(api.accounts.listPeople, { kind: "student", paginationOpts: page }))).toBe("FORBIDDEN");
      expect(await errorCode((await as(t, u)).mutation(api.academics.createStudentWithEnrollment, admit(A, "Nope")))).toBe("FORBIDDEN");
    }
    const acc = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "acc@x.test" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, displayName: "Acc", role: "admin", status: "active", permissionSets: ["accountant"] });
      return userId;
    });
    expect(await errorCode((await as(t, acc)).query(api.academics.studentCounts, {}))).toBe("NO_ERROR");
  });
});
