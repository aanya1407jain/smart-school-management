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
 */
import type { Doc, Id } from "./_generated/dataModel";
import { schoolQuery } from "./core/functions";
import { getCurrentAcademicYearId, getSchoolSettings, requirePermission } from "./core/authorization";
import { activeRoster } from "./model/academics";
import { todayIn } from "./model/calendar";

const MAX_ITEMS = 50;

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
    const empty = {
      today, weekday, isWorkingDay, hasTeacherRecord: !!teacherId,
      classTeacherOf: [] as { sectionId: Id<"sections">; displayName: string; students: number; registerMarked: boolean }[],
      assignments: [] as { sectionId: Id<"sections">; sectionName: string; subjectId: Id<"subjects">; subjectName: string }[],
      todayLessons: [] as { entryId: Id<"timetableEntries">; periodLabel: string; startTime: string; endTime: string; section: string; subject: string; room: string | null }[],
      homeworkToReview: [] as { homeworkId: Id<"homework">; title: string; section: string; subject: string; dueDate: string; pending: number }[],
      marksTasks: [] as { examId: Id<"exams">; examName: string; examSubjectId: Id<"examSubjects">; sectionId: Id<"sections">; label: string; entered: number; total: number }[],
    };
    if (!teacherId) return empty;
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId).catch(() => null);
    if (!yearId) return empty;

    // Sections owned as class teacher, with today's register state.
    const owned = (await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacherId).eq("academicYearId", yearId)).collect())
      .filter((s) => s.schoolId === ctx.actor.schoolId);
    for (const s of owned) {
      const students = (await activeRoster(ctx, s._id)).length;
      const session = await ctx.db.query("attendanceSessions").withIndex("by_section_date", (q) => q.eq("sectionId", s._id).eq("date", today)).first();
      empty.classTeacherOf.push({ sectionId: s._id, displayName: s.displayName, students, registerMarked: !!session });
    }

    // Subject assignments.
    const assignments = (await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", yearId)).collect())
      .filter((a) => a.schoolId === ctx.actor.schoolId);
    const sectionCache = new Map<string, Doc<"sections"> | null>();
    const sectionOf = async (id: Id<"sections">) => {
      if (!sectionCache.has(id)) sectionCache.set(id, await ctx.db.get(id));
      return sectionCache.get(id)!;
    };
    for (const a of assignments) {
      const [sec, sub] = [await sectionOf(a.sectionId), await ctx.db.get(a.subjectId)];
      empty.assignments.push({ sectionId: a.sectionId, sectionName: sec?.displayName ?? "", subjectId: a.subjectId, subjectName: sub?.name ?? "" });
    }
    empty.assignments.sort((x, y) => x.sectionName.localeCompare(y.sectionName, undefined, { numeric: true }) || x.subjectName.localeCompare(y.subjectName));

    // Today's lessons.
    const periods = new Map((await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect()).map((p) => [p._id as string, p]));
    const lessons = (await ctx.db.query("timetableEntries").withIndex("by_teacher_day_period", (q) => q.eq("teacherId", teacherId).eq("dayOfWeek", weekday)).collect())
      .filter((e) => e.schoolId === ctx.actor.schoolId && e.academicYearId === yearId);
    for (const e of lessons) {
      const p = periods.get(e.periodId);
      if (!p) continue;
      const [sec, sub] = [await sectionOf(e.sectionId), await ctx.db.get(e.subjectId)];
      empty.todayLessons.push({ entryId: e._id, periodLabel: p.label, startTime: p.startTime, endTime: p.endTime, section: sec?.displayName ?? "", subject: sub?.name ?? "", room: e.room ?? null });
    }
    empty.todayLessons.sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Open homework with work waiting for review.
    const homework = (await ctx.db.query("homework").withIndex("by_teacher_due", (q) => q.eq("teacherId", teacherId)).order("desc").take(MAX_ITEMS))
      .filter((h) => h.schoolId === ctx.actor.schoolId && h.academicYearId === yearId);
    for (const h of homework) {
      const subs = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", h._id)).collect();
      const pending = subs.filter((s) => s.status !== "reviewed").length;
      if (pending === 0) continue;
      const [sec, sub] = [await sectionOf(h.sectionId), await ctx.db.get(h.subjectId)];
      empty.homeworkToReview.push({ homeworkId: h._id, title: h.title, section: sec?.displayName ?? "", subject: sub?.name ?? "", dueDate: h.dueDate, pending });
    }

    // Marks to enter: papers of exams open for entry that match a persisted assignment.
    const exams = (await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect())
      .filter((e) => e.status === "in_progress" || e.status === "marks_entry");
    for (const exam of exams) {
      for (const a of assignments) {
        const sec = await sectionOf(a.sectionId);
        if (!sec || !exam.classIds.includes(sec.classId)) continue;
        const paper = (await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", exam._id).eq("classId", sec.classId)).collect())
          .find((p) => p.subjectId === a.subjectId);
        if (!paper) continue;
        const total = (await activeRoster(ctx, sec._id)).length;
        const entered = (await ctx.db.query("marks").withIndex("by_paper_section", (q) => q.eq("examSubjectId", paper._id).eq("sectionId", sec._id)).collect()).length;
        if (entered >= total) continue;
        const sub = await ctx.db.get(a.subjectId);
        empty.marksTasks.push({ examId: exam._id, examName: exam.name, examSubjectId: paper._id, sectionId: sec._id, label: `${sub?.name ?? "Paper"} · Class ${sec.displayName}`, entered, total });
      }
    }
    return empty;
  },
});
