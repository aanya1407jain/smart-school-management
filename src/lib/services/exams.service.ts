import type { Database, Exam, ExamStatus, ID, UserAccount } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { addDays, dayOfWeek, todayISO } from "@/lib/utils/dates";
import { gradeFor, percentOf } from "@/lib/utils/grades";
import { hasPermission } from "@/lib/permissions";
import {
  assertStudentInScope, forbidden, handle, invalid, notFound, requireActor, requireAny, requirePermission, scopeFor, ServiceError,
} from "./core";
import { accountsForStudent, examResultFor, fullName, sectionInfo, studentsInSection, teacherName } from "./derive";
import { notify } from "./notify";

export const EXAM_STATUS_FLOW: ExamStatus[] = ["draft", "scheduled", "in_progress", "marks_entry", "published"];

export interface ExamInput {
  name: string;
  term: Exam["term"];
  type: Exam["type"];
  classIds: ID[];
  startDate: string;
  maxMarks: number;
  startTime: string;
  endTime: string;
}

/** Can this actor enter marks for this paper in this section? */
function canEnterMarks(db: Database, actor: UserAccount, sectionId: ID, subjectId: ID) {
  if (hasPermission(actor, "marks:enter:any")) return true;
  if (!hasPermission(actor, "marks:enter:assigned")) return false;
  return scopeFor(actor, db).subjectPairs.has(`${sectionId}|${subjectId}`);
}

function paperProgress(db: Database, paperId: ID, sectionId: ID) {
  const roster = studentsInSection(db, sectionId);
  const entered = db.marks.filter((m) => m.paperId === paperId && roster.some((s) => s.id === m.studentId)).length;
  return { entered, total: roster.length, complete: roster.length > 0 && entered >= roster.length };
}

function examProgress(db: Database, exam: Exam) {
  let total = 0, complete = 0;
  const pending: { paperId: ID; sectionId: ID; label: string; subject: string; teacher: string | null }[] = [];
  for (const p of db.examPapers.filter((x) => x.examId === exam.id)) {
    for (const s of db.sections.filter((x) => x.classId === p.classId)) {
      total += 1;
      const prog = paperProgress(db, p.id, s.id);
      if (prog.complete) complete += 1;
      else {
        const a = db.teacherAssignments.find((x) => x.sectionId === s.id && x.subjectId === p.subjectId);
        const t = a && db.teachers.find((x) => x.id === a.teacherId);
        pending.push({ paperId: p.id, sectionId: s.id, label: sectionInfo(db, s.id).label, subject: db.subjects.find((x) => x.id === p.subjectId)!.name, teacher: t ? teacherName(t) : null });
      }
    }
  }
  return { total, complete, percentage: total ? (complete / total) * 100 : 0, pending };
}

export const mockExamService = {
  async list(filters: { classId?: string; status?: ExamStatus | "all"; search?: string } = {}) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["exams:manage", "exams:read:assigned"]);
      const db = readDb();
      const scope = scopeFor(actor, db);
      const myClassIds = new Set(db.sections.filter((s) => scope.all || scope.sectionIds.has(s.id)).map((s) => s.classId));
      return db.exams
        .filter((e) => e.academicYearId === db.school.currentAcademicYearId)
        .filter((e) => scope.all || e.classIds.some((c) => myClassIds.has(c)))
        .filter((e) => !filters.classId || e.classIds.includes(filters.classId))
        .filter((e) => !filters.status || filters.status === "all" || e.status === filters.status)
        .filter((e) => !filters.search || e.name.toLowerCase().includes(filters.search.toLowerCase()))
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((e) => ({
          ...e,
          classNames: e.classIds.map((id) => db.classes.find((c) => c.id === id)?.name ?? id),
          paperCount: db.examPapers.filter((p) => p.examId === e.id && (scope.all || myClassIds.has(p.classId))).length,
          progress: scope.all ? examProgress(db, e) : null,
        }));
    });
  },

  async get(examId: ID) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["exams:manage", "exams:read:assigned"]);
      const db = readDb();
      const exam = db.exams.find((e) => e.id === examId);
      if (!exam) throw notFound("Examination");
      const scope = scopeFor(actor, db);
      const papers = db.examPapers
        .filter((p) => p.examId === examId)
        .map((p) => {
          const sections = db.sections
            .filter((s) => s.classId === p.classId && (scope.all || scope.subjectPairs.has(`${s.id}|${p.subjectId}`)))
            .map((s) => ({ sectionId: s.id, label: sectionInfo(db, s.id).label, ...paperProgress(db, p.id, s.id), canEnter: canEnterMarks(db, actor, s.id, p.subjectId) }));
          return { ...p, subject: db.subjects.find((s) => s.id === p.subjectId)!.name, className: db.classes.find((c) => c.id === p.classId)!.name, grade: db.classes.find((c) => c.id === p.classId)!.grade, sections };
        })
        .filter((p) => p.sections.length > 0)
        .sort((a, b) => a.grade - b.grade || a.date.localeCompare(b.date));
      if (!scope.all && papers.length === 0) throw forbidden("This examination does not include your classes.");
      return { exam, papers, progress: scope.all ? examProgress(db, exam) : null };
    });
  },

  /** Creates an exam and auto-generates a date sheet (one paper per class × subject). */
  async create(input: ExamInput) {
    return handle(() => {
      requirePermission(requireActor(), "exams:manage");
      const e: Record<string, string> = {};
      if (!input.name.trim()) e.name = "Exam name is required";
      if (!input.classIds.length) e.classIds = "Select at least one class";
      if (!input.startDate) e.startDate = "Start date is required";
      if (!(input.maxMarks > 0 && input.maxMarks <= 200)) e.maxMarks = "Between 1 and 200";
      if (input.endTime <= input.startTime) e.endTime = "Must be after start time";
      if (Object.keys(e).length) throw invalid("Please fix the highlighted fields.", e);
      return writeDb((db) => {
        const id = newId("ex");
        let endDate = input.startDate;
        const papers = [];
        for (const classId of input.classIds) {
          const cls = db.classes.find((c) => c.id === classId)!;
          let date = input.startDate;
          while (dayOfWeek(date) === 0) date = addDays(date, 1);
          for (const subjectId of cls.subjectIds) {
            papers.push({ id: newId("ep"), examId: id, classId, subjectId, date, startTime: input.startTime, endTime: input.endTime, maxMarks: input.maxMarks, passMarks: Math.ceil(input.maxMarks * (db.school.settings.passPercentage / 100)) });
            if (date > endDate) endDate = date;
            date = addDays(date, 1);
            while (dayOfWeek(date) === 0) date = addDays(date, 1);
          }
        }
        db.exams.push({ id, academicYearId: db.school.currentAcademicYearId, name: input.name.trim(), term: input.term, type: input.type, classIds: input.classIds, startDate: input.startDate, endDate, status: "scheduled", publishedAt: null });
        db.examPapers.push(...papers);
        // Teachers of those classes + students/guardians get the schedule.
        const sectionIds = db.sections.filter((s) => input.classIds.includes(s.classId)).map((s) => s.id);
        const teacherUserIds = db.users.filter((u) => u.teacherId && db.teacherAssignments.some((a) => a.teacherId === u.teacherId && sectionIds.includes(a.sectionId))).map((u) => u.id);
        notify(db, teacherUserIds, { category: "examination", title: `${input.name.trim()} scheduled`, message: `Date sheet published. Papers begin ${input.startDate}.`, href: "/teacher/examinations" });
        const studentUserIds = db.users.filter((u) => u.role === "student" && (u.studentIds ?? []).some((sid) => db.enrollments.some((en) => en.studentId === sid && sectionIds.includes(en.sectionId)))).map((u) => u.id);
        notify(db, studentUserIds, { category: "examination", title: `${input.name.trim()} date sheet`, message: `Your exams begin on ${input.startDate}.`, href: "/student/results" });
        return { id };
      });
    });
  },

  async updatePaper(paperId: ID, patch: { date: string; startTime: string; endTime: string; maxMarks: number }) {
    return handle(() => {
      requirePermission(requireActor(), "exams:manage");
      return writeDb((db) => {
        const p = db.examPapers.find((x) => x.id === paperId);
        if (!p) throw notFound("Paper");
        const exam = db.exams.find((e) => e.id === p.examId)!;
        if (exam.status === "published") throw new ServiceError("CONFLICT", "Published exams cannot be edited.");
        if (db.marks.some((m) => m.paperId === paperId) && patch.maxMarks !== p.maxMarks) throw invalid("Max marks cannot change after marks are entered.", { maxMarks: "Marks already entered" });
        Object.assign(p, patch, { passMarks: Math.ceil(patch.maxMarks * (db.school.settings.passPercentage / 100)) });
        const dates = db.examPapers.filter((x) => x.examId === exam.id).map((x) => x.date).sort();
        exam.startDate = dates[0];
        exam.endDate = dates[dates.length - 1];
        return { ok: true };
      });
    });
  },

  async setStatus(examId: ID, status: Exclude<ExamStatus, "published">) {
    return handle(() => {
      requirePermission(requireActor(), "exams:manage");
      return writeDb((db) => {
        const exam = db.exams.find((e) => e.id === examId);
        if (!exam) throw notFound("Examination");
        exam.status = status;
        exam.publishedAt = null;
        if (status === "marks_entry") {
          const sectionIds = db.sections.filter((s) => exam.classIds.includes(s.classId)).map((s) => s.id);
          const ids = db.users.filter((u) => u.teacherId && db.teacherAssignments.some((a) => a.teacherId === u.teacherId && sectionIds.includes(a.sectionId))).map((u) => u.id);
          notify(db, ids, { category: "examination", title: `Marks entry open: ${exam.name}`, message: "Enter marks for your subjects and sections.", href: "/teacher/examinations" });
        }
        return { ok: true };
      });
    });
  },

  async getMarksSheet(paperId: ID, sectionId: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const paper = db.examPapers.find((p) => p.id === paperId);
      if (!paper) throw notFound("Paper");
      if (!canEnterMarks(db, actor, sectionId, paper.subjectId)) throw forbidden("You are not assigned to this subject for this section.");
      const exam = db.exams.find((e) => e.id === paper.examId)!;
      const roster = studentsInSection(db, sectionId);
      return {
        exam: { id: exam.id, name: exam.name, status: exam.status },
        paper: { ...paper, subject: db.subjects.find((s) => s.id === paper.subjectId)!.name },
        sectionLabel: sectionInfo(db, sectionId).label,
        locked: exam.status === "published" || exam.status === "scheduled" || exam.status === "draft",
        lockReason: exam.status === "published" ? "Results are published. Ask the office to reopen marks entry." : exam.status === "scheduled" || exam.status === "draft" ? "Marks entry opens once the exam is in progress." : null,
        students: roster.map((s) => {
          const m = db.marks.find((x) => x.paperId === paperId && x.studentId === s.id);
          return { id: s.id, name: fullName(s), admissionNo: s.admissionNo, rollNo: db.enrollments.find((e) => e.studentId === s.id && e.sectionId === sectionId)?.rollNo ?? 0, marks: m?.marks ?? null, absent: m?.absent ?? false, entered: !!m };
        }),
      };
    });
  },

  async saveMarks(paperId: ID, sectionId: ID, entries: Record<ID, { marks: number | null; absent: boolean }>) {
    return handle(() => {
      const actor = requireActor();
      return writeDb((db) => {
        const paper = db.examPapers.find((p) => p.id === paperId);
        if (!paper) throw notFound("Paper");
        if (!canEnterMarks(db, actor, sectionId, paper.subjectId)) throw forbidden("You are not assigned to this subject for this section.");
        const exam = db.exams.find((e) => e.id === paper.examId)!;
        if (!["in_progress", "marks_entry"].includes(exam.status)) throw new ServiceError("CONFLICT", "Marks entry is not open for this exam.");
        const errors: Record<string, string> = {};
        for (const [sid, v] of Object.entries(entries)) {
          if (v.absent) continue;
          if (v.marks === null || Number.isNaN(v.marks)) continue;
          if (v.marks < 0 || v.marks > paper.maxMarks) errors[sid] = `0–${paper.maxMarks}`;
        }
        if (Object.keys(errors).length) throw invalid(`Marks must be between 0 and ${paper.maxMarks}.`, errors);
        const roster = new Set(studentsInSection(db, sectionId).map((s) => s.id));
        let saved = 0;
        for (const [sid, v] of Object.entries(entries)) {
          if (!roster.has(sid)) continue;
          if (!v.absent && (v.marks === null || Number.isNaN(v.marks))) continue; // leave blank
          const existing = db.marks.find((m) => m.paperId === paperId && m.studentId === sid);
          const rec = { marks: v.absent ? null : v.marks, absent: v.absent, enteredBy: actor.id, updatedAt: new Date().toISOString() };
          if (existing) Object.assign(existing, rec);
          else db.marks.push({ id: newId("mk"), paperId, studentId: sid, ...rec });
          saved += 1;
        }
        const prog = paperProgress(db, paperId, sectionId);
        if (prog.complete && actor.role !== "admin") {
          notify(db, db.users.filter((u) => u.role === "admin").map((u) => u.id), {
            category: "examination", title: `Marks submitted: ${db.subjects.find((s) => s.id === paper.subjectId)!.name} ${sectionInfo(db, sectionId).label}`,
            message: `${actor.displayName} completed ${exam.name} marks entry.`, href: `/admin/examinations/${exam.id}`,
          });
        }
        return { saved, ...prog };
      });
    });
  },

  async publish(examId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "exams:publish");
      return writeDb((db) => {
        const exam = db.exams.find((e) => e.id === examId);
        if (!exam) throw notFound("Examination");
        const prog = examProgress(db, exam);
        if (prog.pending.length) throw new ServiceError("CONFLICT", `${prog.pending.length} paper(s) still need marks before results can be published.`);
        exam.status = "published";
        exam.publishedAt = new Date().toISOString();
        const sectionIds = db.sections.filter((s) => exam.classIds.includes(s.classId)).map((s) => s.id);
        for (const secId of sectionIds) {
          for (const st of studentsInSection(db, secId)) {
            const r = examResultFor(db, st.id, exam);
            notify(db, accountsForStudent(db, st.id).map((u) => u.id), {
              category: "examination", title: `${exam.name} results published`,
              message: r?.grade ? `${st.firstName}'s overall grade: ${r.grade} (${r.percentage?.toFixed(1)}%)` : "Results are now available.", href: "/student/results",
            });
          }
        }
        return { ok: true };
      });
    });
  },

  /** Class result sheet with ranks (admin, or teacher assigned to the section). */
  async getSectionResults(examId: ID, sectionId: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const scope = scopeFor(actor, db);
      if (!scope.all && !scope.sectionIds.has(sectionId)) throw forbidden("This class is not assigned to you.");
      requireAny(actor, ["exams:manage", "exams:read:assigned"]);
      const exam = db.exams.find((e) => e.id === examId);
      if (!exam) throw notFound("Examination");
      const rows = studentsInSection(db, sectionId).map((s) => ({ studentId: s.id, name: fullName(s), result: examResultFor(db, s.id, exam)! }));
      const ranked = [...rows].filter((r) => r.result.percentage !== null).sort((a, b) => (b.result.percentage ?? 0) - (a.result.percentage ?? 0));
      const subjects = rows[0]?.result.rows.map((r) => r.subject) ?? [];
      const subjectAverages = subjects.map((sub, i) => {
        const vals = rows.map((r) => r.result.rows[i]).filter((x) => x.marks !== null);
        const avg = vals.length ? vals.reduce((a, x) => a + percentOf(x.marks!, x.maxMarks), 0) / vals.length : null;
        return { subject: sub, average: avg, grade: avg === null ? null : gradeFor(avg).grade };
      });
      return {
        exam, sectionLabel: sectionInfo(db, sectionId).label,
        rows: rows.map((r) => ({ ...r, rank: ranked.findIndex((x) => x.studentId === r.studentId) + 1 || null })),
        subjectAverages,
        classAverage: ranked.length ? ranked.reduce((a, r) => a + (r.result.percentage ?? 0), 0) / ranked.length : null,
      };
    });
  },

  /** Published results for one student (student portal). */
  async getStudentResults(studentId: ID) {
    return handle(() => {
      const actor = requireActor();
      if (actor.role === "student") {
        if (!actor.studentIds?.includes(studentId)) throw forbidden("You can only view your own results.");
      } else assertStudentInScope(actor, studentId);
      const db = readDb();
      const visible = db.exams
        .filter((e) => e.academicYearId === db.school.currentAcademicYearId && (actor.role === "student" ? e.status === "published" : e.status !== "scheduled"))
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      const results = visible.map((e) => {
        const r = examResultFor(db, studentId, e)!;
        // class rank among the student's section
        const secId = db.enrollments.find((x) => x.studentId === studentId && x.academicYearId === db.school.currentAcademicYearId)?.sectionId;
        const peers = secId ? studentsInSection(db, secId).map((s) => examResultFor(db, s.id, e)?.percentage ?? -1).sort((a, b) => b - a) : [];
        const rank = r.percentage !== null ? peers.indexOf(r.percentage) + 1 : null;
        return { ...r, rank, classSize: peers.length, publishedAt: e.publishedAt };
      });
      const pending = db.exams.filter((e) => e.academicYearId === db.school.currentAcademicYearId && e.status !== "published" && e.status !== "draft").map((e) => ({ id: e.id, name: e.name, status: e.status, startDate: e.startDate, endDate: e.endDate }));
      return { results, pending };
    });
  },

  /** Teacher's outstanding marks-entry work. */
  async getMarkEntryTasks() {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "marks:enter:assigned");
      const db = readDb();
      const scope = scopeFor(actor, db);
      const tasks: { examId: ID; examName: string; paperId: ID; sectionId: ID; label: string; subject: string; entered: number; total: number; date: string }[] = [];
      for (const exam of db.exams.filter((e) => e.status === "marks_entry" || e.status === "in_progress")) {
        for (const p of db.examPapers.filter((x) => x.examId === exam.id)) {
          for (const s of db.sections.filter((x) => x.classId === p.classId && scope.subjectPairs.has(`${x.id}|${p.subjectId}`))) {
            const prog = paperProgress(db, p.id, s.id);
            if (!prog.complete) tasks.push({ examId: exam.id, examName: exam.name, paperId: p.id, sectionId: s.id, label: sectionInfo(db, s.id).label, subject: db.subjects.find((x) => x.id === p.subjectId)!.name, entered: prog.entered, total: prog.total, date: p.date });
          }
        }
      }
      return tasks;
    });
  },

  /** Upcoming papers within the actor's scope. */
  async getUpcoming(limit = 6, studentId?: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const today = todayISO();
      const scope = scopeFor(actor, db);
      let classIds: Set<ID>;
      let subjectFilter: ((classId: ID, subjectId: ID) => boolean) | null = null;
      if (actor.role === "student") {
        const sid = studentId ?? actor.studentIds?.[0];
        if (!sid || !actor.studentIds?.includes(sid)) throw forbidden();
        const secId = db.enrollments.find((e) => e.studentId === sid && e.academicYearId === db.school.currentAcademicYearId)?.sectionId;
        classIds = new Set([db.sections.find((s) => s.id === secId)?.classId ?? ""]);
      } else if (actor.role === "teacher") {
        classIds = new Set(db.sections.filter((s) => scope.sectionIds.has(s.id)).map((s) => s.classId));
        subjectFilter = (classId, subjectId) => db.sections.some((s) => s.classId === classId && scope.subjectPairs.has(`${s.id}|${subjectId}`));
      } else classIds = new Set(db.classes.map((c) => c.id));
      return db.examPapers
        .filter((p) => p.date >= today && classIds.has(p.classId) && (!subjectFilter || subjectFilter(p.classId, p.subjectId)))
        .filter((p) => db.exams.find((e) => e.id === p.examId)?.status !== "draft")
        .sort((a, b) => a.date.localeCompare(b.date) || a.classId.localeCompare(b.classId))
        .slice(0, limit)
        .map((p) => ({ ...p, examName: db.exams.find((e) => e.id === p.examId)!.name, subject: db.subjects.find((s) => s.id === p.subjectId)!.name, className: db.classes.find((c) => c.id === p.classId)!.name }));
    });
  },
};

export type ExamService = typeof mockExamService;
