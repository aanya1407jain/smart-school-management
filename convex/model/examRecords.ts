/**
 * Examinations read models used by other modules through providers
 * (contracts/providers.ts): a student's published results, the latest
 * result's standing for promotions and pass-out, the "results exist in a year"
 * guard, and report-card file access. Moved here from model/studentRecords.ts
 * and model/lifecycle.ts so that no other module reads examination tables.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { FileOwnerProvider, LatestResult, MarksTaskView, ProviderContracts, Standing, StudentResultsProvider, StudentStandingProvider, TeacherMarksProvider } from "../contracts/providers";
import type { Actor } from "../core/actor";
import { getInSchool, requireStudentAccess } from "../core/authorization";
import { notFound } from "../core/errors";
import { activeRoster } from "./academics";
import type { ExamOverviewProvider } from "../contracts/providers";
import { addDays } from "./calendar";

/**
 * Standing from the latest published result of the year (a suggestion for the
 * office — promotion itself is the administrator's decision):
 *  eligible = every subject passed · compartment = one or two not passed ·
 *  detained = three or more not passed.
 */
export function standingFrom(failedSubjects: number): Standing {
  return failedSubjects === 0 ? "eligible" : failedSubjects <= 2 ? "compartment" : "detained";
}

/** Latest published result per student, limited to exams of `academicYearId`. */
export async function latestResults(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">, studentIds: Id<"students">[]) {
  const exams = await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId)).collect();
  const examById = new Map(exams.map((e) => [e._id, e]));
  const out = new Map<string, LatestResult>();
  for (const studentId of studentIds) {
    const rows = await ctx.db.query("results").withIndex("by_student_exam", (q) => q.eq("studentId", studentId)).collect();
    const mine = rows.filter((r) => r.schoolId === schoolId && examById.has(r.examId)).sort((a, b) => b.publishedAt - a.publishedAt);
    const r = mine[0];
    if (!r) continue;
    const failed = r.subjects.filter((s) => !s.passed).length;
    out.set(studentId, { examName: examById.get(r.examId)!.name, percentage: r.percentage, grade: r.grade ?? null, failedSubjects: failed, standing: standingFrom(failed) });
  }
  return out;
}

/** Published exam results (snapshots written at publication). */
export async function publishedResults(ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">) {
  const rows = (await ctx.db.query("results").withIndex("by_student_exam", (q) => q.eq("studentId", student._id)).collect())
    .filter((r) => r.schoolId === student.schoolId);
  const out = [];
  for (const r of rows) {
    const exam = await ctx.db.get(r.examId);
    if (!exam || exam.schoolId !== student.schoolId || exam.status !== "published") continue;
    const sectionSize = (await ctx.db.query("results").withIndex("by_exam_section", (q) => q.eq("examId", r.examId).eq("sectionId", r.sectionId)).collect()).length;
    const subjects = [];
    for (const s of r.subjects) {
      const subject = await ctx.db.get(s.subjectId);
      subjects.push({
        subjectId: s.subjectId,
        subject: subject?.name ?? "Subject",
        marks: s.isAbsent ? null : (s.marks ?? null),
        isAbsent: s.isAbsent,
        maxMarks: s.maxMarks,
        grade: s.grade ?? null,
        passed: s.passed,
      });
    }
    out.push({
      examId: exam._id,
      examName: exam.name,
      term: exam.term ?? null,
      startDate: exam.startDate,
      totalMarks: r.totalMarks,
      maxMarks: r.maxMarks,
      percentage: r.percentage,
      grade: r.grade ?? null,
      rank: r.rank ?? null,
      sectionSize,
      sectionLabel: (await ctx.db.get(r.sectionId))?.displayName ?? null,
      subjects,
    });
  }
  return out.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

const standing: StudentStandingProvider = {
  latestResults: (ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, studentIds: Id<"students">[]) => latestResults(ctx, schoolId, yearId, studentIds),
  async hasResultsInYear(ctx: QueryCtx, studentId: Id<"students">, yearId: Id<"academicYears">) {
    for (const r of await ctx.db.query("results").withIndex("by_student_exam", (q) => q.eq("studentId", studentId)).collect()) {
      const exam = await ctx.db.get(r.examId);
      if (exam?.academicYearId === yearId) return true;
    }
    return false;
  },
};

const results: StudentResultsProvider = {
  publishedResults: (ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">) => publishedResults(ctx, student),
};

type FileCtx = QueryCtx & { actor: Actor };

/** Report cards attached to a result: exam staff, teachers of the student, or the student. */
const resultFiles: FileOwnerProvider = {
  ownerTypes: ["result"],
  async loadOwner(ctx: FileCtx, _ownerType: string, ownerId: string) {
    const id = ctx.db.normalizeId("results", ownerId);
    if (!id) throw notFound("Owner");
    await getInSchool(ctx, "results", id, "Owner");
  },
  async requireRead(ctx: FileCtx, _ownerType: string, ownerId: string) {
    const result = await getInSchool(ctx, "results", ownerId as Id<"results">, "File");
    await requireStudentAccess(ctx, result.studentId, { all: "exams:manage", assigned: "exams:read:assigned", own: "results:read:own" });
  },
  async writableRecord() {
    return null; // results do not list attachments
  },
};

/** Marks still to enter for papers the teacher is assigned to (moved from dashboards.teacherOverview). */
const teacherMarks: TeacherMarksProvider = {
  async marksTasks(ctx: QueryCtx, schoolId: Id<"schools">, teacherId: Id<"teachers">, yearId: Id<"academicYears">) {
    // Subject assignments belong to Academics, which Examinations requires.
    const assignments = (await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", yearId)).collect())
      .filter((a) => a.schoolId === schoolId);
    const exams = (await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).collect())
      .filter((e) => e.status === "in_progress" || e.status === "marks_entry");
    const out: MarksTaskView[] = [];
    for (const exam of exams) {
      for (const a of assignments) {
        const sec = await ctx.db.get(a.sectionId);
        if (!sec || !exam.classIds.includes(sec.classId)) continue;
        const paper = (await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", exam._id).eq("classId", sec.classId)).collect())
          .find((p) => p.subjectId === a.subjectId);
        if (!paper) continue;
        const total = (await activeRoster(ctx, sec._id)).length;
        const entered = (await ctx.db.query("marks").withIndex("by_paper_section", (q) => q.eq("examSubjectId", paper._id).eq("sectionId", sec._id)).collect()).length;
        if (entered >= total) continue;
        const sub = await ctx.db.get(a.subjectId);
        out.push({ examId: exam._id, examName: exam.name, examSubjectId: paper._id, sectionId: sec._id, label: `${sub?.name ?? "Paper"} · Class ${sec.displayName}`, entered, total });
      }
    }
    return out;
  },
};

export const examinationsProviders = {
  "examinations.teacherMarks": teacherMarks,
  "examinations.studentStanding": standing,
  "examinations.studentResults": results,
  "examinations.resultFiles": resultFiles,
} satisfies Pick<ProviderContracts, "examinations.teacherMarks" | "examinations.studentStanding" | "examinations.studentResults" | "examinations.resultFiles">;

/** The admin dashboard's examination panels (moved from reports.adminDashboard). */
const overview: ExamOverviewProvider = {
  async dashboard(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, today: string) {
    const exams = await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).collect();
    // Latest published exam: class averages from the published result snapshots.
    const published = exams.filter((e) => e.status === "published").sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
    const rows: { name: string; average: number }[] = [];
    if (published) {
      for (const classId of published.classIds) {
        const c = await ctx.db.get(classId);
        const secs = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", classId).eq("academicYearId", yearId)).collect();
        const pct: number[] = [];
        for (const s of secs) for (const r of await ctx.db.query("results").withIndex("by_exam_section", (q) => q.eq("examId", published._id).eq("sectionId", s._id)).collect()) pct.push(r.percentage);
        if (pct.length) rows.push({ name: c?.name ?? "", average: Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10 });
      }
    }
    const upcomingExams = [];
    for (const e of exams.filter((x) => x.status !== "published" && x.endDate >= addDays(today, -30)).sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      let papers = 0;
      for (const classId of e.classIds) papers += (await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", e._id).eq("classId", classId)).collect()).length;
      upcomingExams.push({ examId: e._id, name: e.name, status: e.status, startDate: e.startDate, endDate: e.endDate, classCount: e.classIds.length, paperCount: papers });
    }
    return { performance: { examName: published?.name ?? null, rows }, upcomingExams };
  },
};
export const examinationsOverviewProviders = { "examinations.overview": overview } satisfies Pick<ProviderContracts, "examinations.overview">;
