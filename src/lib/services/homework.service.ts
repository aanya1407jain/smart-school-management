import type { ID } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { todayISO, formatShortDate } from "@/lib/utils/dates";
import { hasPermission } from "@/lib/permissions";
import { forbidden, handle, invalid, notFound, requireActor, requireAny, requirePermission, scopeFor } from "./core";
import { accountsForStudent, currentEnrollment, fullName, homeworkStatusFor, sectionInfo, studentsInSection, teacherName, type StudentHomeworkStatus } from "./derive";
import { notify } from "./notify";

export interface HomeworkInput {
  title: string;
  description: string;
  subjectId: ID;
  sectionId: ID;
  dueDate: string;
  attachmentName: string | null;
}

export interface HomeworkFilters {
  sectionId?: string;
  classId?: string;
  subjectId?: string;
  status?: "active" | "closed" | "overdue" | "all";
  search?: string;
}

function validate(input: HomeworkInput) {
  const e: Record<string, string> = {};
  if (input.title.trim().length < 3) e.title = "Give the homework a title";
  if (!input.subjectId) e.subjectId = "Select a subject";
  if (!input.sectionId) e.sectionId = "Select a class";
  if (!input.dueDate) e.dueDate = "Choose a deadline";
  else if (input.dueDate < todayISO()) e.dueDate = "Deadline cannot be in the past";
  if (input.description.trim().length < 10) e.description = "Add clear instructions (at least 10 characters)";
  if (Object.keys(e).length) throw invalid("Please fix the highlighted fields.", e);
}

export const mockHomeworkService = {
  async list(filters: HomeworkFilters = {}) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["homework:read:all", "homework:manage:assigned"]);
      const db = readDb();
      const scope = scopeFor(actor, db);
      const today = todayISO();
      const q = filters.search?.trim().toLowerCase();
      return db.homework
        .filter((h) => scope.all || h.teacherId === scope.teacherId || scope.subjectPairs.has(`${h.sectionId}|${h.subjectId}`))
        .filter((h) => !filters.sectionId || h.sectionId === filters.sectionId)
        .filter((h) => !filters.classId || db.sections.find((s) => s.id === h.sectionId)?.classId === filters.classId)
        .filter((h) => !filters.subjectId || h.subjectId === filters.subjectId)
        .filter((h) => {
          if (!filters.status || filters.status === "all") return true;
          if (filters.status === "overdue") return h.status === "active" && h.dueDate < today;
          return h.status === filters.status;
        })
        .filter((h) => !q || h.title.toLowerCase().includes(q))
        .sort((a, b) => b.assignedOn.localeCompare(a.assignedOn) || b.dueDate.localeCompare(a.dueDate))
        .map((h) => {
          const roster = studentsInSection(db, h.sectionId);
          const subs = db.submissions.filter((s) => s.homeworkId === h.id);
          const t = db.teachers.find((x) => x.id === h.teacherId);
          return {
            ...h, subject: db.subjects.find((s) => s.id === h.subjectId)!.name, sectionLabel: sectionInfo(db, h.sectionId).label,
            teacher: t ? teacherName(t) : "—", submitted: subs.length, reviewed: subs.filter((s) => s.status === "reviewed").length, total: roster.length,
            isOverdue: h.status === "active" && h.dueDate < today,
            canEdit: hasPermission(actor, "homework:manage:assigned") && h.teacherId === scope.teacherId,
          };
        });
    });
  },

  /** Teachers create homework for a section + subject they teach. */
  async create(input: HomeworkInput) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "homework:manage:assigned");
      validate(input);
      return writeDb((db) => {
        const scope = scopeFor(actor, db);
        if (!scope.subjectPairs.has(`${input.sectionId}|${input.subjectId}`)) throw forbidden("You can only set homework for subjects you teach in that class.");
        const id = newId("hw");
        db.homework.push({ id, title: input.title.trim(), description: input.description.trim(), subjectId: input.subjectId, sectionId: input.sectionId, teacherId: scope.teacherId!, assignedOn: todayISO(), dueDate: input.dueDate, attachmentName: input.attachmentName, status: "active" });
        const sub = db.subjects.find((s) => s.id === input.subjectId)!;
        const recipients = studentsInSection(db, input.sectionId).flatMap((s) => accountsForStudent(db, s.id).map((u) => u.id));
        notify(db, recipients, { category: "homework", title: `New homework: ${input.title.trim()}`, message: `${sub.name} · due ${formatShortDate(input.dueDate)}`, href: "/student/homework" });
        return { id, notified: recipients.length, sectionLabel: sectionInfo(db, input.sectionId).label };
      });
    });
  },

  async update(homeworkId: ID, input: HomeworkInput) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "homework:manage:assigned");
      validate({ ...input, dueDate: input.dueDate < todayISO() ? todayISO() : input.dueDate });
      return writeDb((db) => {
        const h = db.homework.find((x) => x.id === homeworkId);
        if (!h) throw notFound("Homework");
        if (h.teacherId !== actor.teacherId) throw forbidden("Only the teacher who set this homework can edit it.");
        Object.assign(h, { title: input.title.trim(), description: input.description.trim(), dueDate: input.dueDate, attachmentName: input.attachmentName });
        return { id: homeworkId };
      });
    });
  },

  async setStatus(homeworkId: ID, status: "active" | "closed") {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "homework:manage:assigned");
      return writeDb((db) => {
        const h = db.homework.find((x) => x.id === homeworkId);
        if (!h) throw notFound("Homework");
        if (h.teacherId !== actor.teacherId) throw forbidden();
        h.status = status;
        return { ok: true };
      });
    });
  },

  async getSubmissions(homeworkId: ID) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["homework:read:all", "homework:manage:assigned"]);
      const db = readDb();
      const h = db.homework.find((x) => x.id === homeworkId);
      if (!h) throw notFound("Homework");
      const scope = scopeFor(actor, db);
      if (!scope.all && h.teacherId !== scope.teacherId && !scope.subjectPairs.has(`${h.sectionId}|${h.subjectId}`)) throw forbidden();
      return {
        homework: { ...h, subject: db.subjects.find((s) => s.id === h.subjectId)!.name, sectionLabel: sectionInfo(db, h.sectionId).label },
        canReview: h.teacherId === scope.teacherId,
        rows: studentsInSection(db, h.sectionId).map((s) => {
          const sub = db.submissions.find((x) => x.homeworkId === h.id && x.studentId === s.id);
          return { studentId: s.id, name: fullName(s), rollNo: currentEnrollment(db, s.id)?.rollNo ?? 0, status: homeworkStatusFor(h, sub), submission: sub ?? null };
        }),
      };
    });
  },

  async review(submissionId: ID, feedback: string) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "homework:manage:assigned");
      return writeDb((db) => {
        const sub = db.submissions.find((s) => s.id === submissionId);
        if (!sub) throw notFound("Submission");
        const h = db.homework.find((x) => x.id === sub.homeworkId)!;
        if (h.teacherId !== actor.teacherId) throw forbidden();
        sub.status = "reviewed";
        sub.feedback = feedback.trim() || null;
        notify(db, accountsForStudent(db, sub.studentId).map((u) => u.id), { category: "homework", title: `Homework reviewed: ${h.title}`, message: feedback.trim() || "Your teacher has reviewed your submission.", href: "/student/homework" });
        return { ok: true };
      });
    });
  },

  /** Student portal: only homework for the student's own section. */
  async getStudentHomework(studentId: ID, filters: { status?: StudentHomeworkStatus | "all" | "todo"; subjectId?: string } = {}) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "homework:read:own");
      if (!actor.studentIds?.includes(studentId)) throw forbidden("You can only view your own homework.");
      const db = readDb();
      const enr = currentEnrollment(db, studentId);
      const today = todayISO();
      return db.homework
        .filter((h) => h.sectionId === enr?.sectionId)
        .map((h) => {
          const sub = db.submissions.find((x) => x.homeworkId === h.id && x.studentId === studentId);
          const t = db.teachers.find((x) => x.id === h.teacherId);
          return { ...h, subject: db.subjects.find((s) => s.id === h.subjectId)!.name, teacher: t ? teacherName(t) : "—", status: homeworkStatusFor(h, sub, today), homeworkStatus: h.status, submission: sub ?? null };
        })
        .filter((h) => !filters.subjectId || h.subjectId === filters.subjectId)
        .filter((h) => {
          if (!filters.status || filters.status === "all") return true;
          if (filters.status === "todo") return h.status === "pending" || h.status === "overdue";
          return h.status === filters.status;
        })
        .sort((a, b) => {
          const rank = (s: string) => (s === "overdue" ? 0 : s === "pending" ? 1 : 2);
          return rank(a.status) - rank(b.status) || a.dueDate.localeCompare(b.dueDate);
        });
    });
  },

  async submit(homeworkId: ID, studentId: ID, content: string, attachmentName: string | null) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "homework:submit");
      if (!actor.studentIds?.includes(studentId)) throw forbidden();
      if (content.trim().length < 5 && !attachmentName) throw invalid("Write a short note or attach your work.", { content: "Add a note or an attachment" });
      return writeDb((db) => {
        const h = db.homework.find((x) => x.id === homeworkId);
        if (!h) throw notFound("Homework");
        if (h.sectionId !== currentEnrollment(db, studentId)?.sectionId) throw forbidden();
        if (h.status === "closed") throw invalid("This homework is closed for submissions.");
        const late = todayISO() > h.dueDate;
        const existing = db.submissions.find((s) => s.homeworkId === homeworkId && s.studentId === studentId);
        if (existing?.status === "reviewed") throw invalid("This submission has already been reviewed.");
        const rec = { submittedAt: new Date().toISOString(), content: content.trim(), attachmentName, status: late ? ("late" as const) : ("submitted" as const), feedback: null };
        if (existing) Object.assign(existing, rec);
        else db.submissions.push({ id: newId("sub"), homeworkId, studentId, ...rec });
        const s = db.students.find((x) => x.id === studentId)!;
        notify(db, [`u_${h.teacherId}`], { category: "homework", title: `Submission: ${h.title}`, message: `${fullName(s)} (${sectionInfo(db, h.sectionId).label})${late ? " — submitted late" : ""}`, href: "/teacher/homework" });
        return { status: rec.status };
      });
    });
  },
};

export type HomeworkService = typeof mockHomeworkService;
