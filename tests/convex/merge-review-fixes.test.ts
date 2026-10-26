/**
 * Fixes from the review of PR #19 and the academics/timetable update:
 *  - studentPortal.myCertificates follows the Student Management module (like
 *    files.ts) and lists student documents only;
 *  - timetable.moveEntry moves a lesson atomically, never over another lesson,
 *    with the same clash checks as setEntry.
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;

async function studentFile(t: T, A: School, kind: "student_document" | "profile_photo", fileName: string) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([fileName]));
    return await ctx.db.insert("files", { schoolId: A.schoolId, storageId, kind, ownerType: "student", ownerId: A.studentA, fileName, contentType: "application/pdf", size: 3, uploadedByUserId: A.users.admin });
  });
}

describe("studentPortal.myCertificates", () => {
  test("lists the student's documents only (not profile photos), each with a download URL", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await studentFile(t, A, "student_document", "birth-certificate.pdf");
    await studentFile(t, A, "profile_photo", "photo.jpg");
    const res = await (await as(t, A.users.student)).query(api.studentPortal.myCertificates, {});
    expect(res.state === "ok" && res.certificates.map((c) => [c.kind, c.fileName, !!c.url])).toEqual([["student_document", "birth-certificate.pdf", true]]);
  });

  test("Student Management off → MODULE_DISABLED, like files.ts; back on → the same documents", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await studentFile(t, A, "student_document", "tc.pdf");
    const student = await as(t, A.users.student);
    await t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ["administration"], updatedBy: "test", reason: "review fix" });
    expect(await errorCode(student.query(api.files.listForOwner, { ownerType: "student", ownerId: A.studentA }))).toBe("MODULE_DISABLED");
    expect(await errorCode(student.query(api.studentPortal.myCertificates, {}))).toBe("MODULE_DISABLED");
    await t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ["students", "academics", "attendance", "finance", "administration"], updatedBy: "test", reason: "review fix" });
    const res = await student.query(api.studentPortal.myCertificates, {});
    expect(res.state === "ok" && res.certificates.map((c) => c.fileName)).toEqual(["tc.pdf"]);
  });

  test("another student's documents are not reachable", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await studentFile(t, A, "student_document", "asha.pdf");
    expect(await errorCode((await as(t, A.users.student)).query(api.studentPortal.myCertificates, { studentId: A.studentB }))).toBe("NOT_FOUND");
  });
});

describe("timetable.moveEntry", () => {
  async function setup() {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const p1 = (await admin.mutation(api.timetable.upsertPeriod, { index: 1, label: "Period 1", startTime: "09:00", endTime: "09:45", isBreak: false })).periodId;
    const p2 = (await admin.mutation(api.timetable.upsertPeriod, { index: 2, label: "Period 2", startTime: "09:45", endTime: "10:30", isBreak: false })).periodId;
    const brk = (await admin.mutation(api.timetable.upsertPeriod, { index: 3, label: "Break", startTime: "10:30", endTime: "10:45", isBreak: true })).periodId;
    const lesson = (sectionId: Id<"sections">, teacherId: Id<"teachers">, dayOfWeek: number, periodId: Id<"periods">, room?: string) =>
      admin.mutation(api.timetable.setEntry, { sectionId, dayOfWeek, periodId, subjectId: A.subjectId, teacherId, ...(room ? { room } : {}) });
    return { t, A, B, admin, p1, p2, brk, lesson };
  }
  const entryOf = (t: T, id: Id<"timetableEntries">) => t.run((ctx) => ctx.db.get(id));

  test("moves one lesson in one step (no copy left behind) and is audited", async () => {
    const { t, A, admin, p1, p2, lesson } = await setup();
    const { entryId } = await lesson(A.sectionA, A.subjectTeacher, 1, p1, "R1");
    expect(await admin.mutation(api.timetable.moveEntry, { entryId, dayOfWeek: 2, periodId: p2 })).toEqual({ entryId, moved: true });
    expect(await entryOf(t, entryId)).toMatchObject({ dayOfWeek: 2, periodId: p2, room: "R1", teacherId: A.subjectTeacher });
    expect(await t.run(async (ctx) => (await ctx.db.query("timetableEntries").collect()).length)).toBe(1);
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", A.schoolId).eq("action", "timetable.entry_moved")).collect());
    expect(audit).toHaveLength(1);
  });

  test("never moves onto another lesson, a break, a non-working day or a clash; nothing changes on refusal", async () => {
    const { t, A, admin, p1, p2, brk, lesson } = await setup();
    const a1 = (await lesson(A.sectionA, A.subjectTeacher, 1, p1, "Lab 1")).entryId;
    await lesson(A.sectionA, A.subjectTeacher, 1, p2); // occupies 8-A Monday P2
    await lesson(A.sectionB, A.classTeacher, 2, p1, "Lab 1"); // 8-B uses Lab 1 on Tuesday P1
    expect(await errorCode(admin.mutation(api.timetable.moveEntry, { entryId: a1, dayOfWeek: 1, periodId: p2 }))).toBe("CONFLICT"); // occupied
    expect(await errorCode(admin.mutation(api.timetable.moveEntry, { entryId: a1, dayOfWeek: 1, periodId: brk }))).toBe("INVALID_ARGUMENT"); // break
    expect(await errorCode(admin.mutation(api.timetable.moveEntry, { entryId: a1, dayOfWeek: 0, periodId: p1 }))).toBe("INVALID_ARGUMENT"); // Sunday
    expect(await errorCode(admin.mutation(api.timetable.moveEntry, { entryId: a1, dayOfWeek: 2, periodId: p1 }))).toBe("CONFLICT"); // room clash
    expect(await entryOf(t, a1)).toMatchObject({ dayOfWeek: 1, periodId: p1 });
    expect(await t.run(async (ctx) => (await ctx.db.query("timetableEntries").collect()).length)).toBe(3);
  });

  test("teacher clash with another section is refused", async () => {
    const { admin, A, p1, p2, lesson } = await setup();
    // classTeacher teaches 8-B (fixture assignment); give them 8-A too for this test.
    await admin.mutation(api.academics.assignSubjectTeacher, { sectionId: A.sectionA, subjectId: A.subjectId, teacherId: A.classTeacher }).catch(() => undefined);
    const a = (await lesson(A.sectionA, A.classTeacher, 1, p2)).entryId;
    await lesson(A.sectionB, A.classTeacher, 1, p1);
    expect(await errorCode(admin.mutation(api.timetable.moveEntry, { entryId: a, dayOfWeek: 1, periodId: p1 }))).toBe("CONFLICT");
  });

  test("authorization, tenancy and module", async () => {
    const { t, A, B, admin, p1, p2, lesson } = await setup();
    const { entryId } = await lesson(A.sectionA, A.subjectTeacher, 1, p1);
    expect(await errorCode((await as(t, A.users.subjectTeacher)).mutation(api.timetable.moveEntry, { entryId, dayOfWeek: 2, periodId: p2 }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, B.users.admin)).mutation(api.timetable.moveEntry, { entryId, dayOfWeek: 2, periodId: p2 }))).toBe("NOT_FOUND");
    await t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ["students", "attendance", "finance", "administration"], updatedBy: "test", reason: "review fix" });
    expect(await errorCode(admin.mutation(api.timetable.moveEntry, { entryId, dayOfWeek: 2, periodId: p2 }))).toBe("MODULE_DISABLED");
  });

  test("teacherTimetable (builder 'By teacher' view): the teacher's lessons across sections; managers only; school-scoped", async () => {
    const { t, A, B, admin, p1, p2, lesson } = await setup();
    await lesson(A.sectionA, A.subjectTeacher, 1, p1, "R1");
    await lesson(A.sectionB, A.classTeacher, 2, p2);
    const week = await admin.query(api.timetable.teacherTimetable, { teacherId: A.subjectTeacher });
    expect(week.lessons.map((l) => [l.section, l.dayOfWeek, l.room])).toEqual([["8-A", 1, "R1"]]);
    expect(week.periods.map((p) => p.label)).toEqual(expect.arrayContaining(["Period 1", "Period 2", "Break"]));
    // Same data as the teacher's own view.
    expect((await (await as(t, A.users.subjectTeacher)).query(api.timetable.myTimetable, {})).lessons).toEqual(week.lessons);
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.timetable.teacherTimetable, { teacherId: A.subjectTeacher }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, B.users.admin)).query(api.timetable.teacherTimetable, { teacherId: A.subjectTeacher }))).toBe("NOT_FOUND");
  });
});

describe("timetableMaintenance.addBreaks (bell-schedule operator tool)", () => {
  test("inserts breaks into the gaps, renumbers by time, keeps lessons on their periods; overlaps refused; re-run is a no-op", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const p1 = (await admin.mutation(api.timetable.upsertPeriod, { index: 1, label: "Period 1", startTime: "08:30", endTime: "09:15", isBreak: false })).periodId;
    const p2 = (await admin.mutation(api.timetable.upsertPeriod, { index: 2, label: "Period 2", startTime: "10:15", endTime: "11:00", isBreak: false })).periodId;
    const { entryId } = await admin.mutation(api.timetable.setEntry, { sectionId: A.sectionA, dayOfWeek: 1, periodId: p2, subjectId: A.subjectId, teacherId: A.subjectTeacher });
    const breaks = [{ label: "Short break", startTime: "09:15", endTime: "10:15" }];

    expect(await errorCode(t.mutation(internal.timetableMaintenance.addBreaks, { schoolSlug: "alpha", breaks: [{ label: "Bad", startTime: "09:00", endTime: "09:30" }] }))).toBe("CONFLICT");
    const dry = await t.mutation(internal.timetableMaintenance.addBreaks, { schoolSlug: "alpha", breaks, dryRun: true });
    expect(dry.schedule).toEqual(["1. Period 1 08:30", "2. Short break 09:15 (new break)", "3. Period 2 10:15"]);
    expect((await admin.query(api.timetable.listPeriods, {})).length).toBe(2);

    expect(await t.mutation(internal.timetableMaintenance.addBreaks, { schoolSlug: "alpha", breaks })).toMatchObject({ added: 1 });
    const periods = (await admin.query(api.timetable.listPeriods, {})).sort((a, b) => a.index - b.index);
    expect(periods.map((p) => [p.index, p.label, p.isBreak])).toEqual([[1, "Period 1", false], [2, "Short break", true], [3, "Period 2", false]]);
    expect(periods[0].periodId).toBe(p1);
    expect((await t.run((ctx) => ctx.db.get(entryId)))?.periodId).toBe(p2); // the lesson did not move
    expect(await t.mutation(internal.timetableMaintenance.addBreaks, { schoolSlug: "alpha", breaks })).toMatchObject({ added: 0, toAdd: 0 });
  });
});
