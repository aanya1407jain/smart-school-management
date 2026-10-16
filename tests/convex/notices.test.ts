/**
 * In-process tests for Notices, Audience Targeting, and Events (AP-02).
 * Run with: npx vitest run tests/convex/notices.test.ts
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

describe("Notices and school events (AP-02)", () => {
  test("lifecycle: create, publish, update, archive, restore, and delete", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-1");
    const admin = await as(t, f.users.admin);
    const teacher = await as(t, f.users.classTeacher);

    // Non-admin cannot create notice
    const nonAdminErr = await errorCode(
      teacher.mutation(api.notices.create, {
        title: "Staff Meeting",
        body: "All teachers gather in hall.",
        type: "notice",
        priority: "normal",
        audience: { kind: "roles", roles: ["teacher"] },
        status: "published",
        publishDate: "2026-05-01",
      }),
    );
    expect(nonAdminErr).toBe("FORBIDDEN");

    // Admin creates draft notice
    const { noticeId } = await admin.mutation(api.notices.create, {
      title: "Science Fair 2026",
      body: "Annual school science fair preparations begin.",
      type: "event",
      priority: "normal",
      audience: { kind: "all" },
      status: "draft",
      publishDate: "2026-05-01",
    });
    expect(noticeId).toBeDefined();

    // Teacher cannot see draft notice
    const teacherList1 = await teacher.query(api.notices.list, {});
    expect(teacherList1.some((n) => n._id === noticeId)).toBe(false);

    // Admin publishes notice
    await admin.mutation(api.notices.update, {
      noticeId,
      status: "published",
      publishDate: "2026-04-01", // already published as of today
    });

    // Now teacher sees the published notice
    const teacherList2 = await teacher.query(api.notices.list, {});
    expect(teacherList2.some((n) => n._id === noticeId)).toBe(true);

    // Archive notice
    await admin.mutation(api.notices.archive, { noticeId });
    const teacherList3 = await teacher.query(api.notices.list, {});
    expect(teacherList3.some((n) => n._id === noticeId)).toBe(false);

    // Restore notice
    await admin.mutation(api.notices.restore, { noticeId });
    const teacherList4 = await teacher.query(api.notices.list, {});
    expect(teacherList4.some((n) => n._id === noticeId)).toBe(true);

    // Delete notice
    await admin.mutation(api.notices.remove, { noticeId });
    const teacherList5 = await teacher.query(api.notices.list, {});
    expect(teacherList5.some((n) => n._id === noticeId)).toBe(false);
  });

  test("audience targeting: school-wide, role-specific, class-specific, and section-specific privacy", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-2");
    const admin = await as(t, f.users.admin);
    const classTeacher = await as(t, f.users.classTeacher); // teaches section A
    const student = await as(t, f.users.student); // enrolled in section A, Grade 8

    const today = "2026-04-01";

    // 1. School-wide notice
    const { noticeId: allNoticeId } = await admin.mutation(api.notices.create, {
      title: "School Reopening Notice",
      body: "Welcome to the new academic year.",
      type: "notice",
      priority: "normal",
      audience: { kind: "all" },
      status: "published",
      publishDate: today,
    });

    // 2. Teacher-only notice
    const { noticeId: teacherNoticeId } = await admin.mutation(api.notices.create, {
      title: "Staff Evaluation Meeting",
      body: "Confidential teacher meeting.",
      type: "notice",
      priority: "normal",
      audience: { kind: "roles", roles: ["teacher"] },
      status: "published",
      publishDate: today,
    });

    // 3. Section A only notice
    const { noticeId: sectionANoticeId } = await admin.mutation(api.notices.create, {
      title: "Section 8-A Project Submission",
      body: "Maths assignment for 8-A only.",
      type: "notice",
      priority: "normal",
      audience: { kind: "sections", sectionIds: [f.sectionA] },
      status: "published",
      publishDate: today,
    });

    // 4. Section B only notice
    const { noticeId: sectionBNoticeId } = await admin.mutation(api.notices.create, {
      title: "Section 8-B Field Trip",
      body: "Exclusively for 8-B.",
      type: "notice",
      priority: "normal",
      audience: { kind: "sections", sectionIds: [f.sectionB] },
      status: "published",
      publishDate: today,
    });

    // Student A (enrolled in Section A):
    const studentNotices = await student.query(api.notices.list, {});
    const studentNoticeIds = new Set(studentNotices.map((n: any) => n._id));

    // Can see: allNotice and sectionANotice
    expect(studentNoticeIds.has(allNoticeId)).toBe(true);
    expect(studentNoticeIds.has(sectionANoticeId)).toBe(true);

    // CANNOT see: teacherNotice or sectionBNotice
    expect(studentNoticeIds.has(teacherNoticeId)).toBe(false);
    expect(studentNoticeIds.has(sectionBNoticeId)).toBe(false);

    // Trying to get teacherNotice directly throws NOT_FOUND
    const privacyErr = await errorCode(student.query(api.notices.get, { noticeId: teacherNoticeId }));
    expect(privacyErr).toBe("NOT_FOUND");

    // Teacher:
    const teacherNotices = await classTeacher.query(api.notices.list, {});
    const teacherNoticeIds = new Set(teacherNotices.map((n: any) => n._id));
    expect(teacherNoticeIds.has(allNoticeId)).toBe(true);
    expect(teacherNoticeIds.has(teacherNoticeId)).toBe(true);
  });

  test("urgent priority notice dispatches notifications to intended audience", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-3");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    // Create urgent school-wide notice
    await admin.mutation(api.notices.create, {
      title: "Heavy Rain Holiday Alert",
      body: "School is closed tomorrow due to heavy rainfall warning.",
      type: "holiday",
      priority: "urgent",
      audience: { kind: "all" },
      status: "published",
      publishDate: "2026-04-01",
    });

    // Student receives the notification
    const studentNotifs = await student.query(api.notifications.list, {});
    const urgentNotif = studentNotifs.find((n) => n.title.includes("Heavy Rain"));
    expect(urgentNotif).toBeDefined();
    expect(urgentNotif?.type).toBe("notice");
    expect(urgentNotif?.message).toContain("School is closed tomorrow");
  });

  test("events creation and audience query", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-notices-4");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    const { eventId } = await admin.mutation(api.notices.createEvent, {
      title: "Sports Day 2026",
      description: "Inter-house athletics championship",
      kind: "event",
      startDate: "2026-11-15",
      endDate: "2026-11-16",
      audience: { kind: "all" },
    });
    expect(eventId).toBeDefined();

    const events = await student.query(api.notices.listEvents, {
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    expect(events.length).toBe(1);
    expect(events[0].title).toBe("Sports Day 2026");
  });
});
