/**
 * In-process tests for Notices, Audience Targeting, Events and the in-app
 * notifications they produce (AP-02), against the final API:
 *  - notices: createDraft → update (drafts only) → publish (immediate or on the
 *    publish date via the scheduler) → archive → restore (always back to DRAFT;
 *    republishing is required) — never hard-deleted; readers use `feed` / `get`,
 *    managers and authors use `listManaged`;
 *  - events: convex/events.ts (`create`, `list`);
 *  - notifications: list / unreadCount / markRead / markAllRead / remove /
 *    clearAll — always the caller's own inbox in the caller's school.
 *
 * The first four tests are PR #11's original scenarios (lifecycle, audience
 * targeting, urgent notification, events), kept and strengthened; the rest
 * cover validation, scheduled publication, authorship / tenant isolation,
 * notification ownership and invalid ids.
 * Run with: npx vitest run tests/convex/notices.test.ts
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { addDays, todayIn } from "../../convex/model/calendar";
import { startOfDayMs } from "../../convex/notices";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type Client = Awaited<ReturnType<typeof as>>;
type Audience = FunctionArgs<typeof api.notices.createDraft>["audience"];

const PAST = "2026-04-01"; // inside the fixture year and already visible today
const draft = (title: string, audience: Audience, extra: Partial<FunctionArgs<typeof api.notices.createDraft>> = {}) => ({
  title, body: `${title} — details`, type: "notice" as const, priority: "normal" as const, audience, publishDate: PAST, ...extra,
});

const feedIds = async (c: Client) => new Set((await c.query(api.notices.feed, {})).map((n) => n.noticeId as Id<"notices">));
const noticeRow = (t: T, id: Id<"notices">) => t.run((ctx) => ctx.db.get(id));
/** Notice notifications in the database for one notice (dedupe key `notice.published:<id>`). */
const noticeNotifications = (t: T, id: Id<"notices">) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.dedupeKey === `notice.published:${id}`));

afterEach(() => {
  vi.useRealTimers();
});

describe("Notices and school events (AP-02)", () => {
  // ---------------------------------------------------------------- original scenario 1
  test("lifecycle: draft, publish, archive, restore to draft, republish — never hard-deleted", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-1");
    const admin = await as(t, f.users.admin);
    const teacher = await as(t, f.users.classTeacher);

    // A teacher cannot address the whole staff (only their own sections); nothing is written.
    expect(await errorCode(teacher.mutation(api.notices.createDraft, draft("Staff Meeting", { kind: "roles", roles: ["teacher"] }, { publishDate: "2026-05-01" })))).toBe("FORBIDDEN");
    expect(await t.run(async (ctx) => (await ctx.db.query("notices").collect()).length)).toBe(0);

    const { noticeId } = await admin.mutation(api.notices.createDraft, draft("Science Fair 2026", { kind: "all" }, { type: "event" }));
    expect(await noticeRow(t, noticeId)).toMatchObject({ status: "draft", schoolId: f.schoolId, createdByUserId: f.users.admin });
    expect((await noticeRow(t, noticeId))?.publishedAt).toBeUndefined();
    expect((await feedIds(teacher)).has(noticeId)).toBe(false); // drafts are private
    expect(await errorCode(teacher.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND");
    expect(await noticeNotifications(t, noticeId)).toHaveLength(0);

    const published = await admin.mutation(api.notices.publish, { noticeId });
    expect(published).toMatchObject({ ok: true, scheduled: false });
    expect(published.notified).toBeGreaterThan(0);
    const row = await noticeRow(t, noticeId);
    expect(row?.status).toBe("published");
    const firstPublishedAt = row?.publishedAt;
    expect(typeof firstPublishedAt).toBe("number");
    expect((await feedIds(teacher)).has(noticeId)).toBe(true);
    const notifiedOnce = (await teacher.query(api.notifications.list, {})).filter((n) => n.type === "notice").length;
    expect(notifiedOnce).toBe(1);
    const sent = await noticeNotifications(t, noticeId);
    expect(sent).toHaveLength(published.notified);
    expect(sent.some((n) => n.userId === f.users.admin)).toBe(false); // the publisher is not notified

    // Publishing an already-published notice is a no-op.
    expect(await admin.mutation(api.notices.publish, { noticeId })).toMatchObject({ ok: true, notified: 0, scheduled: false });
    // Published notices are immutable.
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, title: "Changed" }))).toBe("CONFLICT");
    expect((await noticeRow(t, noticeId))?.title).toBe("Science Fair 2026");

    await admin.mutation(api.notices.archive, { noticeId });
    expect((await noticeRow(t, noticeId))?.status).toBe("archived");
    expect((await feedIds(teacher)).has(noticeId)).toBe(false);
    expect(await errorCode(teacher.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.notices.publish, { noticeId }))).toBe("CONFLICT"); // restore first
    expect(await admin.mutation(api.notices.archive, { noticeId })).toEqual({ ok: true }); // archiving twice is a no-op

    // Restore returns the notice to DRAFT: it stays off the board until republished.
    const restored = await admin.mutation(api.notices.restore, { noticeId });
    expect(restored).toEqual({ ok: true, status: "draft" });
    expect((await noticeRow(t, noticeId))?.status).toBe("draft");
    expect((await admin.query(api.notices.get, { noticeId })).status).toBe("draft");
    expect((await feedIds(teacher)).has(noticeId)).toBe(false);
    expect(await errorCode(admin.mutation(api.notices.restore, { noticeId }))).toBe("CONFLICT"); // only archived notices

    const republished = await admin.mutation(api.notices.publish, { noticeId });
    expect(republished.notified).toBe(0);
    expect((await noticeRow(t, noticeId))?.publishedAt).toBe(firstPublishedAt); // first publication time kept
    expect((await feedIds(teacher)).has(noticeId)).toBe(true);
    // Republishing does not notify the same people twice.
    expect((await teacher.query(api.notifications.list, {})).filter((n) => n.type === "notice")).toHaveLength(notifiedOnce);
    expect(await noticeNotifications(t, noticeId)).toHaveLength(sent.length);

    // There is no hard delete: archiving is how a notice leaves the board, and the record stays.
    expect("remove" in api.notices).toBe(false);
    await admin.mutation(api.notices.archive, { noticeId });
    expect((await feedIds(teacher)).has(noticeId)).toBe(false);
    expect(await noticeRow(t, noticeId)).not.toBeNull();
    expect((await admin.query(api.notices.listManaged, { status: "archived" })).some((n) => n.noticeId === noticeId)).toBe(true);
    expect((await admin.query(api.notices.listManaged, { status: "published" })).some((n) => n.noticeId === noticeId)).toBe(false);
  });

  // ---------------------------------------------------------------- original scenario 2
  test("audience targeting: school-wide, role-specific, and section-specific privacy", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-2");
    const admin = await as(t, f.users.admin);
    const classTeacher = await as(t, f.users.classTeacher); // class teacher of 8-A
    const student = await as(t, f.users.student); // enrolled in 8-A
    const legacyGuardian = await as(t, f.users.legacyGuardian); // a leftover guardian sign-in (was linked to the 8-A student)
    const post = async (title: string, audience: Audience) => {
      const { noticeId } = await admin.mutation(api.notices.createDraft, draft(title, audience));
      await admin.mutation(api.notices.publish, { noticeId });
      return noticeId;
    };

    const allNoticeId = await post("School Reopening Notice", { kind: "all" });
    const teacherNoticeId = await post("Staff Evaluation Meeting", { kind: "roles", roles: ["teacher"] });
    const sectionANoticeId = await post("Section 8-A Project Submission", { kind: "sections", sectionIds: [f.sectionA] });
    const sectionBNoticeId = await post("Section 8-B Field Trip", { kind: "sections", sectionIds: [f.sectionB] });
    const classNoticeId = await post("Grade 8 Assembly", { kind: "classes", classIds: [f.classId] });

    const studentSees = await feedIds(student);
    expect(studentSees.has(allNoticeId)).toBe(true);
    expect(studentSees.has(sectionANoticeId)).toBe(true);
    expect(studentSees.has(classNoticeId)).toBe(true);
    expect(studentSees.has(teacherNoticeId)).toBe(false);
    expect(studentSees.has(sectionBNoticeId)).toBe(false);
    expect(await errorCode(student.query(api.notices.get, { noticeId: teacherNoticeId }))).toBe("NOT_FOUND");
    expect(await errorCode(student.query(api.notices.get, { noticeId: sectionBNoticeId }))).toBe("NOT_FOUND");
    expect((await student.query(api.notices.get, { noticeId: sectionANoticeId })).audienceLabel).toBe("Class 8-A");

    // A leftover guardian sign-in sees nothing (account type removed).
    expect(await errorCode(feedIds(legacyGuardian))).toBe("NO_SCHOOL_ACCESS");
    expect(await errorCode(legacyGuardian.query(api.studentPortal.myNotices, { today: "2026-10-12" }))).toBe("NO_SCHOOL_ACCESS");

    const teacherSees = await feedIds(classTeacher);
    expect(teacherSees.has(allNoticeId)).toBe(true);
    expect(teacherSees.has(teacherNoticeId)).toBe(true);
    expect(teacherSees.has(sectionANoticeId)).toBe(true);

    // Notifications follow the same audience.
    const sectionANotified = (await noticeNotifications(t, sectionANoticeId)).map((n) => n.userId);
    expect(sectionANotified).toEqual(expect.arrayContaining([f.users.student, f.users.classTeacher]));
    expect(sectionANotified).not.toContain(f.users.legacyGuardian);
    expect((await noticeNotifications(t, teacherNoticeId)).some((n) => n.userId === f.users.student)).toBe(false);
    expect((await noticeNotifications(t, sectionBNoticeId)).some((n) => n.userId === f.users.student || n.userId === f.users.legacyGuardian)).toBe(false);

    // Audience ids are validated against the caller's school (sections and classes); nothing is written.
    const other = await createSchool(t, "school-notices-2b");
    const before = await t.run(async (ctx) => (await ctx.db.query("notices").collect()).length);
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("Wrong school", { kind: "sections", sectionIds: [other.sectionA] })))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("Wrong school", { kind: "classes", classIds: [other.classId] })))).toBe("NOT_FOUND");
    expect(await t.run(async (ctx) => (await ctx.db.query("notices").collect()).length)).toBe(before);
    // ... and on edit of a draft.
    const { noticeId: draftId } = await admin.mutation(api.notices.createDraft, draft("Draft", { kind: "all" }));
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId: draftId, audience: { kind: "sections", sectionIds: [other.sectionB] } }))).toBe("NOT_FOUND");
    expect((await noticeRow(t, draftId))?.audience).toEqual({ kind: "all" });
  });

  // ---------------------------------------------------------------- original scenario 3
  test("an urgent notice notifies its intended audience on publish", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-3");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    const { noticeId } = await admin.mutation(api.notices.createDraft, draft("Heavy Rain Holiday Alert", { kind: "all" }, {
      body: "School is closed tomorrow due to heavy rainfall warning.", type: "holiday", priority: "urgent",
    }));
    const { notified } = await admin.mutation(api.notices.publish, { noticeId });
    expect(notified).toBeGreaterThan(0);

    const urgent = (await student.query(api.notifications.list, {})).find((n) => n.message.includes("Heavy Rain"));
    expect(urgent).toBeDefined();
    expect(urgent).toMatchObject({ type: "notice", title: "Important notice", isRead: false, entity: { table: "notices", id: noticeId } });
    expect(await student.query(api.notifications.unreadCount, {})).toBe(1);

    // Every active member except the publisher got exactly one copy.
    const rows = await noticeNotifications(t, noticeId);
    expect(rows).toHaveLength(notified);
    expect(new Set(rows.map((n) => n.userId)).size).toBe(rows.length);
    // (A leftover guardian sign-in is not an active member and gets nothing.)
    expect(new Set(rows.map((n) => n.userId))).toEqual(new Set([f.users.classTeacher, f.users.subjectTeacher, f.users.student]));

    // A normal-priority notice uses the ordinary title.
    const { noticeId: normalId } = await admin.mutation(api.notices.createDraft, draft("Library hours", { kind: "all" }));
    await admin.mutation(api.notices.publish, { noticeId: normalId });
    expect((await student.query(api.notifications.list, {})).find((n) => n.message === "Library hours")?.title).toBe("New notice");

    // With notice alerts switched off for the school, publishing sends nothing.
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("schoolSettings").collect()).find((x) => x.schoolId === f.schoolId)!;
      await ctx.db.patch(s._id, { notifications: { ...s.notifications, noticeAlerts: false } });
    });
    const { noticeId: quietId } = await admin.mutation(api.notices.createDraft, draft("Quiet notice", { kind: "all" }, { priority: "urgent" }));
    expect((await admin.mutation(api.notices.publish, { noticeId: quietId })).notified).toBe(0);
    expect(await noticeNotifications(t, quietId)).toHaveLength(0);
    expect((await feedIds(student)).has(quietId)).toBe(true); // still published
  });

  // ---------------------------------------------------------------- original scenario 4
  test("events creation and audience query", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-4");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);
    const teacher = await as(t, f.users.classTeacher);

    expect(await errorCode(teacher.mutation(api.events.create, {
      title: "Staff picnic", kind: "event", startDate: "2026-11-20", endDate: "2026-11-20", audience: { kind: "all" },
    }))).toBe("FORBIDDEN");

    const { eventId } = await admin.mutation(api.events.create, {
      title: "Sports Day 2026", description: "Inter-house athletics championship", kind: "event",
      startDate: "2026-11-15", endDate: "2026-11-16", audience: { kind: "all" },
    });
    expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ schoolId: f.schoolId, title: "Sports Day 2026", startDate: "2026-11-15", endDate: "2026-11-16" });
    await admin.mutation(api.events.create, {
      title: "8-B trip", kind: "event", startDate: "2026-11-18", endDate: "2026-11-18", audience: { kind: "sections", sectionIds: [f.sectionB] },
    });

    const events = await student.query(api.events.list, { from: "2026-11-01", to: "2026-11-30" });
    expect(events).toHaveLength(1); // the 8-B trip is not addressed to an 8-A student
    expect(events[0].title).toBe("Sports Day 2026");
    expect(await admin.query(api.events.list, { from: "2026-11-01", to: "2026-11-30" })).toHaveLength(2); // managers see all

    // Invalid ranges and another school's sections are rejected.
    expect(await errorCode(admin.mutation(api.events.create, { title: "Backwards", kind: "event", startDate: "2026-11-20", endDate: "2026-11-19", audience: { kind: "all" } }))).toBe("INVALID_ARGUMENT");
    const other = await createSchool(t, "school-notices-4b");
    expect(await errorCode(admin.mutation(api.events.create, { title: "Elsewhere", kind: "event", startDate: "2026-11-21", endDate: "2026-11-21", audience: { kind: "sections", sectionIds: [other.sectionA] } }))).toBe("NOT_FOUND");
    expect(await (await as(t, other.users.student)).query(api.events.list, { from: "2026-11-01", to: "2026-11-30" })).toEqual([]);
  });

  // ---------------------------------------------------------------- added coverage
  test("drafts: input validation, who may create, draft edits", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-5");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);
    const legacyGuardian = await as(t, f.users.legacyGuardian);
    const count = () => t.run(async (ctx) => (await ctx.db.query("notices").collect()).length);

    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("   ", { kind: "all" })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.createDraft, { ...draft("Body missing", { kind: "all" }), body: " " }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("x".repeat(151), { kind: "all" })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("Bad date", { kind: "all" }, { publishDate: "2026-02-30" })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("Expires early", { kind: "all" }, { publishDate: "2026-05-10", expiresOn: "2026-05-09" })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("No sections", { kind: "sections", sectionIds: [] })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.createDraft, draft("No roles", { kind: "roles", roles: [] })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(student.mutation(api.notices.createDraft, draft("By a student", { kind: "all" })))).toBe("FORBIDDEN");
    expect(await errorCode(legacyGuardian.mutation(api.notices.createDraft, draft("By a legacy guardian sign-in", { kind: "sections", sectionIds: [f.sectionA] })))).toBe("NO_SCHOOL_ACCESS");
    expect(await count()).toBe(0);

    // Titles are trimmed; duplicate section ids are collapsed.
    const { noticeId } = await admin.mutation(api.notices.createDraft, draft("  Exam timetable  ", { kind: "sections", sectionIds: [f.sectionA, f.sectionA] }, { expiresOn: "2026-12-31" }));
    expect(await noticeRow(t, noticeId)).toMatchObject({ title: "Exam timetable", audience: { kind: "sections", sectionIds: [f.sectionA] }, expiresOn: "2026-12-31", status: "draft" });

    // Drafts can be edited (and optional dates cleared with ""); invalid edits change nothing.
    await admin.mutation(api.notices.update, { noticeId, title: "Exam timetable (revised)", priority: "high", expiresOn: "" });
    expect(await noticeRow(t, noticeId)).toMatchObject({ title: "Exam timetable (revised)", priority: "high" });
    expect((await noticeRow(t, noticeId))?.expiresOn).toBeUndefined();
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, title: "" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, expiresOn: "2026-03-01" }))).toBe("INVALID_ARGUMENT"); // before publishDate
    expect((await noticeRow(t, noticeId))?.title).toBe("Exam timetable (revised)");

    // Managers see drafts with author and readable audience; readers do not.
    const authorName = (await t.run((ctx) => ctx.db.get(f.users.admin)))?.name ?? null;
    expect((await admin.query(api.notices.listManaged, { status: "draft" })).find((n) => n.noticeId === noticeId)).toMatchObject({ authorName, audienceLabel: "Class 8-A", createdByUserId: f.users.admin });
    expect(await errorCode(student.query(api.notices.listManaged, {}))).toBe("FORBIDDEN");
    expect(await student.query(api.notices.feed, {})).toEqual([]);

    // An expired draft cannot be published.
    const { noticeId: stale } = await admin.mutation(api.notices.createDraft, draft("Old news", { kind: "all" }, { publishDate: "2026-04-01", expiresOn: "2026-04-02" }));
    expect(await errorCode(admin.mutation(api.notices.publish, { noticeId: stale }))).toBe("INVALID_ARGUMENT");
    expect((await noticeRow(t, stale))?.status).toBe("draft");
  });

  test("scheduled publication: a future-dated notice is hidden and notified only on its date, once", async () => {
    vi.useFakeTimers();
    const t = makeTest();
    const f = await createSchool(t, "school-notices-6");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);
    const publishDate = addDays(todayIn("Asia/Kolkata"), 2);

    const { noticeId } = await admin.mutation(api.notices.createDraft, draft("Annual Day", { kind: "all" }, { publishDate }));
    expect(await admin.mutation(api.notices.publish, { noticeId })).toMatchObject({ ok: true, notified: 0, scheduled: true });
    expect((await noticeRow(t, noticeId))?.status).toBe("published");
    expect((await feedIds(student)).has(noticeId)).toBe(false); // not visible before its date
    expect(await errorCode(student.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND");
    expect(await noticeNotifications(t, noticeId)).toHaveLength(0);

    // A second future notice archived before its date is never notified.
    const { noticeId: cancelled } = await admin.mutation(api.notices.createDraft, draft("Cancelled trip", { kind: "all" }, { publishDate }));
    await admin.mutation(api.notices.publish, { noticeId: cancelled });
    await admin.mutation(api.notices.archive, { noticeId: cancelled });

    vi.setSystemTime(startOfDayMs(publishDate, "Asia/Kolkata") + 60_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const sent = await noticeNotifications(t, noticeId);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((n) => n.userId === f.users.student)).toBe(true);
    expect(sent.some((n) => n.userId === f.users.admin)).toBe(false);
    expect((await feedIds(student)).has(noticeId)).toBe(true);
    expect(await noticeNotifications(t, cancelled)).toHaveLength(0);

    // Running the scheduler again does not notify twice.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await noticeNotifications(t, noticeId)).toHaveLength(sent.length);
  });

  test("authorship and tenant isolation across roles", async () => {
    const t = makeTest();
    const A = await createSchool(t, "school-notices-7a");
    const B = await createSchool(t, "school-notices-7b");
    const adminA = await as(t, A.users.admin);
    const adminB = await as(t, B.users.admin);
    const author = await as(t, A.users.classTeacher);
    const colleague = await as(t, A.users.subjectTeacher);
    const studentB = await as(t, B.users.student);

    // A teacher writes a notice for a section they teach; another teacher cannot change it.
    const { noticeId } = await author.mutation(api.notices.createDraft, draft("8-A homework week", { kind: "sections", sectionIds: [A.sectionA] }));
    expect(await errorCode(colleague.mutation(api.notices.update, { noticeId, title: "Hijacked" }))).toBe("FORBIDDEN");
    expect(await errorCode(colleague.mutation(api.notices.publish, { noticeId }))).toBe("FORBIDDEN");
    expect(await errorCode(colleague.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND"); // a draft is private to its author and managers
    expect((await colleague.query(api.notices.listManaged, {})).some((n) => n.noticeId === noticeId)).toBe(false);
    expect((await author.query(api.notices.listManaged, {})).map((n) => n.noticeId)).toEqual([noticeId]);
    await author.mutation(api.notices.publish, { noticeId });
    expect(await errorCode(colleague.mutation(api.notices.archive, { noticeId }))).toBe("FORBIDDEN");
    await author.mutation(api.notices.archive, { noticeId });
    expect(await errorCode(colleague.mutation(api.notices.restore, { noticeId }))).toBe("FORBIDDEN");
    expect((await noticeRow(t, noticeId))?.status).toBe("archived");
    // A manager may act on any notice of their school.
    expect((await adminA.mutation(api.notices.restore, { noticeId })).status).toBe("draft");

    // Another school sees nothing and can change nothing.
    const { noticeId: schoolWide } = await adminA.mutation(api.notices.createDraft, draft("School A only", { kind: "all" }));
    await adminA.mutation(api.notices.publish, { noticeId: schoolWide });
    for (const call of [
      adminB.query(api.notices.get, { noticeId: schoolWide }),
      studentB.query(api.notices.get, { noticeId: schoolWide }),
      adminB.mutation(api.notices.update, { noticeId, title: "x" }),
      adminB.mutation(api.notices.publish, { noticeId }),
      adminB.mutation(api.notices.archive, { noticeId: schoolWide }),
      adminB.mutation(api.notices.restore, { noticeId }),
    ]) expect(await errorCode(call)).toBe("NOT_FOUND");
    expect((await feedIds(studentB)).has(schoolWide)).toBe(false);
    expect(await adminB.query(api.notices.listManaged, {})).toEqual([]);
    expect((await noticeRow(t, schoolWide))?.status).toBe("published");
    expect((await noticeNotifications(t, schoolWide)).some((n) => n.schoolId !== A.schoolId)).toBe(false);
  });

  test("notifications: own inbox only — read state, remove and clear-all", async () => {
    const t = makeTest();
    const A = await createSchool(t, "school-notices-8a");
    const B = await createSchool(t, "school-notices-8b");
    const admin = await as(t, A.users.admin);
    const student = await as(t, A.users.student);
    const otherTeacher = await as(t, A.users.subjectTeacher); // another recipient of the same notices
    const teacher = await as(t, A.users.classTeacher);
    const adminB = await as(t, B.users.admin);
    for (const title of ["One", "Two", "Three"]) {
      const { noticeId } = await admin.mutation(api.notices.createDraft, draft(title, { kind: "sections", sectionIds: [A.sectionA] }));
      await admin.mutation(api.notices.publish, { noticeId });
    }
    const dbRow = (id: Id<"notifications">) => t.run((ctx) => ctx.db.get(id));

    const mine = await student.query(api.notifications.list, {});
    expect(mine).toHaveLength(3);
    expect(mine.every((n) => n.userId === A.users.student && n.schoolId === A.schoolId)).toBe(true);
    expect(await student.query(api.notifications.unreadCount, {})).toBe(3);
    const teacherNote = (await teacher.query(api.notifications.list, {}))[0];
    const otherNotes = await otherTeacher.query(api.notifications.list, {});
    expect(otherNotes).toHaveLength(3);

    // Read state.
    await student.mutation(api.notifications.markRead, { notificationId: mine[0]._id });
    expect(await dbRow(mine[0]._id)).toMatchObject({ isRead: true, readAt: expect.any(Number) });
    expect(await student.query(api.notifications.unreadCount, {})).toBe(2);
    expect((await student.query(api.notifications.list, { unreadOnly: true })).map((n) => n._id)).not.toContain(mine[0]._id);
    await student.mutation(api.notifications.markRead, { notificationId: mine[0]._id }); // idempotent
    expect(await student.query(api.notifications.unreadCount, {})).toBe(2);
    // Nobody can mark another user's notification — not in the same school, not from another school.
    expect(await errorCode(student.mutation(api.notifications.markRead, { notificationId: teacherNote._id }))).toBe("NOT_FOUND");
    expect(await errorCode(adminB.mutation(api.notifications.markRead, { notificationId: teacherNote._id }))).toBe("NOT_FOUND");
    expect((await dbRow(teacherNote._id))?.isRead).toBe(false);

    expect(await student.mutation(api.notifications.markAllRead, {})).toEqual({ updated: 2 });
    expect(await student.query(api.notifications.unreadCount, {})).toBe(0);
    expect(await otherTeacher.query(api.notifications.unreadCount, {})).toBe(3); // other users untouched

    // Remove: own only; another user's notification stays in the database.
    expect(await student.mutation(api.notifications.remove, { notificationId: mine[1]._id })).toEqual({ ok: true });
    expect(await dbRow(mine[1]._id)).toBeNull();
    expect(await student.query(api.notifications.list, {})).toHaveLength(2);
    expect(await errorCode(student.mutation(api.notifications.remove, { notificationId: otherNotes[0]._id }))).toBe("NOT_FOUND");
    expect(await errorCode(adminB.mutation(api.notifications.remove, { notificationId: teacherNote._id }))).toBe("NOT_FOUND");
    expect(await dbRow(otherNotes[0]._id)).not.toBeNull();
    expect(await dbRow(teacherNote._id)).not.toBeNull();
    // Removing it again: it no longer exists.
    expect(await errorCode(student.mutation(api.notifications.remove, { notificationId: mine[1]._id }))).toBe("NOT_FOUND");

    // Clear all: only the caller's inbox in this school.
    expect(await student.mutation(api.notifications.clearAll, {})).toEqual({ ok: true, deleted: 2, remaining: false });
    expect(await student.query(api.notifications.list, {})).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.userId === A.users.student).length)).toBe(0);
    expect(await otherTeacher.query(api.notifications.list, {})).toHaveLength(3);
    expect(await teacher.query(api.notifications.list, {})).toHaveLength(3);
    expect(await student.mutation(api.notifications.clearAll, {})).toEqual({ ok: true, deleted: 0, remaining: false });
  });

  test("invalid ids and invalid state transitions fail without side effects", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-9");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    // Ids of rows that no longer exist.
    const goneNotice = await t.run(async (ctx) => {
      const id = await ctx.db.insert("notices", { schoolId: f.schoolId, title: "Gone", body: "x", type: "notice", priority: "normal", audience: { kind: "all" }, status: "draft", publishDate: PAST, createdByUserId: f.users.admin });
      await ctx.db.delete(id);
      return id;
    });
    for (const call of [
      admin.query(api.notices.get, { noticeId: goneNotice }),
      admin.mutation(api.notices.update, { noticeId: goneNotice, title: "x" }),
      admin.mutation(api.notices.publish, { noticeId: goneNotice }),
      admin.mutation(api.notices.archive, { noticeId: goneNotice }),
      admin.mutation(api.notices.restore, { noticeId: goneNotice }),
    ]) expect(await errorCode(call)).toBe("NOT_FOUND");
    const goneNotification = await t.run(async (ctx) => {
      const id = await ctx.db.insert("notifications", { schoolId: f.schoolId, userId: f.users.student, type: "notice", title: "Gone", message: "x", isRead: false });
      await ctx.db.delete(id);
      return id;
    });
    expect(await errorCode(student.mutation(api.notifications.markRead, { notificationId: goneNotification }))).toBe("NOT_FOUND");
    expect(await errorCode(student.mutation(api.notifications.remove, { notificationId: goneNotification }))).toBe("NOT_FOUND");

    // Invalid transitions.
    const { noticeId } = await admin.mutation(api.notices.createDraft, draft("Transitions", { kind: "all" }));
    expect(await errorCode(admin.mutation(api.notices.restore, { noticeId }))).toBe("CONFLICT"); // draft → restore
    await admin.mutation(api.notices.publish, { noticeId });
    expect(await errorCode(admin.mutation(api.notices.restore, { noticeId }))).toBe("CONFLICT"); // published → restore
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, body: "edited" }))).toBe("CONFLICT"); // published → edit
    await admin.mutation(api.notices.archive, { noticeId });
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, body: "edited" }))).toBe("CONFLICT"); // archived → edit
    expect(await errorCode(admin.mutation(api.notices.publish, { noticeId }))).toBe("CONFLICT"); // archived → publish
    expect(await noticeRow(t, noticeId)).toMatchObject({ status: "archived", body: "Transitions — details" });
  });
});
