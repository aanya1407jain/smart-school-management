/**
 * Admin dashboard (Core): read-only figures from persisted records.
 *
 *  - adminDashboard   `reports:read` (school figures) and/or `reports:finance` / `fees:manage` (fee figures)
 *
 * Module figures come from the owning modules through providers
 * (core/registry.ts) and follow the school's entitlements: students
 * (Students), attendance / leave / register tasks (Attendance), exams
 * (Examinations, "academics" key), fees (Fees, "finance" key). A module that
 * is not shipped, or disabled, leaves its panel null / empty. The module
 * reports themselves live with their modules: studentReports.ts,
 * attendanceReports.ts, feeReports.ts and examReports.ts.
 */
import type { QueryCtx } from "./_generated/server";
import { schoolQuery } from "./core/functions";
import { enabledList, moduleStateOf } from "./model/modules";
import type { ModuleKey } from "./core/modules";
import { hasPermission, requireAnyPermission } from "./core/authorization";
import { isSchoolDay, todayIn } from "./model/calendar";
import { audienceLabel } from "./notices";
import { maybeProvider } from "./core/registry";
import type { Actor } from "./core/actor";

type Ctx = QueryCtx & { actor: Actor };

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
    // Each panel comes from one module and is left out (null / empty) when the school does not have it:
    // students → Student Management, attendance/leave/tasks → Attendance, exams → Academics,
    // notices → Administration, fees → Finance. Sections and teachers are core.
    const moduleState = await moduleStateOf(ctx, school._id);
    const on = (k: ModuleKey) => moduleState.enabled.has(k);
    const base = { school: { name: school.name, shortName: school.shortName, code: school.code }, academicYear: year ? { academicYearId: year._id, name: year.name } : null, today, modules: enabledList(moduleState) };
    if (!year) return { ...base, overview: null, fees: null };

    let overview = null;
    if (schoolWide) {
      const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", year._id)).collect();
      const teachers = await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", school._id).eq("status", "active")).collect();
      const todaySchoolDay = await isSchoolDay(ctx, school, settings, today);
      const roster = on("students") ? maybeProvider("students.roster") : null;
      const attendance = on("attendance") ? maybeProvider("attendance.overview") : null;
      const examsP = on("academics") ? maybeProvider("examinations.overview") : null;
      const att = attendance ? await attendance.dashboard(ctx, { schoolId: school._id, yearId: year._id, today, lateCounts: settings.attendance.lateCountsAsPresent, isSchoolDay: todaySchoolDay, sectionCount: sections.length }) : null;
      const ex = examsP ? await examsP.dashboard(ctx, school._id, year._id, today) : null;
      const noticeRows = !on("administration") ? [] : (await ctx.db.query("notices").withIndex("by_school_status_publish", (q) => q.eq("schoolId", school._id).eq("status", "published").lte("publishDate", today)).order("desc").take(20))
        .filter((n) => !n.expiresOn || n.expiresOn >= today).slice(0, 4);
      const notices = [];
      for (const n of noticeRows) notices.push({ noticeId: n._id, title: n.title, body: n.body, type: n.type, priority: n.priority, publishDate: n.publishDate, eventDate: n.eventDate ?? null, audienceLabel: await audienceLabel(ctx as Ctx, n.audience) });
      overview = {
        students: roster ? await roster.enrolledCount(ctx, school._id, year._id) : null,
        sections: sections.length, teachers: teachers.length, teachersOnLeave: att ? att.teachersOnLeave : null,
        attendance: att ? att.attendance : null,
        attendanceTrend: att ? att.attendanceTrend : [],
        performance: ex ? ex.performance : { examName: null, rows: [] },
        upcomingExams: ex ? ex.upcomingExams : [],
        notices,
        tasks: { unmarkedToday: att ? att.unmarkedToday : null, pendingLeave: att ? att.pendingLeave : null, isSchoolDay: todaySchoolDay },
      };
    }

    const feesP = finance && on("finance") ? maybeProvider("fees.overview") : null;
    const fees = feesP ? await feesP.dashboard(ctx, school._id, year._id, today) : null;
    return { ...base, overview, fees };
  },
});
