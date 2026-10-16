/**
 * School settings, profile persistence, dashboards, and reporting reconciliation tests.
 * Covers AP-03 and AP-04 requirements with verified Convex backend queries and mutations.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest, pastMonday } from "./fixtures";

describe("AP-03: School settings and profile persistence", () => {
  test("school settings and profile can be fetched and updated with RBAC, validation, and tenancy isolation", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");

    const adminA = await as(t, A.users.admin);
    const teacherA = await as(t, A.users.classTeacher);
    const studentA = await as(t, A.users.student);
    const adminB = await as(t, B.users.admin);

    // 1. Fetch current settings for School A
    const initial = await adminA.query(api.schools.current, {});
    expect(initial.school.name).toBe("School alpha");
    expect(initial.school.code).toBe("AL");
    expect(initial.settings.attendance.lowAttendanceThreshold).toBe(85);
    expect(initial.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

    // 2. Permission checks: teacher and student cannot update settings or profile
    expect(
      await errorCode(
        teacherA.mutation(api.schools.updateProfile, { name: "Hacked School" }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(
        studentA.mutation(api.schools.updateSettings, {
          attendance: { lateCountsAsPresent: false, lowAttendanceThreshold: 75 },
        }),
      ),
    ).toBe("FORBIDDEN");

    // 3. Validation checks
    // Empty name rejected
    expect(
      await errorCode(adminA.mutation(api.schools.updateProfile, { name: "   " })),
    ).toBe("INVALID_ARGUMENT");
    // Invalid threshold (< 50 or > 100)
    expect(
      await errorCode(
        adminA.mutation(api.schools.updateSettings, {
          attendance: { lateCountsAsPresent: true, lowAttendanceThreshold: 40 },
        }),
      ),
    ).toBe("INVALID_ARGUMENT");
    expect(
      await errorCode(
        adminA.mutation(api.schools.updateSettings, {
          attendance: { lateCountsAsPresent: true, lowAttendanceThreshold: 105 },
        }),
      ),
    ).toBe("INVALID_ARGUMENT");
    // Invalid workingDays
    expect(
      await errorCode(
        adminA.mutation(api.schools.updateSettings, {
          workingDays: [1, 2, 8],
        }),
      ),
    ).toBe("INVALID_ARGUMENT");

    // 4. Admin updates school profile
    await adminA.mutation(api.schools.updateProfile, {
      name: "Aster Academy International",
      tagline: "Inspiring Excellence",
      address: "123 Knowledge Park, Bengaluru",
      phone: "+91 80 5555 1234",
      email: "info@asteracademy.edu",
      website: "https://asteracademy.edu",
      affiliation: "CBSE Affiliation #193045",
    });

    // 5. Admin updates school settings
    await adminA.mutation(api.schools.updateSettings, {
      workingDays: [1, 2, 3, 4, 5], // Mon-Fri
      attendance: { lateCountsAsPresent: false, lowAttendanceThreshold: 80 },
      grading: { scheme: "cbse_10_point", passPercentage: 40 },
      notifications: {
        attendanceAlerts: true,
        feeReminders: true,
        homeworkAlerts: true,
        examAlerts: false,
        noticeAlerts: true,
      },
    });

    // 6. Verify persistence in School A
    const updatedA = await adminA.query(api.schools.current, {});
    expect(updatedA.school.name).toBe("Aster Academy International");
    expect(updatedA.school.tagline).toBe("Inspiring Excellence");
    expect(updatedA.school.address).toBe("123 Knowledge Park, Bengaluru");
    expect(updatedA.school.phone).toBe("+91 80 5555 1234");
    expect(updatedA.school.affiliation).toBe("CBSE Affiliation #193045");
    expect(updatedA.settings.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(updatedA.settings.attendance.lowAttendanceThreshold).toBe(80);
    expect(updatedA.settings.attendance.lateCountsAsPresent).toBe(false);
    expect(updatedA.settings.grading.passPercentage).toBe(40);
    expect(updatedA.settings.notifications.examAlerts).toBe(false);

    // 7. Verify School B was NOT affected (tenant isolation)
    const schoolBData = await adminB.query(api.schools.current, {});
    expect(schoolBData.school.name).toBe("School beta");
    expect(schoolBData.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(schoolBData.settings.attendance.lowAttendanceThreshold).toBe(85);

    // 8. Verify public profile reflects updated branding
    const pub = await t.query(api.schools.publicProfile, { slug: "alpha" });
    expect(pub?.name).toBe("Aster Academy International");
    expect(pub?.tagline).toBe("Inspiring Excellence");
  });
});

describe("AP-04: Dashboards and reports reconciliation", () => {
  test("admin dashboard and aggregate reports reconcile accurately with underlying records", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const ct = await as(t, A.users.classTeacher);
    const student = await as(t, A.users.student);

    // Permission check: student cannot view admin dashboard
    expect(await errorCode(student.query(api.reports.adminDashboard, {}))).toBe("FORBIDDEN");

    // 1. Create fee structures and assign to studentA and studentB
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Standard 8 Annual",
      classIds: [A.classId],
      components: [{ label: "Tuition", amountMinor: 2000000 }],
      installments: [{ label: "Annual Fee", dueDate: "2026-05-01", amountMinor: 2000000 }],
    });

    await admin.mutation(api.fees.assignStructure, { structureId, studentId: A.studentA });
    await admin.mutation(api.fees.assignStructure, { structureId, studentId: A.studentB });

    // Apply concession to studentA: 200,000 minor units (₹2,000)
    await admin.mutation(api.fees.createConcession, {
      studentId: A.studentA,
      kind: "fixed",
      value: 200000,
      reason: "Merit scholarship",
    });

    // Record payment for studentA: 1,000,000 minor units (₹10,000)
    await admin.mutation(api.fees.recordPayment, {
      studentId: A.studentA,
      amountMinor: 1000000,
      method: "bank_transfer",
      reference: "NEFT-789012",
      paidOn: "2026-04-10",
    });

    // 2. Mark attendance for Section 8-A: 1 present
    const monday = pastMonday();
    await ct.mutation(api.attendance.mark, {
      sectionId: A.sectionA,
      date: monday,
      entries: [{ studentId: A.studentA, status: "present" }],
    });

    // 3. Create published notice
    await admin.mutation(api.notices.create, {
      title: "Welcome to Academic Year 2026-27",
      body: "We look forward to an inspiring academic session.",
      type: "notice",
      priority: "normal",
      status: "published",
      publishDate: "2026-04-01",
      audience: { kind: "all" },
    });

    // 4. Query admin dashboard and reconcile
    const dashboard = await admin.query(api.reports.adminDashboard, {});
    expect(dashboard).not.toBeNull();
    if (!dashboard) return;

    // Reconciliation:
    // Students enrolled: 2 (studentA, studentB)
    expect(dashboard.studentCount).toBe(2);
    // Teachers: 2 (classTeacher, subjectTeacher)
    expect(dashboard.teacherCount).toBe(2);

    // Fees:
    // studentA net: 2,000,000 - 200,000 = 1,800,000; paid: 1,000,000; outstanding: 800,000
    // studentB net: 2,000,000; paid: 0; outstanding: 2,000,000
    // totalNet: 3,800,000
    // totalCollected: 1,000,000
    // totalOutstanding: 2,800,000
    expect(dashboard.fees.totalNetMinor).toBe(3800000);
    expect(dashboard.fees.totalCollectedMinor).toBe(1000000);
    expect(dashboard.fees.totalOutstandingMinor).toBe(2800000);
    expect(dashboard.fees.feeCollectionRate).toBeCloseTo((1000000 / 3800000) * 100, 2);

    // Fee by class breakdown
    const grade8Fee = dashboard.fees.feeByClass.find((c: any) => c.name === "Grade 8");
    expect(grade8Fee).toBeDefined();
    expect(grade8Fee?.collected).toBe(1000000);
    expect(grade8Fee?.outstanding).toBe(2800000);

    // Attendance percentage: 1 session with 1 present -> 100%
    expect(dashboard.attendancePercentage).toBe(100);

    // Recent notices
    expect(dashboard.recentNotices.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.recentNotices.some((n: any) => n.title.includes("Welcome to Academic Year"))).toBe(true);

    // 5. Query studentStatistics
    const stats = await admin.query(api.reports.studentStatistics, {});
    expect(stats.totalEnrolled).toBe(2);
    expect(stats.uniqueGuardians).toBe(1);

    const g8Stat = stats.classStats.find((c: any) => c.name === "Grade 8");
    expect(g8Stat).toBeDefined();
    expect(g8Stat?.total).toBe(2);

    const sAStat = stats.sectionStats.find((s: any) => s.name === "8-A");
    expect(sAStat?.studentsCount).toBe(1);

    // 6. Query attendanceReport
    const attReport = await admin.query(api.reports.attendanceReport, {});
    expect(attReport.monthly.length).toBeGreaterThanOrEqual(1);
    const thisMonth = attReport.monthly.find((m: any) => m.month === monday.slice(0, 7));
    expect(thisMonth).toBeDefined();
    expect(thisMonth?.percentage).toBe(100);
    expect(thisMonth?.absentCount).toBe(0);
  });
});
