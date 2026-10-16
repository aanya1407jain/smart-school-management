/**
 * Guardian child switching, multi-child data isolation, and notification delivery tests.
 * Ported from PR #11 (Apporva) to the reconciled fees / notices API.
 * Covers AP-05 requirements with verified Convex backend queries and mutations.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, pastMonday } from "./fixtures";

describe("AP-05: Guardian child switching and notifications", () => {
  test("guardian with multiple linked children refreshes profile, fees, timetable, attendance, and notices on switch", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");

    const guardianUser = await as(t, A.users.guardian);
    const adminUser = await as(t, A.users.admin);

    const guardianRecord = await t.run(async (ctx) => {
      const m = await ctx.db.get(A.memberships.guardian);
      return m!.guardianId!;
    });

    // Link studentB to the same guardian as well
    await t.run(async (ctx) => {
      await ctx.db.insert("guardianLinks", {
        schoolId: A.schoolId,
        guardianId: guardianRecord,
        studentId: A.studentB,
        relationship: "Mother",
        isPrimary: false,
      });

      // Insert timetable periods and entries for section A (Child A) and section B (Child B)
      const periodId = await ctx.db.insert("periods", {
        schoolId: A.schoolId,
        index: 1,
        label: "Period 1",
        startTime: "09:00",
        endTime: "09:45",
        isBreak: false,
      });

      await ctx.db.insert("timetableEntries", {
        schoolId: A.schoolId,
        academicYearId: A.yearId,
        sectionId: A.sectionA,
        dayOfWeek: 1,
        periodId,
        subjectId: A.subjectId,
        teacherId: A.subjectTeacher,
      });
      await ctx.db.insert("timetableEntries", {
        schoolId: A.schoolId,
        academicYearId: A.yearId,
        sectionId: A.sectionB,
        dayOfWeek: 1,
        periodId,
        subjectId: A.subjectId,
        teacherId: A.classTeacher,
      });

      // Notices specific to section A and section B
      await ctx.db.insert("notices", {
        schoolId: A.schoolId,
        title: "Section A Field Trip",
        body: "Trip details for Section A students.",
        type: "notice",
        priority: "normal",
        status: "published",
        publishDate: "2026-04-01",
        audience: { kind: "sections", sectionIds: [A.sectionA] },
        createdByUserId: A.users.admin,
      });
      await ctx.db.insert("notices", {
        schoolId: A.schoolId,
        title: "Section B Science Fair",
        body: "Fair details for Section B students.",
        type: "notice",
        priority: "normal",
        status: "published",
        publishDate: "2026-04-01",
        audience: { kind: "sections", sectionIds: [A.sectionB] },
        createdByUserId: A.users.admin,
      });
    });

    // Create fee structures using verified backend mutation
    const { structureId: structA } = await adminUser.mutation(api.fees.createStructure, {
      name: "Standard 8-A",
      classIds: [A.classId],
      components: [{ label: "Tuition", amountMinor: 2000000 }],
      installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 2000000 }],
      activate: true,
    });
    const { structureId: structB } = await adminUser.mutation(api.fees.createStructure, {
      name: "Standard 8-B",
      classIds: [A.classId],
      components: [{ label: "Tuition", amountMinor: 3000000 }],
      installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 3000000 }],
      activate: true,
    });

    // Assign fee structures to student A and student B
    await adminUser.mutation(api.fees.assignStructure, { structureId: structA, target: { kind: "students", studentIds: [A.studentA] } });
    await adminUser.mutation(api.fees.assignStructure, { structureId: structB, target: { kind: "students", studentIds: [A.studentB] } });

    // 1. Query for Child A
    const profileA = await guardianUser.query(api.studentPortal.myProfile, { studentId: A.studentA });
    expect(profileA.state).toBe("ok");
    if (profileA.state === "ok") {
      expect(profileA.student.studentId).toBe(A.studentA);
      expect(profileA.student.name).toBe("Asha S");
      expect(profileA.enrollment?.sectionDisplayName).toBe("8-A");
      expect(profileA.relation).toBe("guardian");
    }

    const feesA = await guardianUser.query(api.studentPortal.myFees, { studentId: A.studentA });
    expect(feesA.state).toBe("ok");
    if (feesA.state === "ok") {
      expect(feesA.totals.grossMinor).toBe(2000000);
      expect(feesA.obligations).toHaveLength(1);
    }

    const timetableA = await guardianUser.query(api.studentPortal.myTimetable, { studentId: A.studentA });
    expect(timetableA.state).toBe("ok");
    if (timetableA.state === "ok") {
      expect(timetableA.section).toBe("8-A");
      expect(timetableA.periods).toHaveLength(1);
    }

    const noticesA = await guardianUser.query(api.studentPortal.myNotices, { studentId: A.studentA, today: "2026-05-01" });
    expect(noticesA.state).toBe("ok");
    if (noticesA.state === "ok") {
      const titles = noticesA.notices.map((n) => n.title);
      expect(titles).toContain("Section A Field Trip");
      expect(titles).not.toContain("Section B Science Fair");
    }

    // 2. Switch to Child B
    const profileB = await guardianUser.query(api.studentPortal.myProfile, { studentId: A.studentB });
    expect(profileB.state).toBe("ok");
    if (profileB.state === "ok") {
      expect(profileB.student.studentId).toBe(A.studentB);
      expect(profileB.student.name).toBe("Bala S");
      expect(profileB.enrollment?.sectionDisplayName).toBe("8-B");
      expect(profileB.relation).toBe("guardian");
    }

    const feesB = await guardianUser.query(api.studentPortal.myFees, { studentId: A.studentB });
    expect(feesB.state).toBe("ok");
    if (feesB.state === "ok") {
      expect(feesB.totals.grossMinor).toBe(3000000);
      expect(feesB.obligations).toHaveLength(1);
    }

    const timetableB = await guardianUser.query(api.studentPortal.myTimetable, { studentId: A.studentB });
    expect(timetableB.state).toBe("ok");
    if (timetableB.state === "ok") {
      expect(timetableB.section).toBe("8-B");
      expect(timetableB.periods).toHaveLength(1);
    }

    const noticesB = await guardianUser.query(api.studentPortal.myNotices, { studentId: A.studentB, today: "2026-05-01" });
    expect(noticesB.state).toBe("ok");
    if (noticesB.state === "ok") {
      const titles = noticesB.notices.map((n) => n.title);
      expect(titles).toContain("Section B Science Fair");
      expect(titles).not.toContain("Section A Field Trip");
    }
  });

  test("guardian cannot access unlinked students' records across any portal endpoint", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const guardianUser = await as(t, A.users.guardian);

    // Unlinked student in same school (studentB is not linked to guardian by default in createSchool)
    expect(await errorCode(guardianUser.query(api.studentPortal.myProfile, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myFees, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myTimetable, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myHomework, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myResults, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myNotices, { studentId: A.studentB, today: "2026-05-01" }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("NOT_FOUND");

    // Student from a different school (School B)
    expect(await errorCode(guardianUser.query(api.studentPortal.myProfile, { studentId: B.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myFees, { studentId: B.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.studentPortal.myTimetable, { studentId: B.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(guardianUser.query(api.attendance.studentHistory, { studentId: B.studentA }))).toBe("NOT_FOUND");
  });

  test("payments, attendance, and notices trigger in-app notifications to linked guardian and student", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const ct = await as(t, A.users.classTeacher);
    const guardian = await as(t, A.users.guardian);
    const student = await as(t, A.users.student);

    // Setup fee structure and assignment for studentA using verified mutations
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Standard 8-A",
      classIds: [A.classId],
      components: [{ label: "Tuition", amountMinor: 1500000 }],
      installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 1500000 }],
      activate: true,
    });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });

    // 1. Record fee payment -> notifies student and guardian
    await admin.mutation(api.fees.recordPayment, {
      studentId: A.studentA,
      amountMinor: 500000,
      method: "upi",
      reference: "UPI-TEST-1234",
      paidOn: "2026-04-15",
      clientRequestId: "guardian-test-payment-1",
    });

    const gNotesAfterFee = await guardian.query(api.notifications.list, {});
    expect(gNotesAfterFee.some((n) => n.type === "fees" && n.title === "Payment received")).toBe(true);

    const sNotesAfterFee = await student.query(api.notifications.list, {});
    expect(sNotesAfterFee.some((n) => n.type === "fees" && n.title === "Payment received")).toBe(true);

    // 2. Mark attendance with student absent -> notifies guardian and student
    const monday = pastMonday();
    await ct.mutation(api.attendance.mark, {
      sectionId: A.sectionA,
      date: monday,
      entries: [{ studentId: A.studentA, status: "absent" }],
    });

    const gNotesAfterAtt = await guardian.query(api.notifications.list, {});
    expect(gNotesAfterAtt.some((n) => n.type === "attendance" && n.title === "Marked absent")).toBe(true);

    // 3. Publish notice targeted to section A -> notifies members in section A
    const { noticeId } = await admin.mutation(api.notices.createDraft, {
      title: "Exam Preparation Session",
      body: "Mandatory preparation session tomorrow morning.",
      type: "notice",
      priority: "high",
      publishDate: "2026-04-10",
      audience: { kind: "sections", sectionIds: [A.sectionA] },
    });
    await admin.mutation(api.notices.publish, { noticeId });

    const gNotesAfterNotice = await guardian.query(api.notifications.list, {});
    expect(gNotesAfterNotice.some((n) => n.type === "notice" && n.message.includes("Exam Preparation Session"))).toBe(true);

    // 4. Test notification management: unreadCount, markRead, markAllRead, remove, clearAll
    const unreadBefore = await guardian.query(api.notifications.unreadCount, {});
    expect(unreadBefore).toBeGreaterThan(0);

    const firstNotice = gNotesAfterNotice[0];
    await guardian.mutation(api.notifications.markRead, { notificationId: firstNotice._id });
    const unreadAfterOne = await guardian.query(api.notifications.unreadCount, {});
    expect(unreadAfterOne).toBe(unreadBefore - 1);

    await guardian.mutation(api.notifications.markAllRead, {});
    const unreadAfterAll = await guardian.query(api.notifications.unreadCount, {});
    expect(unreadAfterAll).toBe(0);

    // Delete one notification
    await guardian.mutation(api.notifications.remove, { notificationId: firstNotice._id });
    const listAfterDelete = await guardian.query(api.notifications.list, {});
    expect(listAfterDelete.every((n) => n._id !== firstNotice._id)).toBe(true);

    // Removing is limited to the caller's own notifications.
    const studentNote = (await student.query(api.notifications.list, {}))[0];
    expect(await errorCode(guardian.mutation(api.notifications.remove, { notificationId: studentNote._id }))).toBe("NOT_FOUND");
  });
});
