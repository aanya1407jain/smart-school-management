/**
 * dashboards.teacherOverview — the live teacher landing page.
 * Only the signed-in teacher's own sections, lessons, homework and marks tasks.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

// A Monday, mid-morning in Asia/Kolkata (a working day in the fixture school).
const MONDAY = "2026-10-19";
beforeEach(() => { vi.useFakeTimers({ now: new Date(`${MONDAY}T05:00:00Z`), toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("teacher dashboard (live)", () => {
  test("shows only the caller's own registers, lessons, homework and marks tasks", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const ct = await as(t, A.users.classTeacher); // class teacher of 8-A, teaches maths in 8-B
    const st = await as(t, A.users.subjectTeacher); // class teacher of 8-B, teaches maths in 8-A
    const admin = await as(t, A.users.admin);

    let d = await ct.query(api.dashboards.teacherOverview, {});
    expect(d.today).toBe(MONDAY);
    expect(d.isWorkingDay).toBe(true);
    expect(d.classTeacherOf.map((s) => [s.displayName, s.registerMarked])).toEqual([["8-A", false]]);
    expect(d.assignments.map((a) => `${a.sectionName}:${a.subjectName}`)).toEqual(["8-B:Mathematics"]);
    expect(d.todayLessons).toEqual([]);

    // Register marked → reflected; another teacher's register is not shown.
    await ct.mutation(api.attendance.mark, { sectionId: A.sectionA, date: MONDAY, entries: [{ studentId: A.studentA, status: "present" }] });
    d = await ct.query(api.dashboards.teacherOverview, {});
    expect(d.classTeacherOf[0].registerMarked).toBe(true);
    expect((await st.query(api.dashboards.teacherOverview, {})).classTeacherOf.map((s) => [s.displayName, s.registerMarked])).toEqual([["8-B", false]]);

    // Timetable: a lesson today for the caller only.
    const { periodId } = await admin.mutation(api.timetable.upsertPeriod, { index: 1, label: "Period 1", startTime: "09:00", endTime: "09:45", isBreak: false });
    await admin.mutation(api.timetable.setEntry, { sectionId: A.sectionB, dayOfWeek: 1, periodId, subjectId: A.subjectId, teacherId: A.classTeacher, room: "R1" });
    d = await ct.query(api.dashboards.teacherOverview, {});
    expect(d.todayLessons.map((l) => [l.section, l.subject, l.room])).toEqual([["8-B", "Mathematics", "R1"]]);
    expect((await st.query(api.dashboards.teacherOverview, {})).todayLessons).toEqual([]);

    // Homework with a pending submission.
    const { homeworkId } = await ct.mutation(api.homework.create, { sectionId: A.sectionB, subjectId: A.subjectId, title: "Fractions", description: "Q1-5", dueDate: "2026-10-21" });
    expect((await ct.query(api.dashboards.teacherOverview, {})).homeworkToReview).toEqual([]);
    const bala = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "bala@alpha.test" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, email: "bala@x.test", displayName: "Bala", role: "student", status: "active", permissionSets: [], studentId: A.studentB });
      return userId;
    });
    await (await as(t, bala)).mutation(api.homework.submit, { homeworkId, content: "Done" });
    d = await ct.query(api.dashboards.teacherOverview, {});
    expect(d.homeworkToReview.map((h) => [h.title, h.pending])).toEqual([["Fractions", 1]]);
    expect((await st.query(api.dashboards.teacherOverview, {})).homeworkToReview).toEqual([]);

    // Marks tasks: exam open for entry with a paper the caller teaches.
    const { examId } = await admin.mutation(api.exams.create, { name: "Unit Test", classIds: [A.classId], startDate: "2026-10-20", endDate: "2026-10-24" });
    await admin.mutation(api.exams.upsertPaper, { examId, classId: A.classId, subjectId: A.subjectId, date: "2026-10-20", startTime: "09:00", endTime: "10:00", maxMarks: 50, passMarks: 17 });
    expect((await ct.query(api.dashboards.teacherOverview, {})).marksTasks).toEqual([]); // draft exam
    await admin.mutation(api.exams.setStatus, { examId, status: "in_progress" });
    const tasks = (await ct.query(api.dashboards.teacherOverview, {})).marksTasks;
    expect(tasks.map((x) => [x.label, x.entered, x.total])).toEqual([["Mathematics · Class 8-B", 0, 1]]);

    // Another school's teacher sees nothing of school A.
    const other = await (await as(t, B.users.classTeacher)).query(api.dashboards.teacherOverview, {});
    expect(other.classTeacherOf.map((s) => s.displayName)).toEqual(["8-A"]);
    expect(other.homeworkToReview).toEqual([]);
    expect(other.todayLessons).toEqual([]);
    expect(other.marksTasks).toEqual([]);
  });

  test("students and admins cannot open the teacher dashboard", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    for (const u of [A.users.student, A.users.admin]) {
      expect(await errorCode((await as(t, u)).query(api.dashboards.teacherOverview, {}))).toBe("FORBIDDEN");
    }
  });
});
