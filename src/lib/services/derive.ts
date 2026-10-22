/**
 * Pure business logic computed from the database. These are the rules a
 * backend would own (attendance %, fee balances, grades, notice audiences),
 * so they live with the services — never inside components.
 */
import type {
  Database, School, Enrollment, Exam, FeeObligation, Homework, HomeworkSubmission, ID, Notice, Student, Teacher, UserAccount,
} from "@/types/domain";
import { gradeFor, percentOf } from "@/lib/utils/grades";
import { todayISO, daysBetween } from "@/lib/utils/dates";

// ---------------------------------------------------------------- School identity
// Everything school-specific (name, email domain, number prefixes) is derived from
// `db.school` so the product can be reused for any school without code changes.

/** Short code used to prefix admission, employee and receipt numbers — "Aster Academy" → "AA". */
export function schoolCode(school: Pick<School, "name">): string {
  const initials = school.name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean).map((w) => w[0]).join("");
  return (initials.slice(0, 4) || "SCH").toUpperCase();
}

/** Domain used for generated login emails — taken from the school's office email. */
export function schoolEmailDomain(school: Pick<School, "email">): string {
  return school.email.split("@")[1]?.trim().toLowerCase() || "school.example";
}

/** "2026–27" → "26-27", used in receipt numbers. */
export function academicYearCode(db: Database): string {
  const ay = db.academicYears.find((a) => a.id === db.school.currentAcademicYearId);
  const m = ay?.name.match(/(\d{2})(\d{2})\D+(\d{2})/);
  return m ? `${m[2]}-${m[3]}` : (ay?.name ?? "");
}

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
export const teacherName = (t: Teacher) => `${t.title} ${t.firstName} ${t.lastName}`;

export function currentEnrollment(db: Database, studentId: ID): Enrollment | undefined {
  const y = db.school.currentAcademicYearId;
  return db.enrollments.find((e) => e.studentId === studentId && e.academicYearId === y && e.status === "active");
}

export function sectionInfo(db: Database, sectionId: ID | undefined | null) {
  const section = db.sections.find((s) => s.id === sectionId);
  const cls = section ? db.classes.find((c) => c.id === section.classId) : undefined;
  return {
    section,
    cls,
    label: section && cls ? `${cls.grade}-${section.name}` : "—",
    longLabel: section && cls ? `Class ${cls.grade} · Section ${section.name}` : "Not enrolled",
  };
}

export function studentsInSection(db: Database, sectionId: ID): Student[] {
  const y = db.school.currentAcademicYearId;
  const enr = db.enrollments
    .filter((e) => e.sectionId === sectionId && e.academicYearId === y && e.status === "active")
    .sort((a, b) => a.rollNo - b.rollNo);
  return enr.map((e) => db.students.find((s) => s.id === e.studentId)!).filter((s) => s && s.status === "active");
}

export function primaryGuardian(db: Database, studentId: ID) {
  const link = db.guardianLinks.find((l) => l.studentId === studentId && l.isPrimary) ?? db.guardianLinks.find((l) => l.studentId === studentId);
  const guardian = link ? db.guardians.find((g) => g.id === link.guardianId) : undefined;
  return guardian && link ? { ...guardian, relation: link.relation } : null;
}

// ------------------------------------------------------------------ Attendance

export interface AttendanceStats {
  present: number;
  late: number;
  absent: number;
  total: number;
  percentage: number | null;
}

export function attendanceStats(db: Database, studentId: ID, opts: { from?: string; to?: string } = {}): AttendanceStats {
  const enr = currentEnrollment(db, studentId);
  const stats: AttendanceStats = { present: 0, late: 0, absent: 0, total: 0, percentage: null };
  if (!enr) return stats;
  for (const s of db.attendance) {
    if (s.sectionId !== enr.sectionId) continue;
    if (opts.from && s.date < opts.from) continue;
    if (opts.to && s.date > opts.to) continue;
    const st = s.entries[studentId];
    if (!st) continue;
    stats[st] += 1;
    stats.total += 1;
  }
  const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
  stats.percentage = stats.total ? ((stats.present + (lateCounts ? stats.late : 0)) / stats.total) * 100 : null;
  return stats;
}

export function sessionPercentage(db: Database, entries: Record<ID, string>) {
  const vals = Object.values(entries);
  if (!vals.length) return null;
  const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
  const ok = vals.filter((v) => v === "present" || (lateCounts && v === "late")).length;
  return (ok / vals.length) * 100;
}

// ------------------------------------------------------------------ Fees

export type ObligationStatus = "paid" | "partial" | "overdue" | "due" | "upcoming";
export type FeeStanding = "paid" | "clear" | "due_soon" | "overdue" | "not_assigned";

export interface ObligationView extends FeeObligation {
  concession: number;
  net: number;
  paid: number;
  outstanding: number;
  status: ObligationStatus;
}

export function feeLedger(db: Database, studentId: ID, today = todayISO()) {
  const assignments = db.feeAssignments.filter((a) => a.studentId === studentId);
  const obligations = db.feeObligations.filter((o) => o.studentId === studentId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const concessions = db.concessions.filter((c) => c.studentId === studentId);
  const payments = db.payments.filter((p) => p.studentId === studentId).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const receipts = db.receipts.filter((r) => r.studentId === studentId);

  const gross = obligations.reduce((a, o) => a + o.amount, 0);
  const concessionTotal = concessions.reduce((a, c) => a + c.amount, 0);
  const paidTotal = payments.reduce((a, p) => a + p.amount, 0);

  // Concessions are spread across installments in proportion to their amount.
  let remainingPaid = paidTotal;
  const views: ObligationView[] = obligations.map((o) => {
    const conc = gross ? Math.round((o.amount / gross) * concessionTotal) : 0;
    const net = o.amount - conc;
    const applied = Math.min(net, remainingPaid);
    remainingPaid -= applied;
    const outstanding = net - applied;
    let status: ObligationStatus;
    if (outstanding <= 0) status = "paid";
    else if (o.dueDate < today) status = "overdue";
    else if (applied > 0) status = "partial";
    else if (daysBetween(today, o.dueDate) <= 30) status = "due";
    else status = "upcoming";
    return { ...o, concession: conc, net, paid: applied, outstanding, status };
  });

  const net = gross - concessionTotal;
  const outstanding = Math.max(0, net - paidTotal);
  const overdue = views.filter((v) => v.status === "overdue").reduce((a, v) => a + v.outstanding, 0);
  const dueSoon = views.filter((v) => v.status === "due" || v.status === "partial").reduce((a, v) => a + v.outstanding, 0);
  const nextDue = views.find((v) => v.outstanding > 0) ?? null;

  let standing: FeeStanding;
  if (!assignments.length) standing = "not_assigned";
  else if (outstanding <= 0) standing = "paid";
  else if (overdue > 0) standing = "overdue";
  else if (dueSoon > 0) standing = "due_soon";
  else standing = "clear";

  return {
    assignments,
    structures: db.feeStructures.filter((f) => assignments.some((a) => a.feeStructureId === f.id)),
    obligations: views,
    concessions,
    payments,
    receipts,
    totals: { gross, concession: concessionTotal, net, paid: paidTotal, outstanding, overdue, dueSoon },
    nextDue,
    standing,
  };
}
export type FeeLedger = ReturnType<typeof feeLedger>;

// ------------------------------------------------------------------ Exams

export function examResultFor(db: Database, studentId: ID, exam: Exam) {
  const enr = currentEnrollment(db, studentId);
  const section = db.sections.find((s) => s.id === enr?.sectionId);
  if (!section) return null;
  const papers = db.examPapers.filter((p) => p.examId === exam.id && p.classId === section.classId);
  const rows = papers.map((p) => {
    const mark = db.marks.find((m) => m.paperId === p.id && m.studentId === studentId);
    const subject = db.subjects.find((s) => s.id === p.subjectId)!;
    const obtained = mark?.marks ?? null;
    const pct = obtained === null ? null : percentOf(obtained, p.maxMarks);
    return {
      paperId: p.id,
      subjectId: p.subjectId,
      subject: subject.name,
      maxMarks: p.maxMarks,
      passMarks: p.passMarks,
      marks: obtained,
      absent: mark?.absent ?? false,
      entered: !!mark,
      percentage: pct,
      grade: pct === null ? null : gradeFor(pct).grade,
      passed: obtained === null ? null : obtained >= p.passMarks,
    };
  });
  const graded = rows.filter((r) => r.marks !== null);
  const total = graded.reduce((a, r) => a + (r.marks ?? 0), 0);
  const max = rows.reduce((a, r) => a + r.maxMarks, 0);
  const pct = max ? percentOf(total, max) : 0;
  const complete = rows.length > 0 && rows.every((r) => r.entered);
  return {
    examId: exam.id,
    examName: exam.name,
    term: exam.term,
    published: exam.status === "published",
    rows,
    total,
    max,
    percentage: graded.length ? pct : null,
    grade: graded.length ? gradeFor(pct).grade : null,
    remark: graded.length ? gradeFor(pct).remark : null,
    passed: complete ? rows.every((r) => r.passed !== false) : null,
    complete,
  };
}
export type ExamResult = NonNullable<ReturnType<typeof examResultFor>>;

// ------------------------------------------------------------------ Homework

export type StudentHomeworkStatus = "pending" | "overdue" | "submitted" | "late" | "reviewed";
export function homeworkStatusFor(hw: Homework, submission: HomeworkSubmission | undefined, today = todayISO()): StudentHomeworkStatus {
  if (submission) return submission.status;
  return hw.dueDate < today ? "overdue" : "pending";
}

// ------------------------------------------------------------------ Notices

/** Audience rule — used for both listing and notification fan-out. */
export function noticeVisibleTo(db: Database, notice: Notice, user: UserAccount): boolean {
  if (user.role === "admin") return true;
  if (notice.status !== "published") return false;
  const a = notice.audience;
  if (a.scope === "school") return true;
  if (a.scope === "teachers") return user.role === "teacher";
  if (a.scope === "students") return user.role === "student";
  if (user.role === "teacher") {
    // Teachers see class/section notices for classes they teach.
    const tId = user.teacherId;
    const y = db.school.currentAcademicYearId;
    const mySections = new Set(db.teacherAssignments.filter((x) => x.teacherId === tId && x.academicYearId === y).map((x) => x.sectionId));
    db.sections.filter((s) => s.classTeacherId === tId).forEach((s) => mySections.add(s.id));
    if (a.scope === "sections") return (a.sectionIds ?? []).some((id) => mySections.has(id));
    const myClasses = new Set(db.sections.filter((s) => mySections.has(s.id)).map((s) => s.classId));
    return (a.classIds ?? []).some((id) => myClasses.has(id));
  }
  // Student: match the linked student's class or section.
  return (user.studentIds ?? []).some((sid) => {
    const enr = currentEnrollment(db, sid);
    if (!enr) return false;
    if (a.scope === "sections") return (a.sectionIds ?? []).includes(enr.sectionId);
    const sec = db.sections.find((s) => s.id === enr.sectionId);
    return (a.classIds ?? []).includes(sec?.classId ?? "");
  });
}

export function audienceLabel(db: Database, notice: Notice): string {
  const a = notice.audience;
  switch (a.scope) {
    case "school": return "Whole school";
    case "teachers": return "All teachers";
    case "students": return "All students";
    case "classes": return (a.classIds ?? []).map((id) => db.classes.find((c) => c.id === id)?.name ?? id).join(", ");
    case "sections": return (a.sectionIds ?? []).map((id) => `Class ${sectionInfo(db, id).label}`).join(", ");
  }
}

/** Users who should receive a notice notification. */
export function noticeRecipients(db: Database, notice: Notice): UserAccount[] {
  return db.users.filter((u) => u.role !== "admin" && noticeVisibleTo(db, notice, u));
}

/** Student accounts that can see a given student (the student themself). */
export function accountsForStudent(db: Database, studentId: ID): UserAccount[] {
  return db.users.filter((u) => u.role === "student" && u.studentIds?.includes(studentId));
}
