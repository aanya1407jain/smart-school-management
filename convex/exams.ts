/**
 * Examinations, marks and results (A-03).
 *
 * Lifecycle (validators.ts EXAM_STATUSES): draft → scheduled → in_progress →
 * marks_entry → published. Status only moves forward; `published` is reached
 * only through `publish`, which writes immutable `results` snapshots.
 *
 * Who may do what (server-side):
 *  - exams:manage (admin): create/edit exams and papers, move status, view all marks.
 *  - marks entry: `marks:enter:any` (admin) OR `marks:enter:assigned` + a
 *    PERSISTED subject assignment for (section, paper subject). A class teacher
 *    or a teacher of another subject cannot enter marks. Only while the exam is
 *    `in_progress` or `marks_entry`.
 *  - exams:publish (admin): publish when every active student of every
 *    section × paper has a mark row (a number or "absent").
 *  - Students read their own published results only (studentPortal.myResults).
 *
 * Calculation rules (documented decisions; the requirements name grades,
 * percentages and report cards but no tie or absence policy):
 *  - marks are 0 … maxMarks in steps of 0.5; "absent" stores no marks.
 *  - an ABSENT paper counts 0 towards the total and is not passed;
 *  - percentage = total ÷ maximum × 100, rounded to 2 decimals;
 *  - a paper is passed when marks ≥ its passMarks;
 *  - grade = the school's grading scheme (model/grading.ts) on the percentage;
 *  - `passed` (overall) = every paper passed;
 *  - rank is per SECTION by percentage, "standard competition" ranking:
 *    equal percentages share a rank and the next rank is skipped (1, 1, 3).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import type { Actor } from "./core/actor";
import {
  getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, isSubjectTeacherOf, requireAnyPermission, requirePermission, teacherSectionIds,
} from "./core/authorization";
import { conflict, forbidden, invalid, invalidRelationship, notFound } from "./core/errors";
import { assertIsoDate, assertNonEmpty, assertTime, EXAM_STATUSES, type ExamStatusValue } from "./core/validators";
import { activeRoster, fullName, subjectInCurriculum } from "./model/academics";
import { gradeFor } from "./model/grading";
import { writeAudit } from "./model/audit";
import { notifyUsers, userIdsForStudent } from "./model/notifications";

type Ctx = QueryCtx & { actor: Actor };
const ENTRY_STATUSES: ExamStatusValue[] = ["in_progress", "marks_entry"];
const statusRank = (s: ExamStatusValue) => EXAM_STATUSES.indexOf(s);

async function sectionsOfExam(ctx: QueryCtx, exam: Doc<"exams">) {
  const out: Doc<"sections">[] = [];
  for (const classId of exam.classIds) {
    const rows = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", classId).eq("academicYearId", exam.academicYearId)).collect();
    out.push(...rows.filter((s) => s.schoolId === exam.schoolId));
  }
  return out;
}

async function papersOf(ctx: QueryCtx, exam: Doc<"exams">) {
  const out: Doc<"examSubjects">[] = [];
  for (const classId of exam.classIds) {
    out.push(...(await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", exam._id).eq("classId", classId)).collect()));
  }
  return out;
}

function assertMarks(value: number, max: number) {
  if (!Number.isFinite(value) || value < 0 || value > max || Math.round(value * 2) !== value * 2) {
    throw invalid(`Marks must be between 0 and ${max}, in steps of 0.5.`, { marks: "Invalid marks" });
  }
}

/** Who may enter marks for a paper in a section. */
async function canEnterMarks(ctx: Ctx, paper: Doc<"examSubjects">, section: Doc<"sections">) {
  if (hasPermission(ctx.actor, "marks:enter:any")) return true;
  return hasPermission(ctx.actor, "marks:enter:assigned") && (await isSubjectTeacherOf(ctx, ctx.actor.teacherId, section._id, paper.subjectId));
}

function examView(e: Doc<"exams">) {
  return { examId: e._id, name: e.name, term: e.term ?? null, classIds: e.classIds, startDate: e.startDate, endDate: e.endDate, status: e.status, publishedAt: e.publishedAt ?? null, academicYearId: e.academicYearId };
}

// ================================================================ exams
/** Admin: all exams of the year. Teachers: exams of classes they teach in. */
export const list = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    requireAnyPermission(ctx.actor, ["exams:manage", "exams:read:assigned"]);
    const yearId = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    let exams = await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    if (!hasPermission(ctx.actor, "exams:manage")) {
      const scope = ctx.actor.teacherId ? await teacherSectionIds(ctx, ctx.actor.teacherId, yearId) : new Set<Id<"sections">>();
      const classIds = new Set<Id<"classes">>();
      for (const id of scope) {
        const s = await ctx.db.get(id);
        if (s) classIds.add(s.classId);
      }
      exams = exams.filter((e) => e.classIds.some((c) => classIds.has(c)));
    }
    return exams.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(examView);
  },
});

export const get = schoolQuery({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    requireAnyPermission(ctx.actor, ["exams:manage", "exams:read:assigned"]);
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    const papers = [];
    for (const p of await papersOf(ctx, exam)) {
      const subject = await ctx.db.get(p.subjectId);
      papers.push({ examSubjectId: p._id, classId: p.classId, subjectId: p.subjectId, subject: subject?.name ?? "", date: p.date, startTime: p.startTime, endTime: p.endTime, maxMarks: p.maxMarks, passMarks: p.passMarks });
    }
    return { ...examView(exam), papers: papers.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)) };
  },
});

async function validateClasses(ctx: Ctx, classIds: Id<"classes">[]) {
  if (classIds.length === 0) throw invalid("Choose at least one class.", { classIds: "Required" });
  if (new Set(classIds).size !== classIds.length) throw invalid("A class is listed twice.", { classIds: "Duplicate" });
  for (const id of classIds) await getInSchool(ctx, "classes", id, "Class");
}

async function validateDates(ctx: Ctx, yearId: Id<"academicYears">, startDate: string, endDate: string) {
  assertIsoDate(startDate, "startDate");
  assertIsoDate(endDate, "endDate");
  if (startDate > endDate) throw invalid("The exam must end on or after its start date.", { endDate: "Before start" });
  const year = await getInSchool(ctx, "academicYears", yearId, "Academic year");
  if (startDate < year.startDate || endDate > year.endDate) throw invalid(`Exam dates must fall within ${year.name}.`, { startDate: "Outside the year" });
}

export const create = schoolMutation({
  args: { academicYearId: v.optional(v.id("academicYears")), name: v.string(), term: v.optional(v.string()), classIds: v.array(v.id("classes")), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "exams:manage");
    const yearId = a.academicYearId ? (await getInSchool(ctx, "academicYears", a.academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    await validateClasses(ctx, a.classIds);
    await validateDates(ctx, yearId, a.startDate, a.endDate);
    const name = assertNonEmpty(a.name, "name", 120);
    const dup = (await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect())
      .find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) throw conflict(`An exam named "${name}" already exists this year.`);
    const examId = await ctx.db.insert("exams", {
      schoolId: ctx.actor.schoolId, academicYearId: yearId, name, ...(a.term?.trim() ? { term: assertNonEmpty(a.term, "term", 60) } : {}),
      classIds: a.classIds, startDate: a.startDate, endDate: a.endDate, status: "draft",
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.created", entity: { table: "exams", id: examId }, summary: `Created exam "${name}"` });
    return { examId };
  },
});

export const update = schoolMutation({
  args: { examId: v.id("exams"), name: v.optional(v.string()), term: v.optional(v.string()), classIds: v.optional(v.array(v.id("classes"))), startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "exams:manage");
    const exam = await getInSchool(ctx, "exams", a.examId, "Exam");
    if (exam.status === "published") throw conflict("A published exam cannot be changed.");
    const patch: Partial<Doc<"exams">> = {};
    if (a.name !== undefined) patch.name = assertNonEmpty(a.name, "name", 120);
    if (a.term !== undefined) patch.term = a.term.trim() ? assertNonEmpty(a.term, "term", 60) : undefined;
    if (a.classIds !== undefined) {
      await validateClasses(ctx, a.classIds);
      const removed = exam.classIds.filter((c) => !a.classIds!.includes(c));
      for (const classId of removed) {
        const papers = await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", exam._id).eq("classId", classId)).first();
        if (papers) throw conflict("Remove that class's papers before removing the class from the exam.");
      }
      patch.classIds = a.classIds;
    }
    const start = a.startDate ?? exam.startDate;
    const end = a.endDate ?? exam.endDate;
    if (a.startDate !== undefined || a.endDate !== undefined) {
      await validateDates(ctx, exam.academicYearId, start, end);
      for (const p of await papersOf(ctx, exam)) {
        if (p.date < start || p.date > end) throw conflict(`A paper is scheduled on ${p.date}, outside the new dates.`);
      }
      patch.startDate = start;
      patch.endDate = end;
    }
    await ctx.db.patch(exam._id, patch);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.updated", entity: { table: "exams", id: exam._id }, summary: `Updated exam "${patch.name ?? exam.name}"`, metadata: { fields: Object.keys(patch) } });
    return { ok: true };
  },
});

/** Move the exam forward (never back, never to `published` — use publish). */
export const setStatus = schoolMutation({
  args: { examId: v.id("exams"), status: v.union(v.literal("scheduled"), v.literal("in_progress"), v.literal("marks_entry")) },
  handler: async (ctx, { examId, status }) => {
    requirePermission(ctx.actor, "exams:manage");
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    if (exam.status === status) return { ok: true };
    if (statusRank(status) < statusRank(exam.status)) throw conflict(`An exam cannot go back from ${exam.status} to ${status}.`);
    if (status !== "scheduled" && (await papersOf(ctx, exam)).length === 0) throw conflict("Add at least one paper before starting the exam.");
    await ctx.db.patch(exam._id, { status });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.status_changed", entity: { table: "exams", id: exam._id }, summary: `${exam.name}: ${exam.status} → ${status}` });
    return { ok: true };
  },
});

// ================================================================ papers
/** Add or edit the paper for (class, subject) in an exam. */
export const upsertPaper = schoolMutation({
  args: {
    examId: v.id("exams"), classId: v.id("classes"), subjectId: v.id("subjects"),
    date: v.string(), startTime: v.string(), endTime: v.string(), maxMarks: v.number(), passMarks: v.number(),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "exams:manage");
    const exam = await getInSchool(ctx, "exams", a.examId, "Exam");
    if (exam.status === "published") throw conflict("A published exam cannot be changed.");
    if (!exam.classIds.includes(a.classId)) throw invalidRelationship("That class is not part of this exam.");
    const subject = await getInSchool(ctx, "subjects", a.subjectId, "Subject");
    if (!(await subjectInCurriculum(ctx, a.classId, exam.academicYearId, subject._id))) throw invalidRelationship(`${subject.name} is not in this class's curriculum.`);
    assertIsoDate(a.date);
    if (a.date < exam.startDate || a.date > exam.endDate) throw invalid("The paper date must fall within the exam dates.", { date: "Outside exam" });
    assertTime(a.startTime, "startTime");
    assertTime(a.endTime, "endTime");
    if (a.startTime >= a.endTime) throw invalid("The paper must end after it starts.", { endTime: "Before start" });
    if (!Number.isInteger(a.maxMarks) || a.maxMarks < 1 || a.maxMarks > 1000) throw invalid("Maximum marks must be a whole number from 1 to 1000.", { maxMarks: "Invalid" });
    if (!Number.isFinite(a.passMarks) || a.passMarks < 0 || a.passMarks > a.maxMarks) throw invalid("Pass marks must be between 0 and the maximum.", { passMarks: "Invalid" });
    const existing = (await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", exam._id).eq("classId", a.classId)).collect())
      .find((p) => p.subjectId === subject._id);
    const doc = { date: a.date, startTime: a.startTime, endTime: a.endTime, maxMarks: a.maxMarks, passMarks: a.passMarks };
    if (existing) {
      if (a.maxMarks < existing.maxMarks) {
        const marks = await ctx.db.query("marks").withIndex("by_paper_section", (q) => q.eq("examSubjectId", existing._id)).collect();
        if (marks.some((m) => (m.marks ?? 0) > a.maxMarks)) throw conflict("Some entered marks exceed the new maximum.");
      }
      await ctx.db.patch(existing._id, doc);
      await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.paper_updated", entity: { table: "examSubjects", id: existing._id }, summary: `${exam.name}: updated ${subject.name} paper` });
      return { examSubjectId: existing._id };
    }
    const examSubjectId = await ctx.db.insert("examSubjects", { schoolId: ctx.actor.schoolId, examId: exam._id, classId: a.classId, subjectId: subject._id, ...doc });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.paper_created", entity: { table: "examSubjects", id: examSubjectId }, summary: `${exam.name}: added ${subject.name} paper` });
    return { examSubjectId };
  },
});

export const removePaper = schoolMutation({
  args: { examSubjectId: v.id("examSubjects") },
  handler: async (ctx, { examSubjectId }) => {
    requirePermission(ctx.actor, "exams:manage");
    const paper = await getInSchool(ctx, "examSubjects", examSubjectId, "Paper");
    const exam = await getInSchool(ctx, "exams", paper.examId, "Exam");
    if (exam.status === "published") throw conflict("A published exam cannot be changed.");
    if (await ctx.db.query("marks").withIndex("by_paper_section", (q) => q.eq("examSubjectId", paper._id)).first()) throw conflict("Marks have been entered for this paper.");
    await ctx.db.delete(paper._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.paper_removed", entity: { table: "examSubjects", id: paper._id }, summary: `${exam.name}: removed a paper` });
    return { ok: true };
  },
});

// ================================================================ marks
/** The marks sheet for one paper in one section (marks enterers and exam managers). */
export const marksSheet = schoolQuery({
  args: { examSubjectId: v.id("examSubjects"), sectionId: v.id("sections") },
  handler: async (ctx, { examSubjectId, sectionId }) => {
    const paper = await getInSchool(ctx, "examSubjects", examSubjectId, "Paper");
    const exam = await getInSchool(ctx, "exams", paper.examId, "Exam");
    const section = await getInSchool(ctx, "sections", sectionId, "Section");
    if (section.classId !== paper.classId || section.academicYearId !== exam.academicYearId) throw invalidRelationship("That section does not sit this paper.");
    const canEnter = await canEnterMarks(ctx, paper, section);
    if (!canEnter && !hasPermission(ctx.actor, "exams:manage")) throw forbidden("You do not teach this subject in this section.");
    const roster = await activeRoster(ctx, section._id);
    const rows = await ctx.db.query("marks").withIndex("by_paper_section", (q) => q.eq("examSubjectId", paper._id).eq("sectionId", section._id)).collect();
    const byStudent = new Map(rows.map((m) => [m.studentId, m]));
    const subject = await ctx.db.get(paper.subjectId);
    return {
      exam: examView(exam), paper: { examSubjectId: paper._id, subject: subject?.name ?? "", maxMarks: paper.maxMarks, passMarks: paper.passMarks },
      section: { sectionId: section._id, displayName: section.displayName },
      canEnter: canEnter && ENTRY_STATUSES.includes(exam.status),
      students: roster.map(({ student, enrollment }) => {
        const m = byStudent.get(student._id);
        return { studentId: student._id, name: fullName(student), rollNo: enrollment.rollNo ?? null, marks: m?.marks ?? null, isAbsent: m?.isAbsent ?? false, entered: !!m };
      }),
    };
  },
});

/** Enter/correct marks for students of one section (upsert per student). */
export const enterMarks = schoolMutation({
  args: {
    examSubjectId: v.id("examSubjects"), sectionId: v.id("sections"),
    entries: v.array(v.object({ studentId: v.id("students"), marks: v.optional(v.number()), isAbsent: v.boolean() })),
  },
  handler: async (ctx, { examSubjectId, sectionId, entries }) => {
    const paper = await getInSchool(ctx, "examSubjects", examSubjectId, "Paper");
    const exam = await getInSchool(ctx, "exams", paper.examId, "Exam");
    const section = await getInSchool(ctx, "sections", sectionId, "Section");
    if (section.classId !== paper.classId || section.academicYearId !== exam.academicYearId) throw invalidRelationship("That section does not sit this paper.");
    if (!(await canEnterMarks(ctx, paper, section))) throw forbidden("Only the teacher of this subject in this section can enter its marks.");
    if (!ENTRY_STATUSES.includes(exam.status)) throw conflict(exam.status === "published" ? "Results are published; marks are locked." : "Marks entry is not open for this exam yet.");
    if (entries.length === 0) throw invalid("No marks to save.");
    if (entries.length > 1000) throw invalid("Too many rows in one request.");
    if (new Set(entries.map((e) => e.studentId)).size !== entries.length) throw invalid("A student is listed twice.");
    const roster = new Set((await activeRoster(ctx, section._id)).map((r) => r.student._id));
    for (const e of entries) {
      if (!roster.has(e.studentId)) throw invalidRelationship("A student is not in this section.");
      if (e.isAbsent && e.marks !== undefined) throw invalid("An absent student cannot have marks.", { marks: "Absent" });
      if (!e.isAbsent) {
        if (e.marks === undefined) throw invalid("Enter marks or mark the student absent.", { marks: "Required" });
        assertMarks(e.marks, paper.maxMarks);
      }
    }
    let changed = 0;
    const now = Date.now();
    for (const e of entries) {
      const existing = await ctx.db.query("marks").withIndex("by_paper_student", (q) => q.eq("examSubjectId", paper._id).eq("studentId", e.studentId)).first();
      const marks = e.isAbsent ? undefined : e.marks;
      if (existing) {
        if (existing.isAbsent === e.isAbsent && existing.marks === marks) continue;
        await ctx.db.patch(existing._id, { marks, isAbsent: e.isAbsent, enteredByUserId: ctx.actor.userId, updatedAt: now });
      } else {
        await ctx.db.insert("marks", { schoolId: ctx.actor.schoolId, examId: exam._id, examSubjectId: paper._id, studentId: e.studentId, sectionId: section._id, ...(marks !== undefined ? { marks } : {}), isAbsent: e.isAbsent, enteredByUserId: ctx.actor.userId, updatedAt: now });
      }
      changed++;
    }
    if (changed > 0) {
      await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "marks.entered", entity: { table: "examSubjects", id: paper._id }, summary: `${exam.name}: saved ${changed} mark(s) for ${section.displayName}`, metadata: { sectionId: section._id, changed } });
    }
    return { changed };
  },
});

// ================================================================ results
type ResultRow = { studentId: Id<"students">; total: number; max: number; percentage: number; passed: boolean; subjects: Doc<"results">["subjects"] };

/** Pure: standard competition ranking by percentage (exported for tests). */
export function rankByPercentage<T extends { percentage: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.percentage - a.percentage);
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || sorted[i - 1].percentage !== r.percentage) rank = i + 1;
    return { ...r, rank };
  });
}

/** Publish: requires complete marks; writes results snapshots, locks the exam and notifies students once. */
export const publish = schoolMutation({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    requirePermission(ctx.actor, "exams:publish");
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    if (exam.status === "published") throw conflict("Results are already published.");
    if (!ENTRY_STATUSES.includes(exam.status)) throw conflict("Move the exam to marks entry before publishing.");
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    const papers = await papersOf(ctx, exam);
    if (papers.length === 0) throw conflict("This exam has no papers.");
    const sections = await sectionsOfExam(ctx, exam);
    const missing: string[] = [];
    const perSection: { section: Doc<"sections">; rows: ResultRow[] }[] = [];
    for (const section of sections) {
      const sectionPapers = papers.filter((p) => p.classId === section.classId);
      if (sectionPapers.length === 0) continue;
      const roster = await activeRoster(ctx, section._id);
      const rows: ResultRow[] = [];
      for (const { student } of roster) {
        let total = 0;
        let max = 0;
        const subjects: ResultRow["subjects"] = [];
        for (const p of sectionPapers) {
          const m = await ctx.db.query("marks").withIndex("by_paper_student", (q) => q.eq("examSubjectId", p._id).eq("studentId", student._id)).first();
          if (!m) {
            const subject = await ctx.db.get(p.subjectId);
            missing.push(`${section.displayName} · ${subject?.name ?? "paper"} · ${fullName(student)}`);
            continue;
          }
          const got = m.isAbsent ? 0 : (m.marks ?? 0);
          total += got;
          max += p.maxMarks;
          subjects.push({
            examSubjectId: p._id, subjectId: p.subjectId, ...(m.isAbsent ? {} : { marks: got }), isAbsent: m.isAbsent, maxMarks: p.maxMarks,
            grade: m.isAbsent ? undefined : gradeFor(settings.grading.scheme, (got / p.maxMarks) * 100), passed: !m.isAbsent && got >= p.passMarks,
          });
        }
        const percentage = max ? Math.round((total / max) * 10000) / 100 : 0;
        rows.push({ studentId: student._id, total, max, percentage, passed: subjects.every((s) => s.passed), subjects });
      }
      perSection.push({ section, rows });
    }
    if (missing.length) {
      throw conflict(`Marks are missing for ${missing.length} student-paper(s), e.g. ${missing.slice(0, 3).join("; ")}.`);
    }
    const publishedAt = Date.now();
    let written = 0;
    for (const { section, rows } of perSection) {
      for (const r of rankByPercentage(rows)) {
        const existing = await ctx.db.query("results").withIndex("by_student_exam", (q) => q.eq("studentId", r.studentId).eq("examId", exam._id)).first();
        const doc = {
          schoolId: ctx.actor.schoolId, examId: exam._id, studentId: r.studentId, sectionId: section._id, totalMarks: r.total, maxMarks: r.max,
          percentage: r.percentage, grade: gradeFor(settings.grading.scheme, r.percentage), rank: r.rank, subjects: r.subjects, publishedAt,
        };
        if (existing) await ctx.db.replace(existing._id, doc);
        else await ctx.db.insert("results", doc);
        written++;
        if (settings.notifications.examAlerts) {
          await notifyUsers(ctx, ctx.actor.schoolId, await userIdsForStudent(ctx, ctx.actor.schoolId, r.studentId), {
            type: "examination", title: "Results published", message: `${exam.name} results are available.`, href: "/student/results",
            entity: { table: "exams", id: exam._id }, dedupeKey: `exam.published:${exam._id}`,
          });
        }
      }
    }
    await ctx.db.patch(exam._id, { status: "published", publishedAt, publishedByUserId: ctx.actor.userId });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "exam.published", entity: { table: "exams", id: exam._id }, summary: `Published ${exam.name} (${written} results)`, metadata: { results: written } });
    return { results: written };
  },
});

/** Section results of a PUBLISHED exam (exam managers; teachers for sections in their scope). */
export const sectionResults = schoolQuery({
  args: { examId: v.id("exams"), sectionId: v.id("sections") },
  handler: async (ctx, { examId, sectionId }) => {
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    const section = await getInSchool(ctx, "sections", sectionId, "Section");
    if (!hasPermission(ctx.actor, "exams:manage")) {
      if (!hasPermission(ctx.actor, "exams:read:assigned") || !ctx.actor.teacherId) throw forbidden();
      const scope = await teacherSectionIds(ctx, ctx.actor.teacherId, exam.academicYearId);
      if (!scope.has(section._id)) throw forbidden();
    }
    if (exam.status !== "published") throw notFound("Published results");
    const rows = await ctx.db.query("results").withIndex("by_exam_section", (q) => q.eq("examId", exam._id).eq("sectionId", section._id)).collect();
    const out = [];
    const subjectNames = new Map<string, string>();
    for (const r of rows) {
      const s = await ctx.db.get(r.studentId);
      const subjects = [];
      for (const x of r.subjects) {
        if (!subjectNames.has(x.subjectId)) subjectNames.set(x.subjectId, (await ctx.db.get(x.subjectId))?.name ?? "Subject");
        subjects.push({ ...x, subject: subjectNames.get(x.subjectId)!, marks: x.isAbsent ? null : (x.marks ?? null), grade: x.grade ?? null });
      }
      out.push({ studentId: r.studentId, name: s ? fullName(s) : "", admissionNo: s?.admissionNo ?? "", totalMarks: r.totalMarks, maxMarks: r.maxMarks, percentage: r.percentage, grade: r.grade ?? null, rank: r.rank ?? null, passed: r.subjects.every((x) => x.passed), subjects });
    }
    return out.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name));
  },
});

/**
 * Marks-entry progress of an exam: every paper × section that sits it, with
 * how many active students have a mark row (a number or "absent").
 * `ready` is true when publish would succeed (every paper complete).
 */
export const progress = schoolQuery({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    requirePermission(ctx.actor, "exams:manage");
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    const sections = await sectionsOfExam(ctx, exam);
    const rows = [];
    for (const p of await papersOf(ctx, exam)) {
      const subject = await ctx.db.get(p.subjectId);
      for (const section of sections.filter((s) => s.classId === p.classId)) {
        const total = (await activeRoster(ctx, section._id)).length;
        const entered = (await ctx.db.query("marks").withIndex("by_paper_section", (q) => q.eq("examSubjectId", p._id).eq("sectionId", section._id)).collect()).length;
        rows.push({ examSubjectId: p._id, subject: subject?.name ?? "", sectionId: section._id, section: section.displayName, entered: Math.min(entered, total), total });
      }
    }
    rows.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }) || a.subject.localeCompare(b.subject));
    return { rows, ready: rows.length > 0 && rows.every((r) => r.entered >= r.total) };
  },
});
