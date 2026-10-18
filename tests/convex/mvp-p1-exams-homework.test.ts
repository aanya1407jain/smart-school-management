/**
 * P1-D / P1-F additions: exam marks-entry progress gates publication, report-card
 * data (subject names, admission number, school header), exam notifications once;
 * homework submission counts for teachers and oversight lists.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

describe("exam lifecycle and report cards", () => {
  test("progress per paper and section; publish notifies each family member once; report-card data", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const { examId } = await admin.mutation(api.exams.create, { name: "Term 1", classIds: [A.classId], startDate: "2026-10-20", endDate: "2026-10-24" });
    expect(await admin.query(api.exams.progress, { examId })).toEqual({ rows: [], ready: false });
    const { examSubjectId } = await admin.mutation(api.exams.upsertPaper, { examId, classId: A.classId, subjectId: A.subjectId, date: "2026-10-20", startTime: "09:00", endTime: "10:00", maxMarks: 50, passMarks: 17 });
    await admin.mutation(api.exams.setStatus, { examId, status: "in_progress" });
    let prog = await admin.query(api.exams.progress, { examId });
    expect(prog.rows.map((r) => [r.subject, r.section, r.entered, r.total])).toEqual([["Mathematics", "8-A", 0, 1], ["Mathematics", "8-B", 0, 1]]);
    expect(prog.ready).toBe(false);
    expect(await errorCode(admin.mutation(api.exams.publish, { examId }))).not.toBe("NO_ERROR"); // marks missing

    // 8-A maths is taught by the subject teacher; 8-B by the class teacher (fixture).
    await (await as(t, A.users.subjectTeacher)).mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionA, entries: [{ studentId: A.studentA, marks: 42, isAbsent: false }] });
    expect(await errorCode((await as(t, A.users.subjectTeacher)).mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionB, entries: [{ studentId: A.studentB, marks: 1, isAbsent: false }] }))).toBe("FORBIDDEN");
    await (await as(t, A.users.classTeacher)).mutation(api.exams.enterMarks, { examSubjectId, sectionId: A.sectionB, entries: [{ studentId: A.studentB, isAbsent: true }] });
    prog = await admin.query(api.exams.progress, { examId });
    expect(prog.ready).toBe(true);
    for (const u of [A.users.classTeacher, A.users.student]) expect(await errorCode((await as(t, u)).query(api.exams.progress, { examId }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, B.users.admin)).query(api.exams.progress, { examId }))).toBe("NOT_FOUND");

    await admin.mutation(api.exams.publish, { examId });
    expect(await errorCode(admin.mutation(api.exams.publish, { examId }))).toBe("CONFLICT");
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.dedupeKey === `exam.published:${examId}`));
    // Asha's own login and her guardian, once each; Bala has no login.
    expect(notes.map((n) => n.userId).sort()).toEqual([A.users.student, A.users.guardian].sort());

    const sec = await admin.query(api.exams.sectionResults, { examId, sectionId: A.sectionA });
    expect(JSON.stringify(sec)).toContain("Mathematics");
    expect(JSON.stringify(sec)).toContain("alpha-Asha");
    const mine = await (await as(t, A.users.student)).query(api.studentPortal.myResults, {});
    expect(mine).toMatchObject({ state: "ok", school: "School alpha", student: { name: "Asha S", admissionNo: "alpha-Asha" } });
    expect(mine.state === "ok" && mine.results.length).toBe(1);
  });
});

describe("homework oversight counts", () => {
  test("teacher list shows submitted/reviewed/students; admin oversight by section; other schools isolated", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const ct = await as(t, A.users.classTeacher);
    const { homeworkId } = await ct.mutation(api.homework.create, { sectionId: A.sectionB, subjectId: A.subjectId, title: "Fractions", description: "Q1-5", dueDate: "2026-12-21" });
    const bala = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "bala@alpha.test" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, displayName: "Bala", role: "student", status: "active", permissionSets: [], studentId: A.studentB });
      return userId;
    });
    await (await as(t, bala)).mutation(api.homework.submit, { homeworkId, content: "Done" });
    const mine = await ct.query(api.homework.listMine, {});
    expect(mine.map((h) => [h.title, h.students])).toEqual([["Fractions", 1]]);
    const admin = await as(t, A.users.admin);
    const list = await admin.query(api.homework.listForSection, { sectionId: A.sectionB });
    expect(list.map((h) => [h.title, h.submitted, h.reviewed, h.students])).toEqual([["Fractions", 1, 0, 1]]);
    expect(await errorCode((await as(t, B.users.admin)).query(api.homework.listForSection, { sectionId: A.sectionB }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.student)).query(api.homework.listForSection, { sectionId: A.sectionB }))).not.toBe("NO_ERROR");
  });
});
