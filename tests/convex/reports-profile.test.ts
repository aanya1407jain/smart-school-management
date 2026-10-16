/**
 * A-06 reports (persisted data, no double counting, scope) and the student
 * profile update (protected fields, cross-school, rename → alphabetical
 * roll-number consistency).
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;

async function addStudent(t: T, S: School, first: string, sectionId: Id<"sections">) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("students", { schoolId: S.schoolId, admissionNo: `${first}-1`, firstName: first, lastName: "Z", status: "active" });
    await ctx.db.insert("enrollments", { schoolId: S.schoolId, studentId: id, academicYearId: S.yearId, classId: S.classId, sectionId, status: "active", startDate: "2026-04-01" });
    return id;
  });
}

const roster = (t: T, sectionId: Id<"sections">) => t.run(async (ctx) => {
  const es = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).collect();
  const out: [string, number | null][] = [];
  for (const e of es) out.push([(await ctx.db.get(e.studentId))!.firstName, e.rollNo ?? null]);
  return out.sort((a, b) => (a[1] ?? 99) - (b[1] ?? 99));
});

describe("reports", () => {
  test("enrollment summary counts each student once and only for the caller's school", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const dup = await addStudent(t, A, "Dev", A.sectionA);
    // A stray second active enrollment must not double-count.
    await t.run((ctx) => ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: dup, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionB, status: "active", startDate: "2026-04-01" }));
    await addStudent(t, B, "Other", B.sectionA);
    const r = await (await as(t, A.users.admin)).query(api.reports.enrollmentSummary, {});
    expect(r.enrolledThisYear).toBe(3);
    expect(r.studentsByStatus.active).toBe(3);
    expect(r.sections.reduce((a, s) => a + s.students, 0)).toBe(3);
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.reports.enrollmentSummary, {}))).toBe("FORBIDDEN");
  });

  test("attendance summary aggregates registers and counts missing ones", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await t.run((ctx) => ctx.db.insert("attendanceSessions", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, date: "2026-07-06", markedByUserId: A.users.classTeacher, markedByTeacherId: A.classTeacher, markedAt: 1, presentCount: 1, absentCount: 1, lateCount: 0, excusedCount: 0 }));
    const r = await (await as(t, A.users.admin)).query(api.reports.attendanceSummary, { from: "2026-07-06", to: "2026-07-07" }); // Mon–Tue
    const a = r.sections.find((s) => s.sectionId === A.sectionA)!;
    expect(r.schoolDays).toBe(2);
    expect(a).toMatchObject({ registers: 1, missingRegisters: 1, present: 1, absent: 1, percentage: 50 });
  });

  test("fee summary reconciles with ledgers; exam performance needs published results", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const { structureId } = await admin.mutation(api.fees.createStructure, { name: "T", classIds: [A.classId], components: [{ label: "T", amountMinor: 1000 }], installments: [{ label: "1", dueDate: "2026-05-01", amountMinor: 1000 }] });
    await admin.mutation(api.fees.setStructureStatus, { structureId, status: "active" });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: A.classId } });
    await admin.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 400, method: "cash", paidOn: "2026-06-01", clientRequestId: "rep-0000001" });
    const r = await admin.query(api.reports.feeSummary, {});
    expect(r.totals).toMatchObject({ grossMinor: 2000, paidMinor: 400, outstandingMinor: 1600 });
    expect(await errorCode((await as(t, A.users.student)).query(api.reports.feeSummary, {}))).toBe("FORBIDDEN");
    const { examId } = await admin.mutation(api.exams.create, { name: "E", classIds: [A.classId], startDate: "2026-09-01", endDate: "2026-09-02" });
    expect(await errorCode(admin.query(api.reports.examPerformance, { examId }))).toBe("CONFLICT");
  });
});

describe("student profile update", () => {
  test("admin edits personal fields; protected fields are not accepted; teachers and other schools are refused", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const r = await admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, phone: "98450 11111", bloodGroup: "o+", address: "1 Lake Road" });
    expect(r.changed.sort()).toEqual(["address", "bloodGroup", "phone"]);
    expect(await t.run((ctx) => ctx.db.get(A.studentA))).toMatchObject({ bloodGroup: "O+", status: "active", admissionNo: "alpha-Asha" });
    // Unknown fields (status, admissionNo, role…) are rejected by the validator.
    await expect(admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, status: "alumni" } as never)).rejects.toThrow(/Validator/);
    await expect(admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, admissionNo: "X" } as never)).rejects.toThrow(/Validator/);
    expect(await errorCode(admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, dateOfBirth: "2999-01-01" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, firstName: "  " }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.academics.updateStudentProfile, { studentId: B.studentA, phone: "98450 11111" }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.academics.updateStudentProfile, { studentId: A.studentA, phone: "98450 11111" }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.academics.updateStudentProfile, { studentId: A.studentA, firstName: "Me" }))).toBe("FORBIDDEN");
    // Memberships and credentials are untouched.
    expect((await t.run((ctx) => ctx.db.get(A.memberships.student)))?.role).toBe("student");
  });

  test("a rename renumbers the student's active section alphabetically, in the same transaction; other sections untouched", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await addStudent(t, A, "Mira", A.sectionA);
    await addStudent(t, A, "Zara", A.sectionA);
    // Bring 8-A into policy order first (as admissions would).
    await t.run(async (ctx) => { const { renumberSection } = await import("../../convex/model/rollNumbers"); await renumberSection(ctx, A.sectionA); });
    expect(await roster(t, A.sectionA)).toEqual([["Asha", 1], ["Mira", 2], ["Zara", 3]]);
    const before8B = await roster(t, A.sectionB);
    const r = await admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, firstName: "Yamini" });
    expect(r.renumberedSections).toBe(1);
    expect(await roster(t, A.sectionA)).toEqual([["Mira", 1], ["Yamini", 2], ["Zara", 3]]);
    expect(await roster(t, A.sectionB)).toEqual(before8B);
    // A non-name edit does not renumber.
    expect((await admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, phone: "98450 22222" })).renumberedSections).toBe(0);
    // No duplicate or missing numbers.
    const nums = (await roster(t, A.sectionA)).map(([, n]) => n);
    expect(nums).toEqual([1, 2, 3]);
  });
});
