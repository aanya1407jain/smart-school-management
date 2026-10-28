/**
 * Academics read models and rules shared with other modules.
 *
 *  - Providers (contracts/providers.ts) for Core and Students: teacher scope
 *    from subject assignments, the subject catalogue, a section's timetable, a
 *    student's homework, and homework/submission file access.
 *  - Rules used by Academics and by modules that REQUIRE it (Examinations):
 *    curriculum membership and subject-teacher checks.
 *
 * Moved here from model/studentRecords.ts, model/academics.ts, files.ts and
 * core/authorization.ts so that Core and Students no longer read Academics
 * tables (subjects, classSubjects, teacherAssignments, periods, timetable, homework).
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { FileOwnerProvider, HomeworkReviewView, LessonView, ProviderContracts, StudentHomeworkProvider, StudentTimetableProvider, SubjectCatalogProvider, TeacherDayProvider, TeacherScopeProvider } from "../contracts/providers";
import type { Actor } from "../core/actor";
import { getInSchool, hasPermission, requireStudentAccess } from "../core/authorization";
import { conflict, forbidden, notFound } from "../core/errors";
import { teacherDisplayName } from "./academics";
import { canReadHomework } from "./homeworkAccess";

type Ctx = QueryCtx & { actor: Actor };

/** Bound for list reads (a school year has ≤ 366 days; this never truncates real data). */
const MAX_HOMEWORK = 300;

/** True when the subject is in the class curriculum for the year (classSubjects). */
export async function subjectInCurriculum(ctx: QueryCtx, classId: Id<"classes">, academicYearId: Id<"academicYears">, subjectId: Id<"subjects">): Promise<boolean> {
  const row = await ctx.db
    .query("classSubjects")
    .withIndex("by_class_year_subject", (q) => q.eq("classId", classId).eq("academicYearId", academicYearId).eq("subjectId", subjectId))
    .first();
  return !!row;
}

/** Does the teacher teach this subject in this section (a teacher assignment)? */
export async function isSubjectTeacherOf(ctx: QueryCtx, teacherId: Id<"teachers"> | undefined, sectionId: Id<"sections">, subjectId: Id<"subjects">): Promise<boolean> {
  if (!teacherId) return false;
  const rows = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", sectionId).eq("subjectId", subjectId)).collect();
  return rows.some((a) => a.teacherId === teacherId);
}

export async function requireSubjectTeacher(ctx: Ctx, sectionId: Id<"sections">, subjectId: Id<"subjects">, message = "You do not teach this subject in this section."): Promise<Doc<"sections">> {
  const section = await getInSchool(ctx, "sections", sectionId, "Section");
  if (!(await isSubjectTeacherOf(ctx, ctx.actor.teacherId, section._id, subjectId))) throw forbidden(message);
  return section;
}

/** Sections where the teacher has a subject assignment in the year. */
export async function teachingSectionIds(ctx: QueryCtx, teacherId: Id<"teachers">, academicYearId: Id<"academicYears">): Promise<Id<"sections">[]> {
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", academicYearId))
    .collect();
  return [...new Set(assignments.map((a) => a.sectionId))];
}

/** The weekly timetable of a section (its own academic year), with the bell schedule. */
export async function timetableFor(ctx: QueryCtx, section: Pick<Doc<"sections">, "_id" | "schoolId" | "academicYearId">) {
  const periods = (await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", section.schoolId)).collect())
    .map((p) => ({ periodId: p._id, index: p.index, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }));
  const entries = (await ctx.db.query("timetableEntries").withIndex("by_section_day_period", (q) => q.eq("sectionId", section._id)).collect())
    .filter((e) => e.schoolId === section.schoolId && e.academicYearId === section.academicYearId);
  const names = new Map<string, string>();
  const nameOf = async (id: Id<"subjects"> | Id<"teachers">, kind: "subject" | "teacher") => {
    if (!names.has(id)) {
      const doc = await ctx.db.get(id);
      names.set(id, !doc ? "" : kind === "subject" ? (doc as Doc<"subjects">).name : teacherDisplayName(doc as Doc<"teachers">));
    }
    return names.get(id)!;
  };
  const lessons = [];
  for (const e of entries) {
    lessons.push({ entryId: e._id, dayOfWeek: e.dayOfWeek, periodId: e.periodId, subjectId: e.subjectId, teacherId: e.teacherId, subject: await nameOf(e.subjectId, "subject"), teacher: await nameOf(e.teacherId, "teacher"), room: e.room ?? null });
  }
  return { periods, lessons };
}

/** Homework set for a section in a year, with this student's own submission (if any). */
export async function homeworkFor(ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">, section: Pick<Doc<"sections">, "_id" | "academicYearId">) {
  const rows = (await ctx.db.query("homework").withIndex("by_section_due", (q) => q.eq("sectionId", section._id)).order("desc").take(MAX_HOMEWORK))
    .filter((h) => h.schoolId === student.schoolId && h.academicYearId === section.academicYearId);
  const out = [];
  for (const h of rows) {
    const [subject, teacher] = [await ctx.db.get(h.subjectId), await ctx.db.get(h.teacherId)];
    const sub = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", h._id).eq("studentId", student._id)).first();
    out.push({
      homeworkId: h._id,
      title: h.title,
      description: h.description,
      subject: subject?.name ?? "Subject",
      teacher: teacher ? teacherDisplayName(teacher) : null,
      assignedOn: h.assignedOn,
      dueDate: h.dueDate,
      homeworkStatus: h.status,
      attachmentFileIds: h.attachmentFileIds,
      submission: sub && sub.schoolId === student.schoolId
        ? { submissionId: sub._id, status: sub.status, submittedAt: sub.submittedAt, content: sub.content ?? null, attachmentFileIds: sub.attachmentFileIds, feedback: sub.feedback ?? null }
        : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- providers
const teacherScope: TeacherScopeProvider = {
  teachingSectionIds: (ctx: QueryCtx, teacherId: Id<"teachers">, yearId: Id<"academicYears">) => teachingSectionIds(ctx, teacherId, yearId),
  async teachingLabels(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">, yearId: Id<"academicYears">) {
    const out: string[] = [];
    for (const a of await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", yearId)).collect()) {
      if (a.schoolId !== schoolId) continue;
      const [sec, sub] = [await ctx.db.get(a.sectionId), await ctx.db.get(a.subjectId)];
      out.push(`${sub?.name ?? "Subject"} · ${sec?.displayName ?? ""}`);
    }
    return out;
  },
  async assignmentsOf(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">, yearId: Id<"academicYears">) {
    const out = [];
    for (const a of await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", yearId)).collect()) {
      if (a.schoolId !== schoolId) continue;
      const [sec, sub] = [await ctx.db.get(a.sectionId), await ctx.db.get(a.subjectId)];
      out.push({ _id: a._id, sectionId: a.sectionId, sectionName: sec?.displayName ?? "", subjectId: a.subjectId, subjectName: sub?.name ?? "" });
    }
    return out;
  },
  async subjectLoad(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">, yearId: Id<"academicYears">) {
    return (await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", yearId)).collect()).filter((a) => a.schoolId === schoolId).length;
  },
};

const subjects: SubjectCatalogProvider = {
  async subjects(ctx: QueryCtx, schoolId: Id<"schools">) {
    return (await ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", schoolId)).collect()).map((s) => ({ id: s._id as string, code: s.code, name: s.name, active: s.active }));
  },
};

const studentTimetable: StudentTimetableProvider = {
  sectionWeek: (ctx: QueryCtx, section: Pick<Doc<"sections">, "_id" | "schoolId" | "academicYearId">) => timetableFor(ctx, section),
};

const studentHomework: StudentHomeworkProvider = {
  homeworkFor: (ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">, section: Pick<Doc<"sections">, "_id" | "academicYearId">) => homeworkFor(ctx, student, section),
};

/**
 * Homework and submission attachments.
 *  - read: homework → canReadHomework; submission → homework staff, the teacher who set it, or the submitting student.
 *  - write: homework → only the teacher who set it, while it is open; submission → only the submitting student, before review.
 */
const homeworkFiles: FileOwnerProvider = {
  ownerTypes: ["homework", "submission"],
  async loadOwner(ctx: Ctx, ownerType: string, ownerId: string) {
    const table = ownerType === "homework" ? "homework" : "homeworkSubmissions";
    const id = ctx.db.normalizeId(table, ownerId);
    if (!id) throw notFound("Owner");
    await getInSchool(ctx, table, id, "Owner");
  },
  async requireRead(ctx: Ctx, ownerType: string, ownerId: string) {
    if (ownerType === "homework") {
      const hw = await getInSchool(ctx, "homework", ownerId as Id<"homework">, "File");
      if (await canReadHomework(ctx, hw)) return;
      throw notFound("File");
    }
    const sub = await getInSchool(ctx, "homeworkSubmissions", ownerId as Id<"homeworkSubmissions">, "File");
    const hw = await getInSchool(ctx, "homework", sub.homeworkId, "File");
    if (hasPermission(ctx.actor, "homework:read:all") || (ctx.actor.teacherId && hw.teacherId === ctx.actor.teacherId)) return;
    await requireStudentAccess(ctx, sub.studentId, { own: "homework:read:own" });
  },
  /** Called from mutations only (files.register / files.remove). */
  async writableRecord(ctx: MutationCtx & { actor: Actor }, ownerType: string, ownerId: string) {
    const record = ownerType === "homework"
      ? await getInSchool(ctx, "homework", ownerId as Id<"homework">, "Owner")
      : await getInSchool(ctx, "homeworkSubmissions", ownerId as Id<"homeworkSubmissions">, "Owner");
    if (ownerType === "homework") {
      const hw = record as Doc<"homework">;
      if (!ctx.actor.teacherId || hw.teacherId !== ctx.actor.teacherId) throw forbidden("Only the teacher who set this homework can attach files to it.");
      if (hw.status !== "active") throw conflict("This homework is closed.");
    } else {
      const sub = record as Doc<"homeworkSubmissions">;
      if (!ctx.actor.studentId || sub.studentId !== ctx.actor.studentId) throw forbidden("Only the student who submitted this work can attach files to it.");
      if (sub.status === "reviewed") throw conflict("This submission has already been reviewed.");
    }
    const write = (ids: Id<"files">[]) => ctx.db.patch(record._id, { attachmentFileIds: ids });
    return {
      attachments: record.attachmentFileIds.length,
      attach: (fileId: Id<"files">) => write([...record.attachmentFileIds, fileId]),
      detach: (fileId: Id<"files">) => write(record.attachmentFileIds.filter((f) => f !== fileId)),
    };
  },
};

const MAX_REVIEW_ITEMS = 50;

/** Lessons and homework for the teacher dashboard (moved from dashboards.teacherOverview). */
const teacherDay: TeacherDayProvider = {
  async todayLessons(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">, yearId: Id<"academicYears">, weekday: number) {
    const periods = new Map((await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", schoolId)).collect()).map((p) => [p._id as string, p]));
    const lessons = (await ctx.db.query("timetableEntries").withIndex("by_teacher_day_period", (q) => q.eq("teacherId", teacherId).eq("dayOfWeek", weekday)).collect())
      .filter((e) => e.schoolId === schoolId && e.academicYearId === yearId);
    const out: LessonView[] = [];
    for (const e of lessons) {
      const p = periods.get(e.periodId);
      if (!p) continue;
      const [sec, sub] = [await ctx.db.get(e.sectionId), await ctx.db.get(e.subjectId)];
      out.push({ entryId: e._id, periodLabel: p.label, startTime: p.startTime, endTime: p.endTime, section: sec?.displayName ?? "", subject: sub?.name ?? "", room: e.room ?? null });
    }
    return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  },
  async homeworkToReview(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">, yearId: Id<"academicYears">) {
    const homework = (await ctx.db.query("homework").withIndex("by_teacher_due", (q) => q.eq("teacherId", teacherId)).order("desc").take(MAX_REVIEW_ITEMS))
      .filter((h) => h.schoolId === schoolId && h.academicYearId === yearId);
    const out: HomeworkReviewView[] = [];
    for (const h of homework) {
      const subs = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", h._id)).collect();
      const pending = subs.filter((s) => s.status !== "reviewed").length;
      if (pending === 0) continue;
      const [sec, sub] = [await ctx.db.get(h.sectionId), await ctx.db.get(h.subjectId)];
      out.push({ homeworkId: h._id, title: h.title, section: sec?.displayName ?? "", subject: sub?.name ?? "", dueDate: h.dueDate, pending });
    }
    return out;
  },
  async activeHomeworkBySection(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">) {
    const counts = new Map<Id<"sections">, number>();
    for (const h of await ctx.db.query("homework").withIndex("by_teacher_due", (q) => q.eq("teacherId", teacherId)).order("desc").take(MAX_HOMEWORK)) {
      if (h.schoolId === schoolId && h.status === "active") counts.set(h.sectionId, (counts.get(h.sectionId) ?? 0) + 1);
    }
    return [...counts].map(([sectionId, count]) => ({ sectionId, count }));
  },
};

export const academicsProviders = {
  "academics.teacherScope": teacherScope,
  "academics.teacherDay": teacherDay,
  "academics.subjects": subjects,
  "academics.studentTimetable": studentTimetable,
  "academics.studentHomework": studentHomework,
  "academics.homeworkFiles": homeworkFiles,
} satisfies Pick<ProviderContracts, "academics.teacherScope" | "academics.teacherDay" | "academics.subjects" | "academics.studentTimetable" | "academics.studentHomework" | "academics.homeworkFiles">;
