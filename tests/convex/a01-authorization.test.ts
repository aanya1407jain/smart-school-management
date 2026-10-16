/**
 * A-01 direct-call authorization across the new academic and admin modules:
 * forged / cross-school ids are NOT_FOUND, wrong roles are FORBIDDEN,
 * unauthenticated callers are rejected — all without going through the UI.
 * (Attendance ownership itself is covered by tenancy.test.ts.)
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { addDays, todayIn } from "../../convex/model/calendar";
import { isSubjectTeacherOf } from "../../convex/core/authorization";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

const TODAY = todayIn("Asia/Kolkata");

describe("A-01 direct backend calls", () => {
  test("another school's records cannot be read or changed with forged ids", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    await t.run((ctx) => ctx.db.patch(B.yearId, { startDate: addDays(TODAY, -60), endDate: addDays(TODAY, 300) }));
    const bAdmin = await as(t, B.users.admin);
    const bTeacher = await as(t, B.users.subjectTeacher);
    const { examId } = await bAdmin.mutation(api.exams.create, { name: "B exam", classIds: [B.classId], startDate: addDays(TODAY, 1), endDate: addDays(TODAY, 2) });
    const { homeworkId } = await bTeacher.mutation(api.homework.create, { sectionId: B.sectionA, subjectId: B.subjectId, title: "B hw", description: "x", dueDate: addDays(TODAY, 3) });
    const { noticeId } = await bAdmin.mutation(api.notices.createDraft, { title: "B", body: "b", type: "notice", priority: "normal", audience: { kind: "all" }, publishDate: TODAY });
    const aAdmin = await as(t, A.users.admin);
    const aStudent = await as(t, A.users.student);
    expect(await errorCode(aAdmin.query(api.exams.get, { examId }))).toBe("NOT_FOUND");
    expect(await errorCode(aAdmin.mutation(api.exams.publish, { examId }))).toBe("NOT_FOUND");
    expect(await errorCode(aAdmin.query(api.homework.submissions, { homeworkId }))).toBe("NOT_FOUND");
    expect(await errorCode(aStudent.mutation(api.homework.submit, { homeworkId }))).toBe("NOT_FOUND");
    expect(await errorCode(aAdmin.mutation(api.notices.publish, { noticeId }))).toBe("NOT_FOUND");
    expect(await errorCode(aAdmin.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND");
    expect(await errorCode(aAdmin.query(api.timetable.sectionTimetable, { sectionId: B.sectionA }))).toBe("NOT_FOUND");
    expect(await errorCode(aAdmin.query(api.fees.studentLedger, { studentId: B.studentA }))).toBe("NOT_FOUND");
  });

  test("unauthenticated callers are rejected everywhere", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    expect(await errorCode(t.query(api.fees.listStructures, {}))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.query(api.exams.list, {}))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.query(api.homework.listMine, {}))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.query(api.notices.feed, {}))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.query(api.reports.enrollmentSummary, {}))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.mutation(api.staff.applyLeave, { type: "casual", fromDate: TODAY, toDate: TODAY, reason: "x" }))).toBe("UNAUTHENTICATED");
    void A;
  });

  test("role matrix: students and guardians cannot reach staff functions", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    for (const user of [A.users.student, A.users.guardian]) {
      const c = await as(t, user);
      expect(await errorCode(c.query(api.fees.listStructures, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.exams.list, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.homework.listMine, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.staff.listLeave, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.reports.enrollmentSummary, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.mutation(api.timetable.upsertPeriod, { index: 1, label: "P", startTime: "09:00", endTime: "10:00", isBreak: false }))).toBe("FORBIDDEN");
    }
    // Teachers: no admin writes.
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.mutation(api.exams.create, { name: "x", classIds: [A.classId], startDate: "2026-09-01", endDate: "2026-09-02" }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.query(api.reports.feeSummary, {}))).toBe("FORBIDDEN");
  });

  test("subject-teacher scope comes from persisted assignments only", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    await t.run(async (ctx) => {
      expect(await isSubjectTeacherOf(ctx, A.subjectTeacher, A.sectionA, A.subjectId)).toBe(true);
      expect(await isSubjectTeacherOf(ctx, A.classTeacher, A.sectionA, A.subjectId)).toBe(false); // class teacher ≠ subject teacher
      expect(await isSubjectTeacherOf(ctx, B.subjectTeacher, A.sectionA, A.subjectId)).toBe(false);
      expect(await isSubjectTeacherOf(ctx, undefined, A.sectionA, A.subjectId)).toBe(false);
    });
  });
});
