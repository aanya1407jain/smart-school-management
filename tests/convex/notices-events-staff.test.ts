/**
 * A-05 notices (lifecycle, audience, teacher scope, no leaks, notify once),
 * events (holiday rules, audience) and staff attendance / leave workflows.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { addDays, todayIn } from "../../convex/model/calendar";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

const TODAY = todayIn("Asia/Kolkata");

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  return { t, A, B, admin: await as(t, A.users.admin) };
}

const base = { title: "Sports day", body: "Wear whites", type: "notice" as const, priority: "normal" as const, publishDate: TODAY };

describe("notices", () => {
  test("draft → publish → archive; drafts never leak; published reaches only its audience; notified once", async () => {
    const { t, A, admin } = await setup();
    const { noticeId } = await admin.mutation(api.notices.createDraft, { ...base, audience: { kind: "sections", sectionIds: [A.sectionB] } });
    const student = await as(t, A.users.student); // Asha, 8-A
    expect(await errorCode(student.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND");
    expect((await student.query(api.notices.feed, {})).length).toBe(0);
    await admin.mutation(api.notices.publish, { noticeId });
    await admin.mutation(api.notices.publish, { noticeId }); // idempotent
    expect(await errorCode(student.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND"); // 8-B notice, Asha is in 8-A
    const portal = await student.query(api.studentPortal.myNotices, { today: TODAY });
    expect(portal.state === "ok" && portal.notices.length === 0).toBe(true);
    const ct = await as(t, A.users.subjectTeacher); // owns 8-B
    expect((await ct.query(api.notices.feed, {})).map((n) => n.noticeId)).toEqual([noticeId]);
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.type === "notice"));
    expect(new Set(notes.map((n) => n.userId)).size).toBe(notes.length);
    expect(notes.some((n) => n.userId === A.users.student)).toBe(false);
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, title: "x" }))).toBe("CONFLICT");
    await admin.mutation(api.notices.archive, { noticeId });
    expect(await ct.query(api.notices.feed, {})).toEqual([]);
    expect(await errorCode(admin.mutation(api.notices.publish, { noticeId }))).toBe("CONFLICT");
  });

  test("teachers write class-specific notices only for their own sections and only edit their own", async () => {
    const { t, A, B, admin } = await setup();
    const teacher = await as(t, A.users.subjectTeacher); // scope: 8-A (Maths) + 8-B (class teacher)
    expect(await errorCode(teacher.mutation(api.notices.createDraft, { ...base, audience: { kind: "all" } }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.mutation(api.notices.createDraft, { ...base, audience: { kind: "sections", sectionIds: [B.sectionA] } }))).toBe("NOT_FOUND");
    const outside = await t.run((ctx) => ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: A.yearId, classId: A.classId, name: "C", displayName: "8-C" }));
    expect(await errorCode(teacher.mutation(api.notices.createDraft, { ...base, audience: { kind: "sections", sectionIds: [outside] } }))).toBe("FORBIDDEN");
    const { noticeId } = await teacher.mutation(api.notices.createDraft, { ...base, audience: { kind: "sections", sectionIds: [A.sectionA] } });
    const other = await as(t, A.users.classTeacher);
    expect(await errorCode(other.mutation(api.notices.publish, { noticeId }))).toBe("FORBIDDEN");
    await teacher.mutation(api.notices.publish, { noticeId });
    const portal = await (await as(t, A.users.guardian)).query(api.studentPortal.myNotices, { today: TODAY });
    expect(portal.state === "ok" && portal.notices.map((n) => n.noticeId)).toEqual([noticeId]);
    expect((await admin.query(api.notices.listManaged, {})).map((n) => n.noticeId)).toContain(noticeId);
    expect((await other.query(api.notices.listManaged, {})).length).toBe(0);
  });

  test("future-dated and expired notices are not shown; students cannot write", async () => {
    const { t, A, admin } = await setup();
    const future = await admin.mutation(api.notices.createDraft, { ...base, publishDate: addDays(TODAY, 3), audience: { kind: "all" } });
    await admin.mutation(api.notices.publish, { noticeId: future.noticeId });
    const student = await as(t, A.users.student);
    expect(await student.query(api.notices.feed, {})).toEqual([]);
    expect(await errorCode(admin.mutation(api.notices.createDraft, { ...base, expiresOn: addDays(TODAY, -1), audience: { kind: "all" } }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(student.mutation(api.notices.createDraft, { ...base, audience: { kind: "all" } }))).toBe("FORBIDDEN");
  });
});

describe("events", () => {
  test("only managers create; holidays are school-wide and cannot cover a marked register date", async () => {
    const { t, A, admin } = await setup();
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.events.create, { title: "PTM", kind: "meeting", startDate: TODAY, endDate: TODAY, audience: { kind: "all" } }))).toBe("FORBIDDEN");
    expect(await errorCode(admin.mutation(api.events.create, { title: "H", kind: "holiday", startDate: TODAY, endDate: TODAY, audience: { kind: "sections", sectionIds: [A.sectionA] } }))).toBe("INVALID_ARGUMENT");
    await t.run((ctx) => ctx.db.insert("attendanceSessions", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, date: "2026-07-01", markedByUserId: A.users.classTeacher, markedByTeacherId: A.classTeacher, markedAt: 1, presentCount: 1, absentCount: 0, lateCount: 0, excusedCount: 0 }));
    expect(await errorCode(admin.mutation(api.events.create, { title: "H", kind: "holiday", startDate: "2026-07-01", endDate: "2026-07-02", audience: { kind: "all" } }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.events.create, { title: "Long", kind: "event", startDate: "2026-07-01", endDate: "2026-12-31", audience: { kind: "all" } }))).toBe("INVALID_ARGUMENT");
    await admin.mutation(api.events.create, { title: "Science fair", kind: "event", startDate: "2026-11-02", endDate: "2026-11-03", audience: { kind: "sections", sectionIds: [A.sectionB] } });
    expect((await (await as(t, A.users.student)).query(api.events.list, { from: "2026-11-01", to: "2026-11-30" })).length).toBe(0);
    expect((await (await as(t, A.users.subjectTeacher)).query(api.events.list, { from: "2026-11-01", to: "2026-11-30" })).length).toBe(1);
  });
});

describe("staff attendance and leave", () => {
  test("teachers apply for their own leave; managers decide; overlaps rejected; decision notifies once", async () => {
    const { t, A, B, admin } = await setup();
    const teacher = await as(t, A.users.classTeacher);
    const { leaveRequestId } = await teacher.mutation(api.staff.applyLeave, { type: "casual", fromDate: "2026-11-02", toDate: "2026-11-03", reason: "Family" });
    expect(await errorCode(teacher.mutation(api.staff.applyLeave, { type: "sick", fromDate: "2026-11-03", toDate: "2026-11-04", reason: "x" }))).toBe("CONFLICT");
    expect(await errorCode(teacher.mutation(api.staff.decideLeave, { leaveRequestId, decision: "approved" }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, B.users.admin)).mutation(api.staff.decideLeave, { leaveRequestId, decision: "approved" }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.staff.applyLeave, { type: "casual", fromDate: "2026-11-02", toDate: "2026-11-02", reason: "x" }))).toBe("FORBIDDEN");
    await admin.mutation(api.staff.decideLeave, { leaveRequestId, decision: "approved", note: "OK" });
    expect(await errorCode(admin.mutation(api.staff.decideLeave, { leaveRequestId, decision: "rejected" }))).toBe("CONFLICT");
    expect((await teacher.query(api.staff.myLeave, {}))[0]).toMatchObject({ status: "approved", decisionNote: "OK" });
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.title === "Leave approved"));
    expect(notes.map((n) => n.userId)).toEqual([A.users.classTeacher]);
  });

  test("staff attendance: managers only, no future dates, upsert per teacher/day, approved leave shown", async () => {
    const { t, A, B, admin } = await setup();
    const teacher = await as(t, A.users.classTeacher);
    await teacher.mutation(api.staff.applyLeave, { type: "sick", fromDate: "2026-07-01", toDate: "2026-07-01", reason: "Fever" });
    const pending = await admin.query(api.staff.listLeave, { status: "pending" });
    await admin.mutation(api.staff.decideLeave, { leaveRequestId: pending[0].leaveRequestId, decision: "approved" });
    expect(await errorCode(teacher.mutation(api.staff.markStaffAttendance, { date: "2026-07-01", entries: [{ teacherId: A.classTeacher, status: "present" }] }))).toBe("FORBIDDEN");
    expect(await errorCode(admin.mutation(api.staff.markStaffAttendance, { date: addDays(TODAY, 2), entries: [{ teacherId: A.classTeacher, status: "present" }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.staff.markStaffAttendance, { date: "2026-07-01", entries: [{ teacherId: B.classTeacher, status: "present" }] }))).toBe("NOT_FOUND");
    await admin.mutation(api.staff.markStaffAttendance, { date: "2026-07-01", entries: [{ teacherId: A.classTeacher, status: "on_leave" }, { teacherId: A.subjectTeacher, status: "present" }] });
    await admin.mutation(api.staff.markStaffAttendance, { date: "2026-07-01", entries: [{ teacherId: A.subjectTeacher, status: "absent" }] });
    const day = await admin.query(api.staff.staffAttendanceByDate, { date: "2026-07-01" });
    expect(day.find((d) => d.teacherId === A.classTeacher)).toMatchObject({ status: "on_leave", approvedLeave: { type: "sick" } });
    expect(day.find((d) => d.teacherId === A.subjectTeacher)?.status).toBe("absent");
    expect(await t.run(async (ctx) => (await ctx.db.query("staffAttendance").collect()).length)).toBe(2);
  });
});
