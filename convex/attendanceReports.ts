/**
 * Attendance reports (Attendance): registers per section over a range, the per-month report and the low-attendance list. Moved from convex/reports.ts.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { moduleQuery } from "./core/functions";
import { requireModule } from "./model/modules";
import { getCurrentAcademicYearId, getInSchool, requireAnyPermission } from "./core/authorization";
import { conflict, invalid } from "./core/errors";
import { assertIsoDate } from "./core/validators";
import { daysBetween, isSchoolDay, todayIn } from "./model/calendar";
import { activeRoster, fullName } from "./model/academics";

const administrationQuery = moduleQuery("administration");
const MAX_REPORT_DAYS = 120;

export const attendanceSummary = administrationQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    await requireModule(ctx, ctx.actor.schoolId, "attendance"); // data comes from that module (administration checked by the wrapper)
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

/**
 * Attendance over a date range (≤ MAX_ATTENDANCE_REPORT_DAYS, school-local
 * dates; default: the current academic year up to today, capped): per month
 * and per section, from the register totals. Per-student percentages are not
 * computed here (they would read every attendance record of the range).
 */
export const MAX_ATTENDANCE_REPORT_DAYS = 366;

export const attendanceReport = administrationQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireModule(ctx, ctx.actor.schoolId, "attendance"); // data comes from that module (administration checked by the wrapper)
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

export const lowAttendance = administrationQuery({
  args: { sectionId: v.optional(v.id("sections")), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireModule(ctx, ctx.actor.schoolId, "attendance"); // data comes from that module (administration checked by the wrapper)
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
