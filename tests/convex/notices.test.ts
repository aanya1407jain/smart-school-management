/**
 * In-process tests for Notices, Audience Targeting, and Events (AP-02).
 * Originally written in PR #11 against its notices API; adapted to the final
 * API: `createDraft` → `publish` → `archive` → `restore` (back to DRAFT,
 * republishing required), `feed` for readers, events in `convex/events.ts`.
 * Notices are never hard-deleted.
 * Run with: npx vitest run tests/convex/notices.test.ts
 */
import { describe, expect, test } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

type Client = Awaited<ReturnType<typeof as>>;
type Audience = FunctionArgs<typeof api.notices.createDraft>["audience"];

const feedIds = async (c: Client) => new Set((await c.query(api.notices.feed, {})).map((n) => n.noticeId as Id<"notices">));

describe("Notices and school events (AP-02)", () => {
  test("lifecycle: draft, publish, archive, restore to draft, republish — never hard-deleted", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-1");
    const admin = await as(t, f.users.admin);
    const teacher = await as(t, f.users.classTeacher);

    // A teacher cannot address the whole staff (only their own sections).
    expect(await errorCode(teacher.mutation(api.notices.createDraft, {
      title: "Staff Meeting", body: "All teachers gather in hall.", type: "notice", priority: "normal",
      audience: { kind: "roles", roles: ["teacher"] }, publishDate: "2026-05-01",
    }))).toBe("FORBIDDEN");

    const { noticeId } = await admin.mutation(api.notices.createDraft, {
      title: "Science Fair 2026", body: "Annual school science fair preparations begin.", type: "event", priority: "normal",
      audience: { kind: "all" }, publishDate: "2026-04-01",
    });
    expect((await feedIds(teacher)).has(noticeId)).toBe(false); // drafts are private
    expect(await errorCode(teacher.query(api.notices.get, { noticeId }))).toBe("NOT_FOUND");

    const published = await admin.mutation(api.notices.publish, { noticeId });
    expect(published.scheduled).toBe(false);
    expect((await feedIds(teacher)).has(noticeId)).toBe(true);
    const notifiedOnce = (await teacher.query(api.notifications.list, {})).filter((n) => n.type === "notice").length;
    expect(notifiedOnce).toBe(1);

    await admin.mutation(api.notices.archive, { noticeId });
    expect((await feedIds(teacher)).has(noticeId)).toBe(false);
    expect(await errorCode(admin.mutation(api.notices.publish, { noticeId }))).toBe("CONFLICT"); // restore first

    // Restore returns the notice to DRAFT: it stays off the board until republished.
    const restored = await admin.mutation(api.notices.restore, { noticeId });
    expect(restored.status).toBe("draft");
    expect((await admin.query(api.notices.get, { noticeId })).status).toBe("draft");
    expect((await feedIds(teacher)).has(noticeId)).toBe(false);
    expect(await errorCode(admin.mutation(api.notices.restore, { noticeId }))).toBe("CONFLICT"); // only archived notices

    await admin.mutation(api.notices.publish, { noticeId });
    expect((await feedIds(teacher)).has(noticeId)).toBe(true);
    // Republishing does not notify the same people twice.
    expect((await teacher.query(api.notifications.list, {})).filter((n) => n.type === "notice")).toHaveLength(notifiedOnce);

    // There is no hard delete: archiving is how a notice leaves the board.
    expect("remove" in api.notices).toBe(false);
    await admin.mutation(api.notices.archive, { noticeId });
    expect((await feedIds(teacher)).has(noticeId)).toBe(false);
    expect((await admin.query(api.notices.listManaged, { status: "archived" })).some((n) => n.noticeId === noticeId)).toBe(true);
  });

  test("audience targeting: school-wide, role-specific, and section-specific privacy", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-2");
    const admin = await as(t, f.users.admin);
    const classTeacher = await as(t, f.users.classTeacher); // class teacher of 8-A
    const student = await as(t, f.users.student); // enrolled in 8-A
    const today = "2026-04-01";
    const post = async (title: string, audience: Audience) => {
      const { noticeId } = await admin.mutation(api.notices.createDraft, { title, body: `${title} body`, type: "notice", priority: "normal", audience, publishDate: today });
      await admin.mutation(api.notices.publish, { noticeId });
      return noticeId;
    };

    const allNoticeId = await post("School Reopening Notice", { kind: "all" });
    const teacherNoticeId = await post("Staff Evaluation Meeting", { kind: "roles", roles: ["teacher"] });
    const sectionANoticeId = await post("Section 8-A Project Submission", { kind: "sections", sectionIds: [f.sectionA] });
    const sectionBNoticeId = await post("Section 8-B Field Trip", { kind: "sections", sectionIds: [f.sectionB] });

    const studentSees = await feedIds(student);
    expect(studentSees.has(allNoticeId)).toBe(true);
    expect(studentSees.has(sectionANoticeId)).toBe(true);
    expect(studentSees.has(teacherNoticeId)).toBe(false);
    expect(studentSees.has(sectionBNoticeId)).toBe(false);
    expect(await errorCode(student.query(api.notices.get, { noticeId: teacherNoticeId }))).toBe("NOT_FOUND");

    const teacherSees = await feedIds(classTeacher);
    expect(teacherSees.has(allNoticeId)).toBe(true);
    expect(teacherSees.has(teacherNoticeId)).toBe(true);
    expect(teacherSees.has(sectionANoticeId)).toBe(true);

    // Audience ids are validated against the caller's school.
    const other = await createSchool(t, "school-notices-2b");
    expect(await errorCode(admin.mutation(api.notices.createDraft, {
      title: "Wrong school", body: "x", type: "notice", priority: "normal", audience: { kind: "sections", sectionIds: [other.sectionA] }, publishDate: today,
    }))).toBe("NOT_FOUND");
  });

  test("an urgent notice notifies its intended audience on publish", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-3");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    const { noticeId } = await admin.mutation(api.notices.createDraft, {
      title: "Heavy Rain Holiday Alert", body: "School is closed tomorrow due to heavy rainfall warning.", type: "holiday", priority: "urgent",
      audience: { kind: "all" }, publishDate: "2026-04-01",
    });
    const { notified } = await admin.mutation(api.notices.publish, { noticeId });
    expect(notified).toBeGreaterThan(0);

    const urgent = (await student.query(api.notifications.list, {})).find((n) => n.message.includes("Heavy Rain"));
    expect(urgent).toBeDefined();
    expect(urgent?.type).toBe("notice");
    expect(urgent?.title).toBe("Important notice");
  });

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
    expect(eventId).toBeDefined();
    await admin.mutation(api.events.create, {
      title: "8-B trip", kind: "event", startDate: "2026-11-18", endDate: "2026-11-18", audience: { kind: "sections", sectionIds: [f.sectionB] },
    });

    const events = await student.query(api.events.list, { from: "2026-11-01", to: "2026-11-30" });
    expect(events).toHaveLength(1); // the 8-B trip is not addressed to an 8-A student
    expect(events[0].title).toBe("Sports Day 2026");
  });
});
