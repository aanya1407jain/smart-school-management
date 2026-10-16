/**
 * A-04 timetable (validation, clashes, scoped reads) and homework (scope,
 * deadlines, own submissions, review, attachments through the upload
 * pipeline, notifications).
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { addDays, todayIn } from "../../convex/model/calendar";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;
const TODAY = todayIn("Asia/Kolkata");

/** Make the fixture year span today so date rules ("not in the past", "within the year") are testable on any day. */
async function yearAroundToday(t: T, S: School) {
  await t.run((ctx) => ctx.db.patch(S.yearId, { startDate: addDays(TODAY, -60), endDate: addDays(TODAY, 300) }));
}

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  await yearAroundToday(t, A);
  const admin = await as(t, A.users.admin);
  const p1 = await admin.mutation(api.timetable.upsertPeriod, { index: 1, label: "Period 1", startTime: "09:00", endTime: "09:45", isBreak: false });
  const brk = await admin.mutation(api.timetable.upsertPeriod, { index: 2, label: "Break", startTime: "09:45", endTime: "10:00", isBreak: true });
  return { t, A, B, admin, p1: p1.periodId, brk: brk.periodId };
}

describe("timetable", () => {
  test("periods cannot overlap or reuse a position", async () => {
    const { admin } = await setup();
    expect(await errorCode(admin.mutation(api.timetable.upsertPeriod, { index: 3, label: "X", startTime: "09:30", endTime: "10:30", isBreak: false }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.timetable.upsertPeriod, { index: 1, label: "Y", startTime: "11:00", endTime: "11:30", isBreak: false }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.timetable.upsertPeriod, { index: 4, label: "Z", startTime: "12:00", endTime: "11:00", isBreak: false }))).toBe("INVALID_ARGUMENT");
  });

  test("lessons need an assigned teacher, a curriculum subject, a working day and a non-break period", async () => {
    const { t, A, B, admin, p1, brk } = await setup();
    const ok = { sectionId: A.sectionA, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.subjectTeacher, room: "R1" };
    expect((await admin.mutation(api.timetable.setEntry, ok)).replaced).toBe(false);
    expect(await errorCode(admin.mutation(api.timetable.setEntry, { ...ok, teacherId: A.classTeacher }))).toBe("INVALID_RELATIONSHIP"); // not assigned to Maths in 8-A
    expect(await errorCode(admin.mutation(api.timetable.setEntry, { ...ok, periodId: brk }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.timetable.setEntry, { ...ok, dayOfWeek: 0 }))).toBe("INVALID_ARGUMENT"); // Sunday not a working day
    expect(await errorCode(admin.mutation(api.timetable.setEntry, { ...ok, teacherId: B.subjectTeacher }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.subjectTeacher)).mutation(api.timetable.setEntry, ok))).toBe("FORBIDDEN");
    // Same slot again replaces (no duplicate lesson).
    expect((await admin.mutation(api.timetable.setEntry, { ...ok, room: "R2" })).replaced).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.query("timetableEntries").collect()).length)).toBe(1);
  });

  test("teacher and room clashes across sections are rejected", async () => {
    const { t, A, admin, p1 } = await setup();
    // Subject teacher also teaches Maths in 8-B for this test.
    await t.run((ctx) => ctx.db.insert("teacherAssignments", { schoolId: A.schoolId, academicYearId: A.yearId, teacherId: A.subjectTeacher, subjectId: A.subjectId, classId: A.classId, sectionId: A.sectionB }));
    await admin.mutation(api.timetable.setEntry, { sectionId: A.sectionA, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.subjectTeacher, room: "Lab 1" });
    expect(await errorCode(admin.mutation(api.timetable.setEntry, { sectionId: A.sectionB, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.subjectTeacher }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.timetable.setEntry, { sectionId: A.sectionB, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.classTeacher, room: "lab 1" }))).toBe("CONFLICT");
    expect((await admin.mutation(api.timetable.setEntry, { sectionId: A.sectionB, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.classTeacher, room: "Lab 2" })).replaced).toBe(false);
  });

  test("reads are scoped: teacher own week + own sections; students use the portal", async () => {
    const { t, A, admin, p1 } = await setup();
    await admin.mutation(api.timetable.setEntry, { sectionId: A.sectionA, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.subjectTeacher });
    const teacher = await as(t, A.users.subjectTeacher);
    expect((await teacher.query(api.timetable.myTimetable, {})).lessons).toHaveLength(1);
    expect((await teacher.query(api.timetable.sectionTimetable, { sectionId: A.sectionA })).lessons).toHaveLength(1);
    const student = await as(t, A.users.student);
    expect(await errorCode(student.query(api.timetable.sectionTimetable, { sectionId: A.sectionA }))).toBe("FORBIDDEN");
    const mine = await student.query(api.studentPortal.myTimetable, {});
    expect(mine.state === "ok" && mine.lessons.length === 1).toBe(true);
  });
});

describe("homework lifecycle", () => {
  test("only the subject teacher of the section sets homework; deadlines validated; students notified once", async () => {
    const { t, A, B } = await setup();
    const teacher = await as(t, A.users.subjectTeacher);
    const classTeacher = await as(t, A.users.classTeacher);
    const hw = { sectionId: A.sectionA, subjectId: A.subjectId, title: "Fractions", description: "Ex 3.1", dueDate: addDays(TODAY, 7) };
    expect(await errorCode(classTeacher.mutation(api.homework.create, hw))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.admin)).mutation(api.homework.create, hw))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.mutation(api.homework.create, { ...hw, dueDate: addDays(TODAY, -1) }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(teacher.mutation(api.homework.create, { ...hw, sectionId: B.sectionA }))).toBe("NOT_FOUND");
    const { homeworkId } = await teacher.mutation(api.homework.create, hw);
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.type === "homework"));
    // Asha's own account + her guardian.
    expect(notes.map((n) => n.userId).sort()).toEqual([A.users.student, A.users.guardian].sort());
    expect(await errorCode(classTeacher.mutation(api.homework.update, { homeworkId, title: "Hijack" }))).toBe("FORBIDDEN");
    expect((await teacher.query(api.homework.listMine, {})).map((h) => h.homeworkId)).toEqual([homeworkId]);
  });

  test("students submit only their own work for their section; guardians cannot submit; review notifies once", async () => {
    const { t, A } = await setup();
    const teacher = await as(t, A.users.subjectTeacher);
    const { homeworkId } = await teacher.mutation(api.homework.create, { sectionId: A.sectionA, subjectId: A.subjectId, title: "Essay", description: "Write", dueDate: addDays(TODAY, 3) });
    const student = await as(t, A.users.student);
    const guardian = await as(t, A.users.guardian);
    expect(await errorCode(guardian.mutation(api.homework.submit, { homeworkId, content: "x" }))).toBe("FORBIDDEN");
    // A student of another section cannot see or submit it.
    const otherUser = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { email: "b@x.test" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: u, email: "b@x.test", displayName: "Bala", role: "student", status: "active", permissionSets: [], studentId: A.studentB });
      return u;
    });
    const other = await as(t, otherUser);
    expect(await errorCode(other.mutation(api.homework.submit, { homeworkId, content: "x" }))).toBe("NOT_FOUND");
    expect(await errorCode(other.query(api.homework.get, { homeworkId }))).toBe("NOT_FOUND");
    const s1 = await student.mutation(api.homework.submit, { homeworkId, content: "My essay" });
    expect(s1.status).toBe("submitted");
    const again = await student.mutation(api.homework.submit, { homeworkId, content: "Edited" });
    expect(again.submissionId).toBe(s1.submissionId);
    expect(await errorCode(student.query(api.homework.submissions, { homeworkId }))).toBe("FORBIDDEN");
    const subs = await teacher.query(api.homework.submissions, { homeworkId });
    expect(subs.students.find((s) => s.studentId === A.studentA)?.submission?.content).toBe("Edited");
    await teacher.mutation(api.homework.review, { submissionId: s1.submissionId, feedback: "Good" });
    await teacher.mutation(api.homework.review, { submissionId: s1.submissionId, feedback: "Good!" });
    const reviews = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.title === "Homework reviewed"));
    expect(reviews).toHaveLength(2); // student + guardian, once each despite two reviews
    expect(await errorCode(student.mutation(api.homework.submit, { homeworkId, content: "late edit" }))).toBe("CONFLICT");
    const own = await student.query(api.homework.get, { homeworkId });
    expect(own.submission?.feedback).toBe("Good!");
    await teacher.mutation(api.homework.close, { homeworkId });
    expect(await errorCode(student.mutation(api.homework.submit, { homeworkId }))).toBe("CONFLICT");
  });

  test("late submissions are marked late", async () => {
    const { t, A } = await setup();
    const teacher = await as(t, A.users.subjectTeacher);
    const { homeworkId } = await teacher.mutation(api.homework.create, { sectionId: A.sectionA, subjectId: A.subjectId, title: "Old", description: "x", dueDate: TODAY });
    await t.run((ctx) => ctx.db.patch(homeworkId, { dueDate: addDays(TODAY, -2), assignedOn: addDays(TODAY, -5) }));
    expect((await (await as(t, A.users.student)).mutation(api.homework.submit, { homeworkId, content: "sorry" })).status).toBe("late");
  });
});

describe("attachments through the upload pipeline", () => {
  test("teacher attaches to own homework; student to own submission; others are refused; files are linked and readable in scope", async () => {
    const { t, A } = await setup();
    const teacher = await as(t, A.users.subjectTeacher);
    const student = await as(t, A.users.student);
    const { homeworkId } = await teacher.mutation(api.homework.create, { sectionId: A.sectionA, subjectId: A.subjectId, title: "Worksheet", description: "x", dueDate: addDays(TODAY, 5) });
    // convex-test does not record a blob's content type in `_storage` (production Convex does), so the
    // harness sets it on the system row the way the real upload endpoint would.
    const store = (type: string) => t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["%PDF-1.4 test"], { type }));
      await (ctx.db as unknown as { patch: (id: string, v: object) => Promise<void> }).patch(id, { contentType: type });
      return id;
    });
    const sid = await store("application/pdf");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.files.register, { storageId: sid, kind: "homework_attachment", ownerType: "homework", ownerId: homeworkId, fileName: "a.pdf" }))).toBe("FORBIDDEN");
    const fileId = await teacher.mutation(api.files.register, { storageId: sid, kind: "homework_attachment", ownerType: "homework", ownerId: homeworkId, fileName: "worksheet.pdf" });
    expect((await t.run((ctx) => ctx.db.get(homeworkId)))?.attachmentFileIds).toEqual([fileId]);
    expect((await student.query(api.files.getUrl, { fileId })).fileName).toBe("worksheet.pdf");
    // Wrong type is rejected and the blob removed.
    const bad = await store("text/html");
    expect(await errorCode(teacher.mutation(api.files.register, { storageId: bad, kind: "homework_attachment", ownerType: "homework", ownerId: homeworkId, fileName: "x.html" }))).toBe("INVALID_ARGUMENT");
    // Student submission attachment.
    const { submissionId } = await student.mutation(api.homework.submit, { homeworkId, content: "done" });
    const s2 = await store("image/png");
    expect(await errorCode(teacher.mutation(api.files.register, { storageId: s2, kind: "submission_attachment", ownerType: "submission", ownerId: submissionId, fileName: "x.png" }))).toBe("FORBIDDEN");
    const subFile = await student.mutation(api.files.register, { storageId: s2, kind: "submission_attachment", ownerType: "submission", ownerId: submissionId, fileName: "answer.png" });
    expect((await teacher.query(api.files.getUrl, { fileId: subFile })).fileName).toBe("answer.png");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.files.getUrl, { fileId: subFile }))).toBe("NOT_FOUND");
    // Registering the same upload twice is refused.
    expect(await errorCode(student.mutation(api.files.register, { storageId: s2, kind: "submission_attachment", ownerType: "submission", ownerId: submissionId, fileName: "again.png" }))).toBe("CONFLICT");
  });
});
