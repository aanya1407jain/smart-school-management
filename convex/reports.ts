/**
 * Dashboards and reporting aggregate queries backed by real Convex tables.
 *
 * Provides reconciled statistics for student enrollment, attendance,
 * fee collection, and academic performance.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolQuery } from "./core/functions";
import { getSchoolSettings, requirePermission } from "./core/authorization";
import { currentYear, feeLedger } from "./model/studentRecords";

export const adminDashboard = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "reports:read");
    const school = await ctx.db.get(ctx.actor.schoolId);
    if (!school) return null;

    const year = await currentYear(ctx, ctx.actor.schoolId);
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);

    // Students enrolled in current year
    const enrollments = year
      ? (
          await ctx.db
            .query("enrollments")
            .withIndex("by_school_year", (q) =>
              q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id),
            )
            .collect()
        ).filter((e) => e.status === "active")
      : [];

    const studentIds = new Set(enrollments.map((e) => e.studentId));
    const studentCount = studentIds.size;

    // Teachers count
    const teachers = await ctx.db
      .query("teachers")
      .withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "active"))
      .collect();
    const teacherCount = teachers.length;

    // Fees reconciliation
    let totalNetMinor = 0;
    let totalCollectedMinor = 0;
    let totalOutstandingMinor = 0;
    let totalOverdueMinor = 0;
    let overdueStudentsCount = 0;

    const today = new Date().toISOString().slice(0, 10);

    // Group active students by class
    const classFeeMap = new Map<Id<"classes">, { name: string; collected: number; outstanding: number }>();
    if (year) {
      const classes = await ctx.db
        .query("classes")
        .withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId))
        .collect();

      for (const c of classes) {
        classFeeMap.set(c._id, { name: c.name, collected: 0, outstanding: 0 });
      }

      for (const e of enrollments) {
        const student = await ctx.db.get(e.studentId);
        if (!student || student.status !== "active") continue;

        const ledger = await feeLedger(ctx, student, year);
        const net = ledger.totals.grossMinor - ledger.totals.concessionMinor;
        const paid = ledger.totals.paidMinor;
        const out = ledger.totals.outstandingMinor;

        totalNetMinor += net;
        totalCollectedMinor += paid;
        totalOutstandingMinor += out;

        let hasOverdue = false;
        for (const ob of ledger.obligations) {
          if (ob.dueDate < today && ob.outstandingMinor > 0) {
            totalOverdueMinor += ob.outstandingMinor;
            hasOverdue = true;
          }
        }
        if (hasOverdue) overdueStudentsCount += 1;

        const cEntry = classFeeMap.get(e.classId);
        if (cEntry) {
          cEntry.collected += paid;
          cEntry.outstanding += out;
        }
      }
    }

    const feeByClass = Array.from(classFeeMap.values());
    const feeCollectionRate = totalNetMinor > 0 ? (totalCollectedMinor / totalNetMinor) * 100 : 0;

    // Attendance stats: find today's marked sessions, or latest marked sessions
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school_date", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .order("desc")
      .take(50);

    let attendancePercentage: number | null = null;
    let latestAttendanceDate: string | null = null;

    if (sessions.length > 0) {
      latestAttendanceDate = sessions[0].date;
      const latestSessions = sessions.filter((s) => s.date === latestAttendanceDate);
      let total = 0;
      let ok = 0;
      for (const s of latestSessions) {
        const present = s.presentCount;
        const late = settings.attendance.lateCountsAsPresent ? s.lateCount : 0;
        ok += present + late;
        total += s.presentCount + s.absentCount + s.lateCount + s.excusedCount;
      }
      if (total > 0) attendancePercentage = Math.round((ok / total) * 100);
    }

    // Published notices
    const recentNotices = await ctx.db
      .query("notices")
      .withIndex("by_school_status_publish", (q) =>
        q.eq("schoolId", ctx.actor.schoolId).eq("status", "published").lte("publishDate", today),
      )
      .order("desc")
      .take(5);

    const noticesSummary = recentNotices.map((n) => ({
      id: n._id,
      title: n.title,
      type: n.type,
      priority: n.priority,
      publishDate: n.publishDate,
      audienceKind: n.audience.kind,
    }));

    return {
      school: {
        name: school.name,
        shortName: school.shortName,
        code: school.code,
      },
      academicYear: year ? year.name : null,
      studentCount,
      teacherCount,
      attendancePercentage,
      latestAttendanceDate,
      fees: {
        totalNetMinor,
        totalCollectedMinor,
        totalOutstandingMinor,
        totalOverdueMinor,
        feeCollectionRate,
        overdueStudentsCount,
        feeByClass,
      },
      recentNotices: noticesSummary,
    };
  },
});

export const studentStatistics = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "reports:read");
    const year = await currentYear(ctx, ctx.actor.schoolId);

    const enrollments = year
      ? (
          await ctx.db
            .query("enrollments")
            .withIndex("by_school_year", (q) =>
              q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id),
            )
            .collect()
        ).filter((e) => e.status === "active")
      : [];

    const classes = await ctx.db
      .query("classes")
      .withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();

    const classStats = [];
    for (const c of classes) {
      const cEnr = enrollments.filter((e) => e.classId === c._id);
      let male = 0;
      let female = 0;
      let other = 0;
      for (const e of cEnr) {
        const s = await ctx.db.get(e.studentId);
        if (s?.gender === "male") male += 1;
        else if (s?.gender === "female") female += 1;
        else other += 1;
      }
      classStats.push({
        classId: c._id,
        name: c.name,
        male,
        female,
        other,
        total: cEnr.length,
      });
    }

    const sections = await ctx.db
      .query("sections")
      .withIndex("by_school_year", (q) =>
        year
          ? q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)
          : q.eq("schoolId", ctx.actor.schoolId),
      )
      .collect();

    const sectionStats = [];
    for (const sec of sections) {
      const sEnr = enrollments.filter((e) => e.sectionId === sec._id);
      sectionStats.push({
        sectionId: sec._id,
        name: sec.displayName ?? sec.name,
        studentsCount: sEnr.length,
        capacity: sec.capacity ?? 40,
      });
    }

    // Unique guardians count for active enrolled students
    const guardianIds = new Set<Id<"guardians">>();
    for (const e of enrollments) {
      const links = await ctx.db
        .query("guardianLinks")
        .withIndex("by_student", (q) => q.eq("studentId", e.studentId))
        .collect();
      for (const l of links) {
        if (l.schoolId === ctx.actor.schoolId) guardianIds.add(l.guardianId);
      }
    }

    return {
      totalEnrolled: enrollments.length,
      classStats,
      sectionStats,
      uniqueGuardians: guardianIds.size,
    };
  },
});

export const attendanceReport = schoolQuery({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "reports:read");
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    const threshold = settings.attendance.lowAttendanceThreshold;

    let sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school_date", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();

    if (args.startDate) sessions = sessions.filter((s) => s.date >= args.startDate!);
    if (args.endDate) sessions = sessions.filter((s) => s.date <= args.endDate!);

    const monthlyMap = new Map<string, { ok: number; total: number; absent: number; late: number }>();
    const sectionMap = new Map<Id<"sections">, { ok: number; total: number }>();

    for (const s of sessions) {
      const month = s.date.slice(0, 7);
      const mEntry = monthlyMap.get(month) ?? { ok: 0, total: 0, absent: 0, late: 0 };
      const present = s.presentCount + (settings.attendance.lateCountsAsPresent ? s.lateCount : 0);
      const total = s.presentCount + s.absentCount + s.lateCount + s.excusedCount;

      mEntry.ok += present;
      mEntry.total += total;
      mEntry.absent += s.absentCount;
      mEntry.late += s.lateCount;
      monthlyMap.set(month, mEntry);

      const secEntry = sectionMap.get(s.sectionId) ?? { ok: 0, total: 0 };
      secEntry.ok += present;
      secEntry.total += total;
      sectionMap.set(s.sectionId, secEntry);
    }

    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        percentage: data.total > 0 ? (data.ok / data.total) * 100 : 0,
        absentCount: data.absent,
        lateCount: data.late,
      }));

    const bySection = [];
    for (const [secId, data] of sectionMap.entries()) {
      const sec = await ctx.db.get(secId);
      bySection.push({
        sectionId: secId,
        label: sec?.displayName ?? sec?.name ?? "Section",
        percentage: data.total > 0 ? (data.ok / data.total) * 100 : 0,
      });
    }

    return {
      monthly,
      bySection,
      threshold,
    };
  },
});
