/**
 * A-03 examinations: lifecycle, papers, marks-entry scope (subject teacher
 * only), validation, publication, calculations, ranking ties, visibility.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { rankByPercentage } from "../../convex/exams";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  // A second student in 8-A so ranks and ties can be checked.
  const studentC = await t.run(async (ctx) => {
    const id = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "alpha-Chitra", firstName: "Chitra", lastName: "S", status: "active" });
    await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: id, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionA, rollNo: 2, status: "active", startDate: "2026-04-01" });
    return id;
  });
  const admin = await as(t, A.users.admin);
  const { examId } = await admin.mutation(api.exams.create, { name: "Term 1", classIds: [A.classId], startDate: "2026-09-01", endDate: "2026-09-10" });
  const { examSubjectId } = await admin.mutation(api.exams.upsertPaper, { examId, classId: A.classId, subjectId: A.subjectId, date: "2026-09-02", startTime: "09:00", endTime: "11:00", maxMarks: 100, passMarks: 33 });
  return { t, A, B, admin, examId, examSubjectId, studentC };
}

describe("ranking (pure)", () => {
  test("standard competition ranking: ties share a rank, the next rank is skipped", () => {
    const r = rankByPercentage([{ id: "a", percentage: 80 }, { id: "b", percentage: 95 }, { id: "c", percentage: 80 }, { id: "d", percentage: 50 }]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
  });
});

describe("exam lifecycle and papers", () => {
  test("validation: dates inside the year/exam, subject in curriculum, pass ≤ max, no going back", async () => {
    const { t, A, B, admin, examId } = await setup();
    expect(await errorCode(admin.mutation(api.exams.create, { name: "Bad", classIds: [A.classId], startDate: "2030-01-01", endDate: "2030-01-02" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.exams.create, { name: "Term 1", classIds: [A.classId], startDate: "2026-09-01", endDate: "2026-09-02" }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.exams.create, { name: "X", classIds: [B.classId], startDate: "2026-09-01", endDate: "2026-09-02" }))).toBe("NOT_FOUND");
    const other = await t.run((ctx) => ctx.db.insert("subjects", { schoolId: A.schoolId, name: "Art", code: "ART", active: true }));
    expect(await errorCode(admin.mutation(api.exams.upsertPaper, { examId, classId: A.classId, subjectId: other, date: "2026-09-03", startTime: "09:00", endTime: "10:00", maxMarks: 50, passMarks: 10 }))).toBe("INVALID_RELATIONSHIP");
    expect(await errorCode(admin.mutation(api.exams.upsertPaper, { examId, classId: A.classId, subjectId: A.subjectId, date: "2026-10-01", startTime: "09:00", endTime: "10:00", maxMarks: 50, passMarks: 10 }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.exams.upsertPaper, { examId, classId: A.classId, subjectId: A.subjectId, date: "2026-09-03", startTime: "09:00", endTime: "10:00", maxMarks: 50, passMarks: 60 }))).toBe("INVALID_ARGUMENT");
    await admin.mutation(api.exams.setStatus, { examId, status: "in_progress" });
    expect(await errorCode(admin.mutation(api.exams.setStatus, { examId, status: "scheduled" }))).toBe("CONFLICT");
  });
});

describe("marks entry scope", () => {
  test("only the persisted subject teacher (or marks:enter:any) can enter marks; class teacher of another subject cannot", async () => {
    const { t, A, admin, examId, examSubjectId, studentC } = await setup();
    const subjectTeacher = await as(t, A.users.subjectTeacher); // teaches Maths in 8-A
    const classTeacher = await as(t, A.users.classTeacher); // owns 8-A, teaches Maths only in 8-B
    const entry = { examSubjectId, sectionId: A.sectionA, entries: [{ studentId: A.studentA, marks: 80, isAbsent: false }] };
    expect(await errorCode(subjectTeacher.mutation(api.exams.enterMarks, entry))).toBe("CONFLICT"); // not open yet
    await admin.mutation(api.exams.setStatus, { examId, status: "in_progress" });
    expect(await errorCode(classTeacher.mutation(api.exams.enterMarks, entry))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.exams.enterMarks, entry))).toBe("FORBIDDEN");
    expect((await subjectTeacher.mutation(api.exams.enterMarks, entry)).changed).toBe(1);
    // Validation: over max, half steps only, absent without marks, foreign student.
    expect(await errorCode(subjectTeacher.mutation(api.exams.enterMarks, { ...entry, entries: [{ studentId: studentC, marks: 101, isAbsent: false }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(subjectTeacher.mutation(api.exams.enterMarks, { ...entry, entries: [{ studentId: studentC, marks: 10.25, isAbsent: false }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(subjectTeacher.mutation(api.exams.enterMarks, { ...entry, entries: [{ studentId: studentC, marks: 5, isAbsent: true }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(subjectTeacher.mutation(api.exams.enterMarks, { ...entry, entries: [{ studentId: A.studentB, marks: 5, isAbsent: false }] }))).toBe("INVALID_RELATIONSHIP");
    expect(await errorCode(subjectTeacher.mutation(api.exams.enterMarks, { ...entry, entries: [{ studentId: studentC, marks: 5, isAbsent: false }, { studentId: studentC, marks: 6, isAbsent: false }] }))).toBe("INVALID_ARGUMENT");
    // Upsert, not duplicate.
    await subjectTeacher.mutation(api.exams.enterMarks, { ...entry, entries: [{ studentId: A.studentA, marks: 70, isAbsent: false }] });
    expect(await t.run(async (ctx) => (await ctx.db.query("marks").collect()).length)).toBe(1);
    const sheet = await subjectTeacher.query(api.exams.marksSheet, { examSubjectId, sectionId: A.sectionA });
    expect(sheet.students.find((s) => s.studentId === A.studentA)?.marks).toBe(70);
    expect(await errorCode(classTeacher.query(api.exams.marksSheet, { examSubjectId, sectionId: A.sectionA }))).toBe("FORBIDDEN");
  });
});

describe("publication and results", () => {
  test("publishing requires complete marks, computes percentage/grade/pass/rank with ties and absence, then locks", async () => {
    const { t, A, admin, examId, examSubjectId, studentC } = await setup();
    const teacher = await as(t, A.users.subjectTeacher);
    const other = await as(t, A.users.classTeacher); // teaches 8-B Maths
    await admin.mutation(api.exams.setStatus, { examId, status: "in_progress" });
    await teacher.mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionA, entries: [{ studentId: A.studentA, marks: 90, isAbsent: false }] });
    expect(await errorCode(admin.mutation(api.exams.publish, { examId }))).toBe("CONFLICT"); // Chitra and 8-B missing
    await teacher.mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionA, entries: [{ studentId: studentC, isAbsent: true }] });
    await other.mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionB, entries: [{ studentId: A.studentB, marks: 32.5, isAbsent: false }] });
    expect(await errorCode(teacher.mutation(api.exams.publish, { examId }))).toBe("FORBIDDEN");
    const r = await admin.mutation(api.exams.publish, { examId });
    expect(r.results).toBe(3);
    const results = await t.run(async (ctx) => ctx.db.query("results").collect());
    const asha = results.find((x) => x.studentId === A.studentA)!;
    const chitra = results.find((x) => x.studentId === studentC)!;
    const bala = results.find((x) => x.studentId === A.studentB)!;
    expect(asha).toMatchObject({ totalMarks: 90, maxMarks: 100, percentage: 90, grade: "A2", rank: 1 });
    expect(chitra).toMatchObject({ totalMarks: 0, percentage: 0, rank: 2 });
    expect(chitra.subjects[0]).toMatchObject({ isAbsent: true, passed: false });
    expect(bala).toMatchObject({ percentage: 32.5, rank: 1 });
    expect(bala.subjects[0].passed).toBe(false); // 32.5 < 33
    // Locked.
    expect(await errorCode(teacher.mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionA, entries: [{ studentId: A.studentA, marks: 10, isAbsent: false }] }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.exams.publish, { examId }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.exams.update, { examId, name: "Renamed" }))).toBe("CONFLICT");
    // Visible to the student through the portal; notifications sent once per student account.
    const mine = await (await as(t, A.users.student)).query(api.studentPortal.myResults, {});
    expect(mine.state === "ok" && mine.results[0].percentage === 90).toBe(true);
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.type === "examination"));
    expect(new Set(notes.map((n) => n.userId)).size).toBe(notes.length);
  });

  test("unpublished results are not visible to students or out-of-scope teachers", async () => {
    const { t, A, B, admin, examId } = await setup();
    const mine = await (await as(t, A.users.student)).query(api.studentPortal.myResults, {});
    expect(mine.state === "ok" && mine.results.length === 0).toBe(true);
    expect(await errorCode(admin.query(api.exams.sectionResults, { examId, sectionId: A.sectionA }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, B.users.admin)).query(api.exams.get, { examId }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.student)).query(api.exams.list, {}))).toBe("FORBIDDEN");
    const teacherList = await (await as(t, A.users.subjectTeacher)).query(api.exams.list, {});
    expect(teacherList.map((e) => e.examId)).toEqual([examId as Id<"exams">]);
  });
});
