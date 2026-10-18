/**
 * Reports (A-06): read-only aggregates computed from persisted records.
 *
 *  - adminDashboard      `reports:read` (school figures) and/or `reports:finance` / `fees:manage` (fee figures)
 *  - studentStatistics   `reports:read`           enrolled students by class, gender, status, section fill
 *  - attendanceReport    `reports:read` or `attendance:read:all` — per month and per section over a range
 *
 *  - enrollmentSummary   `reports:read`           students by status; active enrollments per class/section (current year)
 *  - attendanceSummary   `reports:read` or `attendance:read:all` — registers in a date range per section, missing registers
 *  - feeSummary          `reports:finance` or `fees:manage` — billed / concession / collected / outstanding per class
 *  - examPerformance     `reports:read`           a published exam: averages, pass rate, per subject and per section
 *
 * Each student is counted once (by student id); every query is bounded and
 * scoped to the caller's school.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolQuery } from "./core/functions";
import { getCurrentAcademicYearId, getInSchool, hasPermission, requireAnyPermission, requirePermission } from "./core/authorization";
import { conflict, invalid } from "./core/errors";
import { assertIsoDate } from "./core/validators";
import { addDays, daysBetween, isSchoolDay, todayIn } from "./model/calendar";
import { computeLedger, standingOf } from "./model/feeMath";
import { schoolYearFees } from "./model/feeData";
import type { QueryCtx } from "./_generated/server";
import { audienceLabel } from "./notices";
import { activeRoster, fullName } from "./model/academics";
import type { Actor } from "./core/actor";

const MAX_STUDENTS = 5000;
const MAX_REPORT_DAYS = 120;

export const enrollmentSummary = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "reports:read");
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const byStatus: Record<string, number> = {};
    for (const status of ["active", "inactive", "alumni", "transferred"] as const) {
      const rows = await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", status)).take(MAX_STUDENTS + 1);
      if (rows.length > MAX_STUDENTS) throw conflict(`More than ${MAX_STUDENTS} ${status} students; this report needs pagination.`);
      byStatus[status] = rows.length;
    }
    const enrollments = (await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).take(MAX_STUDENTS * 2))
      .filter((e) => e.status === "active");
    const seen = new Set<Id<"students">>();
    const bySection = new Map<Id<"sections">, number>();
    for (const e of enrollments) {
      if (seen.has(e.studentId)) continue; // a student counts once even with a stray duplicate enrollment
      seen.add(e.studentId);
      bySection.set(e.sectionId, (bySection.get(e.sectionId) ?? 0) + 1);
    }
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    const classes = new Map<Id<"classes">, Doc<"classes"> | null>();
    const rows = [];
    for (const s of sections) {
      if (!classes.has(s.classId)) classes.set(s.classId, await ctx.db.get(s.classId));
      rows.push({ sectionId: s._id, section: s.displayName, classId: s.classId, className: classes.get(s.classId)?.name ?? "", level: classes.get(s.classId)?.level ?? 0, students: bySection.get(s._id) ?? 0 });
    }
    rows.sort((a, b) => a.level - b.level || a.section.localeCompare(b.section, undefined, { numeric: true }));
    const teachers = (await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "active")).collect()).length;
    return { academicYearId: yearId, studentsByStatus: byStatus, enrolledThisYear: seen.size, activeTeachers: teachers, sections: rows };
  },
});

export const attendanceSummary = schoolQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    requireAnyPermission(ctx.actor, ["reports:read", "attendance:read:all"]);
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    if (from > to) throw invalid("`from` must not be after `to`.");
    if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) throw invalid(`Ranges are limited to ${MAX_REPORT_DAYS} days.`);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const settings = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", school._id)).unique())!;
    const yearId = settings.currentAcademicYearId;
    const sections = yearId ? await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", yearId)).collect() : [];
    const sessions = (await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", school._id).gte("date", from).lte("date", to)).collect())
      .filter((s) => !yearId || s.academicYearId === yearId);
    const schoolDays: string[] = [];
    for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      if (await isSchoolDay(ctx, school, settings, d)) schoolDays.push(d);
    }
    const rows = sections.map((sec) => {
      const own = sessions.filter((s) => s.sectionId === sec._id);
      const counted = own.reduce((a, s) => a + s.presentCount + s.absentCount + s.lateCount, 0);
      const attended = own.reduce((a, s) => a + s.presentCount + (settings.attendance.lateCountsAsPresent ? s.lateCount : 0), 0);
      const markedDates = new Set(own.map((s) => s.date));
      return {
        sectionId: sec._id, section: sec.displayName, registers: own.length,
        missingRegisters: schoolDays.filter((d) => !markedDates.has(d)).length,
        present: own.reduce((a, s) => a + s.presentCount, 0), absent: own.reduce((a, s) => a + s.absentCount, 0),
        late: own.reduce((a, s) => a + s.lateCount, 0), excused: own.reduce((a, s) => a + s.excusedCount, 0),
        percentage: counted ? Math.round((attended / counted) * 1000) / 10 : null,
      };
    }).sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }));
    return { from, to, schoolDays: schoolDays.length, lowAttendanceThreshold: settings.attendance.lowAttendanceThreshold, sections: rows };
  },
});

/** Fee position for the year, per class. Reads each enrolled student's ledger once (≤ 5000 students). */
export const feeSummary = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    requireAnyPermission(ctx.actor, ["reports:finance", "fees:manage"]);
    const yearId = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const year = (await ctx.db.get(yearId))!;
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    return { academicYear: year.name, ...(await feeByClass(ctx, ctx.actor.schoolId, yearId, today)) };
  },
});

export const examPerformance = schoolQuery({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    requirePermission(ctx.actor, "reports:read");
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    if (exam.status !== "published") throw conflict("Performance reports use published results only.");
    const sections = new Map<Id<"sections">, { results: Doc<"results">[] }>();
    for (const classId of exam.classIds) {
      const secs = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", classId).eq("academicYearId", exam.academicYearId)).collect();
      for (const s of secs.filter((x) => x.schoolId === ctx.actor.schoolId)) {
        sections.set(s._id, { results: await ctx.db.query("results").withIndex("by_exam_section", (q) => q.eq("examId", exam._id).eq("sectionId", s._id)).collect() });
      }
    }
    const all = [...sections.values()].flatMap((s) => s.results);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
    const subjectStats = new Map<Id<"subjects">, { pct: number[]; passed: number; sat: number }>();
    for (const r of all) {
      for (const s of r.subjects) {
        const st = subjectStats.get(s.subjectId) ?? { pct: [], passed: 0, sat: 0 };
        st.sat++;
        if (s.passed) st.passed++;
        st.pct.push(s.isAbsent ? 0 : ((s.marks ?? 0) / s.maxMarks) * 100);
        subjectStats.set(s.subjectId, st);
      }
    }
    const subjects = [];
    for (const [subjectId, st] of subjectStats) {
      const subj = await ctx.db.get(subjectId);
      subjects.push({ subjectId, subject: subj?.name ?? "", averagePercentage: avg(st.pct), passRate: st.sat ? Math.round((st.passed / st.sat) * 1000) / 10 : null, students: st.sat });
    }
    const sectionRows = [];
    for (const [sectionId, { results }] of sections) {
      const s = await ctx.db.get(sectionId);
      sectionRows.push({ sectionId, section: s?.displayName ?? "", students: results.length, averagePercentage: avg(results.map((r) => r.percentage)), passRate: results.length ? Math.round((results.filter((r) => r.subjects.every((x) => x.passed)).length / results.length) * 1000) / 10 : null });
    }
    return {
      examId: exam._id, name: exam.name, students: all.length, averagePercentage: avg(all.map((r) => r.percentage)),
      passRate: all.length ? Math.round((all.filter((r) => r.subjects.every((x) => x.passed)).length / all.length) * 1000) / 10 : null,
      subjects: subjects.sort((a, b) => a.subject.localeCompare(b.subject)),
      sections: sectionRows.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true })),
    };
  },
});

// ================================================================ shared aggregates
type Ctx = QueryCtx & { actor: Actor };

/**
 * Billed / concession / collected / outstanding / overdue per class for a year,
 * from the bulk fee loads (model/feeData.ts) and the shared ledger arithmetic,
 * so it reconciles with every student's ledger. A student counts in the class
 * of their active (else latest) enrollment of the year.
 */
async function feeByClass(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, today: string) {
  const enrollments = await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).take(MAX_STUDENTS * 2 + 1);
  if (enrollments.length > MAX_STUDENTS * 2) throw conflict("Too many enrollments for one report.");
  const classOf = new Map<Id<"students">, Id<"classes">>();
  for (const e of enrollments) if (!classOf.has(e.studentId) || e.status === "active") classOf.set(e.studentId, e.classId);
  const data = await schoolYearFees(ctx, schoolId, yearId);
  type Row = { students: number; grossMinor: number; concessionMinor: number; paidMinor: number; outstandingMinor: number; overdueMinor: number };
  const perClass = new Map<Id<"classes"> | "none", Row>();
  for (const [studentId, obligations] of data.obligations) {
    const l = computeLedger(obligations, data.concessions.get(studentId) ?? [], data.payments.get(studentId) ?? []);
    if (l.rows.length === 0) continue;
    const key = classOf.get(studentId) ?? "none";
    const row = perClass.get(key) ?? { students: 0, grossMinor: 0, concessionMinor: 0, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0 };
    row.students++;
    row.grossMinor += l.totals.grossMinor;
    row.concessionMinor += l.totals.concessionMinor;
    row.paidMinor += l.totals.paidMinor;
    row.outstandingMinor += l.totals.outstandingMinor;
    row.overdueMinor += standingOf(l.rows, today).overdueMinor;
    perClass.set(key, row);
  }
  type ClassRow = Row & { classId: Id<"classes"> | null; className: string; level: number };
  const classes: ClassRow[] = [];
  for (const [classId, row] of perClass) {
    const c = classId === "none" ? null : await ctx.db.get(classId);
    classes.push({ classId: classId === "none" ? null : classId, className: c?.name ?? "No enrollment", level: c?.level ?? 99, ...row });
  }
  classes.sort((a, b) => a.level - b.level);
  const sum = (k: keyof Row) => classes.reduce((a, c) => a + c[k], 0);
  return { classes, totals: { grossMinor: sum("grossMinor"), concessionMinor: sum("concessionMinor"), paidMinor: sum("paidMinor"), outstandingMinor: sum("outstandingMinor"), overdueMinor: sum("overdueMinor") } };
}

/** Per-section and whole-school attendance for one date (registers marked that day). */
async function attendanceOn(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, date: string, lateCounts: boolean) {
  const sessions = (await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("date", date)).collect()).filter((s) => s.academicYearId === yearId);
  const counted = sessions.reduce((a, s) => a + s.presentCount + s.absentCount + s.lateCount, 0);
  const attended = sessions.reduce((a, s) => a + s.presentCount + (lateCounts ? s.lateCount : 0), 0);
  return { marked: sessions.length, absent: sessions.reduce((a, s) => a + s.absentCount, 0), percentage: counted ? Math.round((attended / counted) * 1000) / 10 : null, sectionIds: new Set(sessions.map((s) => s.sectionId)) };
}

// ================================================================ admin dashboard
/**
 * Everything the admin dashboard shows, from persisted records only. Sections
 * the caller may not see are `null` (not zero): school figures need
 * `reports:read`; fee figures need `reports:finance` or `fees:manage` (so a
 * finance-only "accountant" sees the fee cards and nothing else).
 * Attendance percentage excludes excused entries; late counts as present when
 * the school setting says so. Dates are school-local.
 */
export const adminDashboard = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requireAnyPermission(ctx.actor, ["reports:read", "reports:finance", "fees:manage"]);
    const schoolWide = hasPermission(ctx.actor, "reports:read");
    const finance = hasPermission(ctx.actor, "reports:finance") || hasPermission(ctx.actor, "fees:manage");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const settings = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", school._id)).unique())!;
    const today = todayIn(school.timezone);
    const yearId = settings.currentAcademicYearId ?? null;
    const year = yearId ? await ctx.db.get(yearId) : null;
    const base = { school: { name: school.name, shortName: school.shortName, code: school.code }, academicYear: year ? { academicYearId: year._id, name: year.name } : null, today };
    if (!year) return { ...base, overview: null, fees: null };

    let overview = null;
    if (schoolWide) {
      const enrollments = (await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", year._id)).take(MAX_STUDENTS * 2 + 1)).filter((e) => e.status === "active");
      const students = new Set(enrollments.map((e) => e.studentId)).size;
      const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", year._id)).collect();
      const teachers = await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", school._id).eq("status", "active")).collect();
      const approved = await ctx.db.query("leaveRequests").withIndex("by_school_status_from", (q) => q.eq("schoolId", school._id).eq("status", "approved").lte("fromDate", today)).collect();
      const onLeave = new Set(approved.filter((l) => l.toDate >= today).map((l) => l.teacherId)).size;
      const pendingLeave = (await ctx.db.query("leaveRequests").withIndex("by_school_status_from", (q) => q.eq("schoolId", school._id).eq("status", "pending")).take(500)).length;
      const lateCounts = settings.attendance.lateCountsAsPresent;
      // Attendance: today if any register is marked, else the latest marked date (within 60 days).
      const recent = await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", school._id).gte("date", addDays(today, -60)).lte("date", today)).order("desc").take(3000);
      const dates = [...new Set(recent.filter((s) => s.academicYearId === year._id).map((s) => s.date))].sort().reverse();
      const attDate = dates[0] ?? null;
      const att = attDate ? await attendanceOn(ctx, school._id, year._id, attDate, lateCounts) : null;
      const prev = dates[1] ? await attendanceOn(ctx, school._id, year._id, dates[1], lateCounts) : null;
      const todaySchoolDay = await isSchoolDay(ctx, school, settings, today);
      const markedToday = attDate === today && att ? att.sectionIds.size : 0;
      const trend = [];
      for (const d of dates.slice(0, 15).reverse()) {
        const a = await attendanceOn(ctx, school._id, year._id, d, lateCounts);
        trend.push({ date: d, percentage: a.percentage });
      }
      // Latest published exam: class averages from the published result snapshots.
      const exams = await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", year._id)).collect();
      const published = exams.filter((e) => e.status === "published").sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
      const performance: { name: string; average: number }[] = [];
      if (published) {
        for (const classId of published.classIds) {
          const c = await ctx.db.get(classId);
          const secs = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", classId).eq("academicYearId", year._id)).collect();
          const pct: number[] = [];
          for (const s of secs) for (const r of await ctx.db.query("results").withIndex("by_exam_section", (q) => q.eq("examId", published._id).eq("sectionId", s._id)).collect()) pct.push(r.percentage);
          if (pct.length) performance.push({ name: c?.name ?? "", average: Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10 });
        }
      }
      const upcomingExams = [];
      for (const e of exams.filter((x) => x.status !== "published" && x.endDate >= addDays(today, -30)).sort((a, b) => a.startDate.localeCompare(b.startDate))) {
        let papers = 0;
        for (const classId of e.classIds) papers += (await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", e._id).eq("classId", classId)).collect()).length;
        upcomingExams.push({ examId: e._id, name: e.name, status: e.status, startDate: e.startDate, endDate: e.endDate, classCount: e.classIds.length, paperCount: papers });
      }
      const noticeRows = (await ctx.db.query("notices").withIndex("by_school_status_publish", (q) => q.eq("schoolId", school._id).eq("status", "published").lte("publishDate", today)).order("desc").take(20))
        .filter((n) => !n.expiresOn || n.expiresOn >= today).slice(0, 4);
      const notices = [];
      for (const n of noticeRows) notices.push({ noticeId: n._id, title: n.title, body: n.body, type: n.type, priority: n.priority, publishDate: n.publishDate, eventDate: n.eventDate ?? null, audienceLabel: await audienceLabel(ctx as Ctx, n.audience) });
      overview = {
        students, sections: sections.length, teachers: teachers.length, teachersOnLeave: onLeave,
        attendance: att ? { date: attDate!, isToday: attDate === today, percentage: att.percentage, absent: att.absent, marked: att.marked, totalSections: sections.length, delta: att.percentage !== null && prev?.percentage != null ? Math.round((att.percentage - prev.percentage) * 10) / 10 : null } : null,
        attendanceTrend: trend,
        performance: { examName: published?.name ?? null, rows: performance },
        upcomingExams, notices,
        tasks: { unmarkedToday: todaySchoolDay ? sections.length - markedToday : 0, pendingLeave, isSchoolDay: todaySchoolDay },
      };
    }

    let fees = null;
    if (finance) {
      const byClass = await feeByClass(ctx, school._id, year._id, today);
      const data = await schoolYearFees(ctx, school._id, year._id);
      let overdueStudents = 0;
      for (const [studentId, obligations] of data.obligations) {
        const l = computeLedger(obligations, data.concessions.get(studentId) ?? [], data.payments.get(studentId) ?? []);
        if (standingOf(l.rows, today).overdueMinor > 0) overdueStudents++;
      }
      const net = byClass.totals.grossMinor - byClass.totals.concessionMinor;
      fees = {
        outstandingMinor: byClass.totals.outstandingMinor, overdueMinor: byClass.totals.overdueMinor, overdueStudents, collectedMinor: byClass.totals.paidMinor, netMinor: net,
        collectionRate: net > 0 ? Math.round((byClass.totals.paidMinor / net) * 1000) / 10 : 0,
        byClass: byClass.classes.map((c) => ({ name: c.className, collectedMinor: c.paidMinor, outstandingMinor: c.outstandingMinor })),
      };
    }
    return { ...base, overview, fees };
  },
});

// ================================================================ student statistics
/** Students enrolled this year: by class and gender, by status, section fill, distinct guardians. */
export const studentStatistics = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "reports:read");
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const enrollments = await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).take(MAX_STUDENTS * 2 + 1);
    if (enrollments.length > MAX_STUDENTS * 2) throw conflict("Too many enrollments for one report.");
    // One row per student: the active enrollment if any, else the latest.
    const latest = new Map<Id<"students">, Doc<"enrollments">>();
    for (const e of enrollments) {
      const cur = latest.get(e.studentId);
      if (!cur || e.status === "active" || (cur.status !== "active" && e._creationTime > cur._creationTime)) latest.set(e.studentId, e);
    }
    const status: Record<string, number> = { active: 0, inactive: 0, transferred: 0, alumni: 0 };
    const byClassMap = new Map<Id<"classes">, { male: number; female: number; other: number; total: number }>();
    const bySectionCount = new Map<Id<"sections">, number>();
    const guardians = new Set<string>();
    for (const [studentId, e] of latest) {
      const st = await ctx.db.get(studentId);
      if (!st || st.schoolId !== ctx.actor.schoolId) continue;
      status[st.status] = (status[st.status] ?? 0) + 1;
      if (e.status !== "active" || st.status !== "active") continue;
      const row = byClassMap.get(e.classId) ?? { male: 0, female: 0, other: 0, total: 0 };
      if (st.gender === "male") row.male++;
      else if (st.gender === "female") row.female++;
      else row.other++;
      row.total++;
      byClassMap.set(e.classId, row);
      bySectionCount.set(e.sectionId, (bySectionCount.get(e.sectionId) ?? 0) + 1);
      for (const l of await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) if (l.schoolId === ctx.actor.schoolId) guardians.add(l.guardianId);
    }
    const classes = await ctx.db.query("classes").withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    const level = new Map(classes.map((c) => [c._id, c.level]));
    return {
      total: [...latest.values()].filter((e) => e.status === "active").length,
      status,
      byClass: classes.filter((c) => byClassMap.has(c._id)).sort((a, b) => a.level - b.level).map((c) => ({ classId: c._id, name: c.name, ...byClassMap.get(c._id)! })),
      bySection: sections.sort((a, b) => (level.get(a.classId) ?? 0) - (level.get(b.classId) ?? 0) || a.name.localeCompare(b.name)).map((s) => ({ sectionId: s._id, label: s.displayName, students: bySectionCount.get(s._id) ?? 0, capacity: s.capacity ?? null })),
      guardians: guardians.size,
    };
  },
});

// ================================================================ attendance report
/**
 * Attendance over a date range (≤ MAX_ATTENDANCE_REPORT_DAYS, school-local
 * dates; default: the current academic year up to today, capped): per month
 * and per section, from the register totals. Per-student percentages are not
 * computed here (they would read every attendance record of the range).
 */
export const MAX_ATTENDANCE_REPORT_DAYS = 366;
export const attendanceReport = schoolQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requireAnyPermission(ctx.actor, ["reports:read", "attendance:read:all"]);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const settings = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", school._id)).unique())!;
    const today = todayIn(school.timezone);
    const yearId = await getCurrentAcademicYearId(ctx, school._id);
    const year = (await ctx.db.get(yearId))!;
    const to = a.to ?? (today < year.endDate ? today : year.endDate);
    const from = a.from ?? year.startDate;
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    if (from > to) throw invalid("`from` must not be after `to`.");
    if (daysBetween(from, to) + 1 > MAX_ATTENDANCE_REPORT_DAYS) throw invalid(`Ranges are limited to ${MAX_ATTENDANCE_REPORT_DAYS} days.`);
    const sessions = (await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", school._id).gte("date", from).lte("date", to)).take(20001));
    if (sessions.length > 20000) throw conflict("Too many registers in this range; choose a shorter range.");
    const lateCounts = settings.attendance.lateCountsAsPresent;
    const monthly = new Map<string, { ok: number; total: number; late: number; absent: number; registers: number }>();
    const bySection = new Map<Id<"sections">, { ok: number; total: number; registers: number }>();
    for (const s of sessions.filter((x) => x.academicYearId === yearId)) {
      const counted = s.presentCount + s.absentCount + s.lateCount;
      const ok = s.presentCount + (lateCounts ? s.lateCount : 0);
      const m = monthly.get(s.date.slice(0, 7)) ?? { ok: 0, total: 0, late: 0, absent: 0, registers: 0 };
      m.ok += ok; m.total += counted; m.late += s.lateCount; m.absent += s.absentCount; m.registers++;
      monthly.set(s.date.slice(0, 7), m);
      const b = bySection.get(s.sectionId) ?? { ok: 0, total: 0, registers: 0 };
      b.ok += ok; b.total += counted; b.registers++;
      bySection.set(s.sectionId, b);
    }
    const pct = (ok: number, total: number) => (total ? Math.round((ok / total) * 1000) / 10 : null);
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", yearId)).collect();
    const classes = new Map<Id<"classes">, number>();
    for (const s of sections) if (!classes.has(s.classId)) classes.set(s.classId, (await ctx.db.get(s.classId))?.level ?? 0);
    return {
      from, to, threshold: settings.attendance.lowAttendanceThreshold, lateCountsAsPresent: lateCounts,
      monthly: [...monthly.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([month, v]) => ({ month, percentage: pct(v.ok, v.total), late: v.late, absent: v.absent, registers: v.registers })),
      bySection: sections
        .sort((x, y) => (classes.get(x.classId) ?? 0) - (classes.get(y.classId) ?? 0) || x.name.localeCompare(y.name))
        .map((s) => { const b = bySection.get(s._id); return { sectionId: s._id, label: s.displayName, registers: b?.registers ?? 0, percentage: b ? pct(b.ok, b.total) : null }; }),
    };
  },
});

/**
 * Students below the school's low-attendance threshold
 * (settings.attendance.lowAttendanceThreshold), per student, from the stored
 * attendance records of the current academic year (default: year start → today).
 * Pass `sectionId` to limit it to one section. Late counts as present only when the
 * school says so; excused days are left out of the denominator. Students with no
 * marked days are not listed. Bounded: a whole-school range that would read more
 * than MAX_LOW_ATTENDANCE_RECORDS records asks the caller to choose a section.
 */
export const MAX_LOW_ATTENDANCE_RECORDS = 15000;
export const lowAttendance = schoolQuery({
  args: { sectionId: v.optional(v.id("sections")), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requireAnyPermission(ctx.actor, ["reports:read", "attendance:read:all"]);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const settings = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", school._id)).unique())!;
    const threshold = settings.attendance.lowAttendanceThreshold;
    const lateCounts = settings.attendance.lateCountsAsPresent;
    const yearId = await getCurrentAcademicYearId(ctx, school._id);
    const year = (await ctx.db.get(yearId))!;
    const today = todayIn(school.timezone);
    const to = a.to ?? (today < year.endDate ? today : year.endDate);
    const from = a.from ?? year.startDate;
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    if (from > to) throw invalid("`from` must not be after `to`.");
    if (daysBetween(from, to) + 1 > MAX_ATTENDANCE_REPORT_DAYS) throw invalid(`Ranges are limited to ${MAX_ATTENDANCE_REPORT_DAYS} days.`);

    let sections: Doc<"sections">[];
    if (a.sectionId) {
      const s = await getInSchool(ctx, "sections", a.sectionId, "Section");
      if (s.academicYearId !== yearId) throw invalid("Choose a section of the current academic year.");
      sections = [s];
    } else {
      sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", yearId)).collect();
    }

    let read = 0;
    const students: { studentId: Id<"students">; name: string; admissionNo: string; classLabel: string; sectionId: Id<"sections">; present: number; late: number; absent: number; counted: number; percentage: number }[] = [];
    for (const section of sections) {
      const sessions = (await ctx.db.query("attendanceSessions").withIndex("by_section_date", (q) => q.eq("sectionId", section._id).gte("date", from).lte("date", to)).collect())
        .filter((s) => s.schoolId === school._id && s.academicYearId === yearId);
      const tally = new Map<string, { present: number; late: number; absent: number }>();
      for (const session of sessions) {
        const records = await ctx.db.query("attendanceRecords").withIndex("by_session_student", (q) => q.eq("sessionId", session._id)).collect();
        read += records.length;
        if (read > MAX_LOW_ATTENDANCE_RECORDS) throw conflict("Too many attendance records to scan for the whole school; choose a section or a shorter range.");
        for (const r of records) {
          const t = tally.get(r.studentId) ?? { present: 0, late: 0, absent: 0 };
          if (r.status === "present") t.present++;
          else if (r.status === "late") t.late++;
          else if (r.status === "absent") t.absent++;
          tally.set(r.studentId, t);
        }
      }
      for (const { student } of await activeRoster(ctx, section._id)) {
        const t = tally.get(student._id);
        if (!t) continue;
        const counted = t.present + t.late + t.absent;
        if (counted === 0) continue;
        const percentage = Math.round(((t.present + (lateCounts ? t.late : 0)) / counted) * 1000) / 10;
        if (percentage >= threshold) continue;
        students.push({ studentId: student._id, name: fullName(student), admissionNo: student.admissionNo, classLabel: section.displayName, sectionId: section._id, ...t, counted, percentage });
      }
    }
    students.sort((x, y) => x.percentage - y.percentage || x.name.localeCompare(y.name));
    return { from, to, threshold, lateCountsAsPresent: lateCounts, students };
  },
});
