/**
 * Attendance read models used by other modules through providers
 * (contracts/providers.ts): a student's records and totals for a year, the
 * "records exist" guard used by promotion rollback, and the calendar guard
 * that stops a holiday covering days whose registers are already marked.
 * Moved here from model/studentRecords.ts, model/lifecycle.ts and events.ts so
 * that no other module reads attendance tables.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { CalendarConflictProvider, ProviderContracts, RegisterStatusProvider, StudentAttendanceProvider } from "../contracts/providers";
import type { AttendanceOverviewProvider } from "../contracts/providers";
import { addDays } from "./calendar";

/** Day-by-day attendance in the academic year (≤ 366 rows). */
export async function studentAttendanceInYear(ctx: QueryCtx, studentId: Id<"students">, year: Pick<Doc<"academicYears">, "startDate" | "endDate">) {
  const rows = await ctx.db
    .query("attendanceRecords")
    .withIndex("by_student_date", (q) => q.eq("studentId", studentId).gte("date", year.startDate).lte("date", year.endDate))
    .collect();
  return rows.map((r) => ({ date: r.date, status: r.status, remark: r.remark ?? null }));
}

/**
 * Working days and days attended in one academic year: every register the
 * student was on counts as a working day; present (and late, when the school
 * counts late as present) count as attended.
 */
export async function attendanceTotals(ctx: QueryCtx, studentId: Id<"students">, year: Pick<Doc<"academicYears">, "startDate" | "endDate">, upTo: string, lateCounts: boolean) {
  const end = upTo < year.endDate ? upTo : year.endDate;
  const records = await ctx.db.query("attendanceRecords").withIndex("by_student_date", (q) => q.eq("studentId", studentId).gte("date", year.startDate).lte("date", end)).collect();
  const attended = records.filter((r) => r.status === "present" || (lateCounts && r.status === "late")).length;
  return { workingDays: records.length, attendedDays: attended };
}

const studentRecords: StudentAttendanceProvider = {
  recordsInYear: (ctx: QueryCtx, studentId: Id<"students">, year: Pick<Doc<"academicYears">, "startDate" | "endDate">) => studentAttendanceInYear(ctx, studentId, year),
  totals: (ctx: QueryCtx, studentId: Id<"students">, year: Pick<Doc<"academicYears">, "startDate" | "endDate">, upTo: string, lateCounts: boolean) => attendanceTotals(ctx, studentId, year, upTo, lateCounts),
  async hasRecordsBetween(ctx: QueryCtx, studentId: Id<"students">, from: string, to: string) {
    return !!(await ctx.db.query("attendanceRecords").withIndex("by_student_date", (q) => q.eq("studentId", studentId).gte("date", from).lte("date", to)).first());
  },
};

const calendarConflicts: CalendarConflictProvider = {
  async holidayConflict(ctx: QueryCtx, schoolId: Id<"schools">, from: string, to: string) {
    const marked = await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).gte("date", from).lte("date", to)).first();
    return marked ? `Attendance is already marked on ${marked.date}; a holiday cannot cover that date.` : null;
  },
};

const registers: RegisterStatusProvider = {
  async markedOn(ctx: QueryCtx, sectionId: Id<"sections">, date: string) {
    return !!(await ctx.db.query("attendanceSessions").withIndex("by_section_date", (q) => q.eq("sectionId", sectionId).eq("date", date)).first());
  },
};

export const attendanceProviders = {
  "attendance.studentRecords": studentRecords,
  "attendance.calendarConflicts": calendarConflicts,
  "attendance.registers": registers,
} satisfies Pick<ProviderContracts, "attendance.studentRecords" | "attendance.calendarConflicts" | "attendance.registers">;

/** Per-section and whole-school attendance for one date (registers marked that day). */
export async function attendanceOn(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, date: string, lateCounts: boolean) {
  const sessions = (await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("date", date)).collect()).filter((s) => s.academicYearId === yearId);
  const counted = sessions.reduce((a, s) => a + s.presentCount + s.absentCount + s.lateCount, 0);
  const attended = sessions.reduce((a, s) => a + s.presentCount + (lateCounts ? s.lateCount : 0), 0);
  return { marked: sessions.length, present: attended, counted, absent: sessions.reduce((a, s) => a + s.absentCount, 0), percentage: counted ? Math.round((attended / counted) * 1000) / 10 : null, sectionIds: new Set(sessions.map((s) => s.sectionId)) };
}

/** The admin dashboard's attendance, leave and register figures (moved from reports.adminDashboard). */
const overview: AttendanceOverviewProvider = {
  async dashboard(ctx: QueryCtx, a: { schoolId: Id<"schools">; yearId: Id<"academicYears">; today: string; lateCounts: boolean; isSchoolDay: boolean; sectionCount: number }) {
    const approved = await ctx.db.query("leaveRequests").withIndex("by_school_status_from", (q) => q.eq("schoolId", a.schoolId).eq("status", "approved").lte("fromDate", a.today)).collect();
    const teachersOnLeave = new Set(approved.filter((l) => l.toDate >= a.today).map((l) => l.teacherId)).size;
    const pendingLeave = (await ctx.db.query("leaveRequests").withIndex("by_school_status_from", (q) => q.eq("schoolId", a.schoolId).eq("status", "pending")).take(500)).length;
    // Attendance: today if any register is marked, else the latest marked date (within 60 days).
    const recent = await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", a.schoolId).gte("date", addDays(a.today, -60)).lte("date", a.today)).order("desc").take(3000);
    const dates = [...new Set(recent.filter((s) => s.academicYearId === a.yearId).map((s) => s.date))].sort().reverse();
    const attDate = dates[0] ?? null;
    const att = attDate ? await attendanceOn(ctx, a.schoolId, a.yearId, attDate, a.lateCounts) : null;
    const prev = dates[1] ? await attendanceOn(ctx, a.schoolId, a.yearId, dates[1], a.lateCounts) : null;
    const markedToday = attDate === a.today && att ? att.sectionIds.size : 0;
    const trend = [];
    for (const d of dates.slice(0, 15).reverse()) {
      const x = await attendanceOn(ctx, a.schoolId, a.yearId, d, a.lateCounts);
      trend.push({ date: d, percentage: x.percentage, present: x.present, counted: x.counted });
    }
    return {
      teachersOnLeave, pendingLeave,
      attendance: att ? { date: attDate!, isToday: attDate === a.today, percentage: att.percentage, absent: att.absent, marked: att.marked, totalSections: a.sectionCount, delta: att.percentage !== null && prev?.percentage != null ? Math.round((att.percentage - prev.percentage) * 10) / 10 : null } : null,
      attendanceTrend: trend,
      unmarkedToday: a.isSchoolDay ? a.sectionCount - markedToday : 0,
    };
  },
};
export const attendanceOverviewProviders = { "attendance.overview": overview } satisfies Pick<ProviderContracts, "attendance.overview">;
