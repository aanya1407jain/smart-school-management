/**
 * Role dashboards that aggregate several modules for ONE signed-in member.
 *
 * teacherOverview — the teacher's landing page (area:teacher). Everything is
 * derived from the caller's own teacher record and persisted assignments:
 *  - sections they own as class teacher (+ whether today's register is marked);
 *  - subject assignments;
 *  - today's lessons from the published timetable;
 *  - their open homework with submissions still to review;
 *  - marks still to enter for papers they are assigned to (exams open for entry).
 * Nothing from other teachers or other schools is returned.
 * Module panels come from the owning modules through providers
 * (core/registry.ts) and follow the school's entitlements (model/modules.ts):
 * the register status needs Attendance; lessons and homework need Academics;
 * marks need Examinations (shares the "academics" key). A module that is not
 * shipped, or disabled, leaves its panel empty (`registerMarked: null`).
 */
import type { Id } from "./_generated/dataModel";
import type { GenericId } from "convex/values";
import type { LessonView, HomeworkReviewView, MarksTaskView } from "./contracts/providers";
import { schoolQuery } from "./core/functions";
import { getCurrentAcademicYearId, getSchoolSettings, requirePermission } from "./core/authorization";
import { activeRoster } from "./model/academics";
import { todayIn } from "./model/calendar";
import { enabledList, moduleStateOf } from "./model/modules";
import { maybeProvider } from "./core/registry";


function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export const teacherOverview = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "area:teacher");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    const weekday = weekdayOf(today);
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    const isWorkingDay = settings.workingDays.includes(weekday);
    const teacherId = ctx.actor.teacherId;
    const moduleState = await moduleStateOf(ctx, ctx.actor.schoolId);
    const attendanceOn = moduleState.enabled.has("attendance");
    const academicsOn = moduleState.enabled.has("academics");
    const empty = {
      today, weekday, isWorkingDay, hasTeacherRecord: !!teacherId, modules: enabledList(moduleState),
      classTeacherOf: [] as { sectionId: Id<"sections">; displayName: string; students: number; registerMarked: boolean | null }[],
      assignments: [] as { sectionId: Id<"sections">; sectionName: string; subjectId: GenericId<"subjects"> /* Academics id (contract type) */; subjectName: string }[],
      todayLessons: [] as LessonView[],
      homeworkToReview: [] as HomeworkReviewView[],
      marksTasks: [] as MarksTaskView[],
      /** The teacher's active homework per section; null when Academics is not shipped or disabled. */
      activeHomework: null as { sectionId: Id<"sections">; count: number }[] | null,
    };
    if (!teacherId) return empty;
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId).catch(() => null);
    if (!yearId) return empty;

    // Sections owned as class teacher, with today's register state (from Attendance when shipped).
    const registers = attendanceOn ? maybeProvider("attendance.registers") : null;
    const owned = (await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacherId).eq("academicYearId", yearId)).collect())
      .filter((s) => s.schoolId === ctx.actor.schoolId);
    for (const s of owned) {
      const students = (await activeRoster(ctx, s._id)).length;
      empty.classTeacherOf.push({ sectionId: s._id, displayName: s.displayName, students, registerMarked: registers ? await registers.markedOn(ctx, s._id, today) : null });
    }

    // Subject assignments, lessons, homework (Academics) and marks tasks (Examinations), when shipped.
    const scope = maybeProvider("academics.teacherScope");
    if (scope) empty.assignments.push(...(await scope.assignmentsOf(ctx, ctx.actor.schoolId, teacherId, yearId)).map(({ sectionId, sectionName, subjectId, subjectName }) => ({ sectionId, sectionName, subjectId, subjectName })));
    empty.assignments.sort((x, y) => x.sectionName.localeCompare(y.sectionName, undefined, { numeric: true }) || x.subjectName.localeCompare(y.subjectName));
    if (!academicsOn) return empty;
    const day = maybeProvider("academics.teacherDay");
    if (day) {
      empty.activeHomework = await day.activeHomeworkBySection(ctx, ctx.actor.schoolId, teacherId);
      empty.todayLessons.push(...(await day.todayLessons(ctx, ctx.actor.schoolId, teacherId, yearId, weekday)));
      empty.homeworkToReview.push(...(await day.homeworkToReview(ctx, ctx.actor.schoolId, teacherId, yearId)));
    }
    const marks = maybeProvider("examinations.teacherMarks");
    if (marks) empty.marksTasks.push(...(await marks.marksTasks(ctx, ctx.actor.schoolId, teacherId, yearId)));
    return empty;
  },
});
