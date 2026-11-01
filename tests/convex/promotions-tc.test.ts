/**
 * Promotions & TC workspace (convex/studentLifecycle.ts, convex/tcVerification.ts):
 * batch promotion with per-student destinations and rollback, the pass-out
 * clearance plan, and the TC draft → issue (dues gate, waiver, manual serial,
 * verification code) → void lifecycle.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { standingFrom } from "../../convex/model/examRecords";
import { as, createSchool, errorCode, makeTest, type SchoolFixture, type T } from "./fixtures";

async function nextYear(t: T, A: SchoolFixture) {
  return await t.run(async (ctx) => {
    const yearId = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });
    const class9 = await ctx.db.insert("classes", { schoolId: A.schoolId, name: "Grade 9", level: 9, active: true });
    const nineA = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: class9, name: "A", displayName: "9-A", capacity: 40 });
    const nineB = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: class9, name: "B", displayName: "9-B" });
    const eightA = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: A.classId, name: "A", displayName: "8-A" });
    return { yearId, nineA, nineB, eightA };
  });
}

/** A second student in 8-A, so a batch can split. */
async function addStudent(t: T, A: SchoolFixture, first: string) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: `X-${first}`, firstName: first, lastName: "K", status: "active" });
    await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: id, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionA, rollNo: 2, status: "active", startDate: "2026-04-01" });
    return id;
  });
}

async function assignFee(t: T, A: SchoolFixture, studentId: Id<"students">, amountMinor: number) {
  await t.run(async (ctx) => {
    const feeStructureId = await ctx.db.insert("feeStructures", { schoolId: A.schoolId, academicYearId: A.yearId, name: "Tuition", classIds: [A.classId], components: [{ label: "Tuition", amountMinor }], installments: [{ label: "Term 1", dueDate: "2026-06-30", amountMinor }], status: "active" });
    await ctx.db.insert("studentFees", { schoolId: A.schoolId, studentId, academicYearId: A.yearId, feeStructureId, label: "Term 1", amountMinor, dueDate: "2026-06-30", status: "active" });
  });
}

async function publishResult(t: T, A: SchoolFixture, studentId: Id<"students">, passed: boolean[]) {
  await t.run(async (ctx) => {
    const examId = await ctx.db.insert("exams", { schoolId: A.schoolId, academicYearId: A.yearId, name: "Annual Examination", classIds: [A.classId], startDate: "2027-02-01", endDate: "2027-02-20", status: "published", publishedAt: Date.now() } as never);
    const examSubjectId = await ctx.db.insert("examSubjects", { schoolId: A.schoolId, examId, classId: A.classId, subjectId: A.subjectId, date: "2027-02-01", startTime: "09:00", endTime: "12:00", maxMarks: 100, passMarks: 33 });
    await ctx.db.insert("results", {
      schoolId: A.schoolId, examId, studentId, sectionId: A.sectionA, totalMarks: 300, maxMarks: 400, percentage: 75, grade: "B1", publishedAt: Date.now(),
      subjects: passed.map((p) => ({ examSubjectId, subjectId: A.subjectId, marks: p ? 80 : 20, isAbsent: false, maxMarks: 100, passed: p })),
    });
  });
}

describe("standing rule", () => {
  test("all passed → eligible, one or two failed → compartment, three or more → detained", () => {
    expect([0, 1, 2, 3, 5].map(standingFrom)).toEqual(["eligible", "compartment", "compartment", "detained", "detained"]);
  });
});

describe("batch promotion with destinations and rollback", () => {
  test("plan shows result standing and fee balance; each student goes to their own section; the run rolls back", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const Y = await nextYear(t, A);
    const kiran = await addStudent(t, A, "Kiran");
    await publishResult(t, A, A.studentA, [true, false]);
    await assignFee(t, A, kiran, 250000);
    const admin = await as(t, A.users.admin);

    const plan = await admin.query(api.studentLifecycle.promotionPlan, { fromSectionId: A.sectionA, toSectionId: Y.nineA });
    const asha = plan.rows.find((r) => r.studentId === A.studentA)!;
    const k = plan.rows.find((r) => r.studentId === kiran)!;
    expect(asha).toMatchObject({ standing: "compartment", result: { examName: "Annual Examination", failedSubjects: 1 }, fees: { outstandingMinor: 0 } });
    expect(k).toMatchObject({ standing: "no_result", fees: { outstandingMinor: 250000 } });
    expect(plan.to).toMatchObject({ capacity: 40, enrolled: 0 });

    const targets = await admin.query(api.studentLifecycle.promotionTargets, { fromSectionId: A.sectionA, toAcademicYearId: Y.yearId });
    expect(targets.sections.map((s) => [s.label, s.kind])).toEqual([["8-A", "repeat"], ["9-A", "promote"], ["9-B", "promote"]]);

    const r = await admin.mutation(api.studentLifecycle.promoteBatch, { fromSectionId: A.sectionA, toAcademicYearId: Y.yearId, moves: [{ studentId: A.studentA, toSectionId: Y.nineB }, { studentId: kiran, toSectionId: Y.eightA }] });
    expect(r).toMatchObject({ promoted: 1, repeated: 1 });
    const placed = await t.run(async (ctx) => (await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", A.schoolId).eq("academicYearId", Y.yearId)).collect()).map((e) => [e.studentId, e.sectionId, e.rollNo]));
    expect(placed).toEqual(expect.arrayContaining([[A.studentA, Y.nineB, 1], [kiran, Y.eightA, 1]]));

    const runs = await admin.query(api.studentLifecycle.promotionRuns, { fromSectionId: A.sectionA });
    expect(runs[0]).toMatchObject({ status: "applied", promoted: 1, repeated: 1, rollbackBlockedBy: null });
    expect(await admin.mutation(api.studentLifecycle.rollbackPromotion, { runId: runs[0].runId })).toEqual({ restored: 2 });

    const back = await t.run(async (ctx) => (await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", A.sectionA).eq("status", "active")).collect()).map((e) => [e.studentId, e.rollNo, e.endDate ?? null]));
    expect(back).toEqual(expect.arrayContaining([[A.studentA, 1, null], [kiran, 2, null]]));
    const nextYearRows = await t.run((ctx) => ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", A.schoolId).eq("academicYearId", Y.yearId)).collect());
    expect(nextYearRows).toEqual([]);
    expect((await admin.query(api.studentLifecycle.promotionRuns, { fromSectionId: A.sectionA }))[0].status).toBe("rolled_back");
    expect(await errorCode(admin.mutation(api.studentLifecycle.rollbackPromotion, { runId: runs[0].runId }))).toBe("CONFLICT");
  });

  test("rollback is refused once the new year has records; a lower class or another year is refused", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const Y = await nextYear(t, A);
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.studentLifecycle.promoteBatch, { fromSectionId: A.sectionA, toAcademicYearId: Y.yearId, moves: [{ studentId: A.studentA, toSectionId: Y.nineA }] });
    await t.run(async (ctx) => {
      const feeStructureId = await ctx.db.insert("feeStructures", { schoolId: A.schoolId, academicYearId: Y.yearId, name: "T", classIds: [], components: [], installments: [], status: "active" });
      await ctx.db.insert("studentFees", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: Y.yearId, feeStructureId, label: "T1", amountMinor: 100, dueDate: "2027-06-30", status: "active" });
    });
    const [run] = await admin.query(api.studentLifecycle.promotionRuns, { fromSectionId: A.sectionA });
    expect(run.rollbackBlockedBy).toMatch(/Fees are already assigned/);
    expect(await errorCode(admin.mutation(api.studentLifecycle.rollbackPromotion, { runId: run.runId }))).toBe("CONFLICT");

    // A section of the current year is not a valid destination.
    const kiran = await addStudent(t, A, "Kiran");
    expect(await errorCode(admin.mutation(api.studentLifecycle.promoteBatch, { fromSectionId: A.sectionA, toAcademicYearId: Y.yearId, moves: [{ studentId: kiran, toSectionId: A.sectionB }] }))).toBe("INVALID_ARGUMENT");
  });

  test("teachers cannot plan or run promotions", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const Y = await nextYear(t, A);
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.query(api.studentLifecycle.promotionTargets, { fromSectionId: A.sectionA, toAcademicYearId: Y.yearId }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.mutation(api.studentLifecycle.promoteBatch, { fromSectionId: A.sectionA, toAcademicYearId: Y.yearId, moves: [{ studentId: A.studentA, toSectionId: Y.nineA }] }))).toBe("FORBIDDEN");
  });
});

describe("pass-out plan", () => {
  test("result and fee clearance per student", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const kiran = await addStudent(t, A, "Kiran");
    const zoya = await addStudent(t, A, "Zoya");
    await publishResult(t, A, A.studentA, [true, true]);
    await publishResult(t, A, kiran, [true, true]);
    await assignFee(t, A, kiran, 5000);
    await publishResult(t, A, zoya, [false, false, false]);
    const admin = await as(t, A.users.admin);
    const plan = await admin.query(api.studentLifecycle.passOutPlan, { sectionId: A.sectionA });
    const by = Object.fromEntries(plan.rows.map((r) => [r.studentId, r]));
    expect(by[A.studentA]).toMatchObject({ result: "passed", outstandingMinor: 0, cleared: true });
    expect(by[kiran]).toMatchObject({ result: "passed", outstandingMinor: 5000, cleared: false });
    expect(by[zoya]).toMatchObject({ result: "failed", cleared: false });
  });
});

describe("transfer certificate lifecycle", () => {
  test("draft → issue with a manual serial; verification code; void", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);

    const found = await admin.query(api.studentLifecycle.tcCandidates, { search: "asha" });
    expect(found.map((s) => s.studentId)).toEqual([A.studentA]);
    const profile = await admin.query(api.studentLifecycle.tcStudentProfile, { studentId: A.studentA });
    expect(profile).toMatchObject({ status: "active", dues: { outstandingMinor: 0 }, nextTcNo: "TC/AL/26-27/0001", snapshot: { motherName: "Parent Contact", lastSection: "8-A" } });

    const { tcId } = await admin.mutation(api.studentLifecycle.saveTransferCertificateDraft, { studentId: A.studentA, leavingDate: "2026-11-30", reason: "Parent transfer", conduct: "Exemplary" });
    // A draft changes nothing about the student.
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("active");
    const listed = await admin.query(api.studentLifecycle.transferCertificates, {});
    expect(listed[0]).toMatchObject({ status: "draft", tcNo: "", verificationCode: null });

    const issued = await admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, draftId: tcId, leavingDate: "2026-11-30", reason: "Parent transfer", conduct: "Exemplary", tcNo: "TC/AL/26-27/0042" });
    expect(issued).toEqual({ tcId, tcNo: "TC/AL/26-27/0042" });
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("transferred");
    // The counter moved past the manual number.
    expect((await admin.query(api.studentLifecycle.tcStudentProfile, { studentId: A.studentB })).nextTcNo).toBe("TC/AL/26-27/0043");

    const tc = await admin.query(api.studentLifecycle.transferCertificate, { tcId });
    expect(tc.verificationCode).toMatch(/^[0-9A-F]{16}$/);
    const anon = t; // no identity
    expect(await anon.query(api.tcVerification.verifyTransferCertificate, { code: tc.verificationCode!.toLowerCase() })).toMatchObject({ valid: true, tcNo: "TC/AL/26-27/0042", studentName: "Asha S", school: "School alpha" });
    expect(await anon.query(api.tcVerification.verifyTransferCertificate, { code: "0000000000000000" })).toBeNull();

    await admin.mutation(api.studentLifecycle.cancelTransferCertificate, { tcId, reason: "Issued by mistake" });
    expect(await anon.query(api.tcVerification.verifyTransferCertificate, { code: tc.verificationCode! })).toMatchObject({ valid: false, status: "cancelled" });
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("active");
  });

  test("dues gate: refused with a balance, issued provisionally with a documented waiver", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await assignFee(t, A, A.studentA, 120000);
    const admin = await as(t, A.users.admin);
    const base = { studentId: A.studentA, leavingDate: "2026-11-30", reason: "Relocating" };
    expect(await errorCode(admin.mutation(api.studentLifecycle.issueTransferCertificate, base))).toBe("CONFLICT");
    const r = await admin.mutation(api.studentLifecycle.issueTransferCertificate, { ...base, waiverNote: "Principal approved: family hardship" });
    const tc = await admin.query(api.studentLifecycle.transferCertificate, { tcId: r.tcId });
    expect(tc.duesWaiver).toEqual({ outstandingMinor: 120000, note: "Principal approved: family hardship" });
  });

  test("a manual serial already used is refused; a voided draft keeps the student active", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentB, leavingDate: "2026-11-30", reason: "Relocating" });
    expect(await errorCode(admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, leavingDate: "2026-11-30", reason: "Relocating", tcNo: "TC/AL/26-27/0001" }))).toBe("CONFLICT");
    const { tcId } = await admin.mutation(api.studentLifecycle.saveTransferCertificateDraft, { studentId: A.studentA, leavingDate: "2026-11-30", reason: "Relocating" });
    await admin.mutation(api.studentLifecycle.cancelTransferCertificate, { tcId, reason: "Not leaving" });
    expect((await t.run((ctx) => ctx.db.get(A.studentA)))?.status).toBe("active");
  });
});
