/**
 * Backend contract checks added before module work starts:
 * exam/homework statuses, periods, staff attendance, leave, curriculum,
 * document counters, clock-free attendance query, bounded/paginated queries.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  allocateNumber, counterKeys, ensureCounterAtLeast, formatAdmissionNumber, formatEmployeeId, formatReceiptNumber,
} from "../../convex/model/counters";
import { as, createSchool, errorCode, makeTest, pastMonday } from "./fixtures";

describe("status contracts", () => {
  test("exams accept the UI's full lifecycle including in_progress", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    for (const status of ["draft", "scheduled", "in_progress", "marks_entry", "published"] as const) {
      await t.run((ctx) => ctx.db.insert("exams", { schoolId: A.schoolId, academicYearId: A.yearId, name: `E-${status}`, classIds: [A.classId], startDate: "2026-09-21", endDate: "2026-09-30", status }));
    }
    await expect(t.run((ctx) => ctx.db.insert("exams", { schoolId: A.schoolId, academicYearId: A.yearId, name: "bad", classIds: [], startDate: "2026-09-21", endDate: "2026-09-30", status: "open" as never }))).rejects.toThrow();
  });

  test("homework status is canonical active | closed", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const base = { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, subjectId: A.subjectId, teacherId: A.subjectTeacher, title: "HW", description: "", assignedOn: "2026-10-01", dueDate: "2026-10-05", attachmentFileIds: [] };
    await t.run((ctx) => ctx.db.insert("homework", { ...base, status: "active" }));
    await t.run((ctx) => ctx.db.insert("homework", { ...base, status: "closed" }));
    await expect(t.run((ctx) => ctx.db.insert("homework", { ...base, status: "published" as never }))).rejects.toThrow();
    await expect(t.run((ctx) => ctx.db.insert("homework", { ...base, status: "draft" as never }))).rejects.toThrow();
  });

  test("periods, timetable entries, staff attendance and leave requests have the documented shape", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await t.run(async (ctx) => {
      const periodId = await ctx.db.insert("periods", { schoolId: A.schoolId, index: 1, label: "Period 1", startTime: "08:30", endTime: "09:15", isBreak: false });
      await ctx.db.insert("timetableEntries", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, dayOfWeek: 1, periodId, subjectId: A.subjectId, teacherId: A.subjectTeacher });
      const leaveId = await ctx.db.insert("leaveRequests", { schoolId: A.schoolId, teacherId: A.classTeacher, type: "sick", fromDate: "2026-10-12", toDate: "2026-10-13", reason: "Fever", status: "approved", requestedByUserId: A.users.classTeacher });
      await ctx.db.insert("staffAttendance", { schoolId: A.schoolId, teacherId: A.classTeacher, date: "2026-10-12", status: "on_leave", leaveRequestId: leaveId, markedByUserId: A.users.admin });
      const slot = await ctx.db.query("timetableEntries").withIndex("by_section_day_period", (q) => q.eq("sectionId", A.sectionA).eq("dayOfWeek", 1).eq("periodId", periodId)).unique();
      expect(slot?.teacherId).toBe(A.subjectTeacher);
    });
    await expect(t.run((ctx) => ctx.db.insert("leaveRequests", { schoolId: A.schoolId, teacherId: A.classTeacher, type: "vacation" as never, fromDate: "2026-10-12", toDate: "2026-10-12", reason: "", status: "pending", requestedByUserId: A.users.classTeacher }))).rejects.toThrow();
  });
});

describe("document counters", () => {
  test("allocation is sequential, per key and per school", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const got = await t.run(async (ctx) => {
      const a = [await allocateNumber(ctx, A.schoolId, "admission:2026"), await allocateNumber(ctx, A.schoolId, "admission:2026"), await allocateNumber(ctx, A.schoolId, "admission:2026")];
      const otherKey = await allocateNumber(ctx, A.schoolId, "admission:2027");
      const otherSchool = await allocateNumber(ctx, B.schoolId, "admission:2026");
      return { a, otherKey, otherSchool };
    });
    expect(got).toEqual({ a: [1, 2, 3], otherKey: 1, otherSchool: 1 });
  });

  test("concurrent allocations never hand out the same number", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const results = await Promise.all(Array.from({ length: 25 }, () => t.run((ctx) => allocateNumber(ctx, A.schoolId, counterKeys.employee()))));
    expect(new Set(results).size).toBe(25);
    expect([...results].sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  test("ensureCounterAtLeast never moves a counter backwards; bad keys are rejected", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const next = await t.run(async (ctx) => {
      await ensureCounterAtLeast(ctx, A.schoolId, "receipt:x", 40);
      await ensureCounterAtLeast(ctx, A.schoolId, "receipt:x", 10);
      return await allocateNumber(ctx, A.schoolId, "receipt:x");
    });
    expect(next).toBe(41);
    await expect(t.run((ctx) => allocateNumber(ctx, A.schoolId, "Bad Key!"))).rejects.toThrow();
  });

  test("formatters", () => {
    expect(formatAdmissionNumber({ code: "AA" }, "2026", 7)).toBe("AA-2026-0007");
    expect(formatEmployeeId({ code: "AA" }, 12)).toBe("AA-EMP-012");
    expect(formatReceiptNumber({ code: "AA" }, { name: "2026-27" }, 3)).toBe("AA/26-27/0003");
    expect(formatReceiptNumber({ code: "GPS" }, { name: "2026-2027" }, 120)).toBe("GPS/26-27/0120");
  });
});

describe("curriculum (class subjects)", () => {
  test("only academics managers can set it; ids must be in the caller's school", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.mutation(api.academics.setClassSubjects, { classId: A.classId, academicYearId: A.yearId, subjectIds: [A.subjectId] }))).toBe("FORBIDDEN");
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.academics.setClassSubjects, { classId: A.classId, academicYearId: A.yearId, subjectIds: [B.subjectId] }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.academics.setClassSubjects, { classId: B.classId, academicYearId: A.yearId, subjectIds: [] }))).toBe("NOT_FOUND");
    expect((await teacher.query(api.academics.listClassSubjects, { classId: A.classId })).map((s) => s.code)).toEqual(["MATH"]);
  });

  test("subject assignment requires the subject to be in the curriculum; assigned subjects cannot be removed", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const sci = await t.run((ctx) => ctx.db.insert("subjects", { schoolId: A.schoolId, name: "Science", code: "SCI", active: true }));
    expect(await errorCode(admin.mutation(api.academics.assignSubjectTeacher, { sectionId: A.sectionA, subjectId: sci, teacherId: A.classTeacher }))).toBe("INVALID_RELATIONSHIP");
    expect(await admin.mutation(api.academics.setClassSubjects, { classId: A.classId, academicYearId: A.yearId, subjectIds: [A.subjectId, sci] })).toEqual({ added: 1, removed: 0 });
    await admin.mutation(api.academics.assignSubjectTeacher, { sectionId: A.sectionA, subjectId: sci, teacherId: A.classTeacher });
    expect(await errorCode(admin.mutation(api.academics.setClassSubjects, { classId: A.classId, academicYearId: A.yearId, subjectIds: [A.subjectId] }))).toBe("INVALID_RELATIONSHIP");
    expect((await admin.query(api.audit.list, { action: "curriculum.updated" })).length).toBe(1);
  });

  test("a subject assignment never grants attendance ownership", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    // subjectTeacher teaches MATH in sectionA (curriculum subject) but sectionA's class teacher is classTeacher.
    const st = await as(t, A.users.subjectTeacher);
    expect(await errorCode(st.mutation(api.attendance.mark, { sectionId: A.sectionA, date: pastMonday(), entries: [{ studentId: A.studentA, status: "present" }] }))).toBe("FORBIDDEN");
  });
});

describe("attendance query contracts", () => {
  test("getByDate needs `today` and uses it only as a hint", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const ct = await as(t, A.users.classTeacher);
    const date = pastMonday();
    expect((await ct.query(api.attendance.getByDate, { sectionId: A.sectionA, date, today: date })).canMark).toBe(true);
    expect((await ct.query(api.attendance.getByDate, { sectionId: A.sectionA, date, today: "2000-01-01" })).canMark).toBe(false);
    expect(await errorCode(ct.query(api.attendance.getByDate, { sectionId: A.sectionA, date, today: "not-a-date" }))).toBe("INVALID_ARGUMENT");
    const sub = await as(t, A.users.subjectTeacher);
    expect((await sub.query(api.attendance.getByDate, { sectionId: A.sectionA, date, today: date })).canMark).toBe(false);
  });

  test("studentHistory defaults to the academic year and rejects over-long ranges", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const s = await as(t, A.users.student);
    expect((await s.query(api.attendance.studentHistory, { studentId: A.studentA })).range).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect((await s.query(api.attendance.studentHistory, { studentId: A.studentA, from: "2026-06-01" })).range.to).toBe("2027-06-01");
    expect(await errorCode(s.query(api.attendance.studentHistory, { studentId: A.studentA, from: "2025-01-01", to: "2026-06-01" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(s.query(api.attendance.studentHistory, { studentId: A.studentA, from: "2026-06-01", to: "2026-05-01" }))).toBe("INVALID_ARGUMENT");
  });
});

describe("memberships.list pagination", () => {
  test("paginates, is admin-only and school-scoped", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const p1 = await admin.query(api.memberships.list, { paginationOpts: { numItems: 3, cursor: null } });
    const p2 = await admin.query(api.memberships.list, { paginationOpts: { numItems: 3, cursor: p1.continueCursor } });
    const ids = [...p1.page, ...p2.page].map((m) => m._id as Id<"schoolMemberships">);
    expect(new Set(ids).size).toBe(5); // 5 memberships in school A, none from B
    expect(p2.isDone).toBe(true);
    expect((await admin.query(api.memberships.list, { role: "teacher", paginationOpts: { numItems: 10, cursor: null } })).page).toHaveLength(2);
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.memberships.list, { paginationOpts: { numItems: 3, cursor: null } }))).toBe("FORBIDDEN");
  });
});
