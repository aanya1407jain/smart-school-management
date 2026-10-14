/**
 * Read models for ONE student's school records, shared by the student portal
 * (convex/studentPortal.ts) and the staff profile view
 * (academics.getStudentProfile).
 *
 * These helpers do NOT authorize: every caller must first resolve the student
 * through an access check (requireStudentAccess / requireGuardianStudentAccess
 * / the portal resolver) and decide which sections it may include. Every
 * helper returns explicit, minimal fields — never a spread database document.
 * Amounts are returned in minor units (paise); the UI formats them.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { classTeacherOf, teacherDisplayName } from "./academics";

export type EnrollmentState = "active" | "ended" | "missing" | "no_current_year";

/** Bounds for list reads (a school year has ≤ 366 days; these never truncate real data). */
const MAX_HOMEWORK = 300;
const MAX_NOTICES = 100;

export async function currentYear(ctx: QueryCtx, schoolId: Id<"schools">): Promise<Doc<"academicYears"> | null> {
  const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
  if (!settings?.currentAcademicYearId) return null;
  const year = await ctx.db.get(settings.currentAcademicYearId);
  return year && year.schoolId === schoolId ? year : null;
}

/** The student's current-year enrollment row: the active one, else the most recent one of that year. */
export async function currentEnrollmentRow(ctx: QueryCtx, student: Doc<"students">, year: Doc<"academicYears"> | null) {
  if (!year) return null;
  const rows = (await ctx.db
    .query("enrollments")
    .withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id))
    .collect()).filter((e) => e.schoolId === student.schoolId);
  return rows.find((e) => e.status === "active") ?? rows.sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
}

/** Placement in the current year with display labels (class, section, roll, class teacher). */
export async function placement(ctx: QueryCtx, student: Doc<"students">, year: Doc<"academicYears"> | null) {
  if (!year) return { enrollmentState: "no_current_year" as EnrollmentState, enrollment: null, row: null };
  const chosen = await currentEnrollmentRow(ctx, student, year);
  if (!chosen) return { enrollmentState: "missing" as EnrollmentState, enrollment: null, row: null };
  const section = await ctx.db.get(chosen.sectionId);
  const klass = await ctx.db.get(chosen.classId);
  const sectionOk = section && section.schoolId === student.schoolId ? section : null;
  const teacher = sectionOk ? await classTeacherOf(ctx, sectionOk) : null;
  return {
    enrollmentState: (chosen.status === "active" ? "active" : "ended") as EnrollmentState,
    row: chosen,
    enrollment: {
      enrollmentId: chosen._id,
      status: chosen.status,
      startDate: chosen.startDate,
      endDate: chosen.endDate ?? null,
      rollNo: chosen.status === "active" ? (chosen.rollNo ?? null) : null,
      className: klass && klass.schoolId === student.schoolId ? klass.name : null,
      sectionName: sectionOk?.name ?? null,
      sectionDisplayName: sectionOk?.displayName ?? null,
      room: sectionOk?.room ?? null,
      classTeacher: teacher ? teacherDisplayName(teacher) : null,
    },
  };
}

/** Public, non-sensitive student fields. */
export function studentFields(s: Doc<"students">) {
  return {
    studentId: s._id,
    firstName: s.firstName,
    lastName: s.lastName,
    admissionNo: s.admissionNo,
    admissionDate: s.admissionDate ?? null,
    status: s.status,
    gender: s.gender ?? null,
    dateOfBirth: s.dateOfBirth ?? null,
    bloodGroup: s.bloodGroup ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
    address: s.address ?? null,
  };
}

/** Guardians of a student. Contact details only when `withContact` (school staff with full access, or the family itself). */
export async function guardiansOf(ctx: QueryCtx, student: Doc<"students">, withContact: boolean) {
  const links = (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect())
    .filter((l) => l.schoolId === student.schoolId);
  const out = [];
  for (const l of links) {
    const g = await ctx.db.get(l.guardianId);
    if (!g || g.schoolId !== student.schoolId) continue;
    out.push({
      guardianId: g._id,
      name: g.name,
      relationship: l.relationship,
      isPrimary: l.isPrimary,
      ...(withContact ? { phone: g.phone, email: g.email ?? null, occupation: g.occupation ?? null } : { phone: null, email: null, occupation: null }),
    });
  }
  return out.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
}

/** Day-by-day attendance in the academic year (≤ 366 rows). */
export async function attendanceRecords(ctx: QueryCtx, studentId: Id<"students">, year: Doc<"academicYears">) {
  const rows = await ctx.db
    .query("attendanceRecords")
    .withIndex("by_student_date", (q) => q.eq("studentId", studentId).gte("date", year.startDate).lte("date", year.endDate))
    .collect();
  return rows.map((r) => ({ date: r.date, status: r.status, remark: r.remark ?? null }));
}

/** Published exam results (snapshots written at publication). */
export async function publishedResults(ctx: QueryCtx, student: Doc<"students">) {
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
      subjects,
    });
  }
  return out.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/**
 * Fee ledger for one academic year: obligations with concession, paid and
 * outstanding amounts, effective payments with receipt numbers, and totals.
 * A payment counts when it is `completed` and not reversed (a reversal is a
 * separate row pointing at the original).
 */
export async function feeLedger(ctx: QueryCtx, student: Doc<"students">, year: Doc<"academicYears">) {
  const obligations = (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect())
    .filter((o) => o.schoolId === student.schoolId && o.status === "active")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const concessions = (await ctx.db.query("feeConcessions").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect())
    .filter((c) => c.schoolId === student.schoolId && c.status === "active");
  const allPayments = (await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", student._id)).collect())
    .filter((p) => p.schoolId === student.schoolId && p.academicYearId === year._id);
  const reversed = new Set(allPayments.map((p) => p.reversalOfPaymentId).filter((x): x is Id<"feePayments"> => !!x));
  const payments = allPayments.filter((p) => p.status === "completed" && !p.reversalOfPaymentId && !reversed.has(p._id));

  // Concessions: per-obligation ones apply to that obligation; year-wide percent ones to every
  // obligation; year-wide fixed ones are spread over obligations in due-date order.
  const concessionBy = new Map<Id<"studentFees">, number>();
  for (const o of obligations) {
    let c = 0;
    for (const k of concessions) {
      if (k.studentFeeId && k.studentFeeId !== o._id) continue;
      if (k.kind === "percent") c += Math.round((o.amountMinor * k.value) / 10000);
      else if (k.studentFeeId) c += k.value;
    }
    concessionBy.set(o._id, Math.min(c, o.amountMinor));
  }
  for (const k of concessions.filter((x) => x.kind === "fixed" && !x.studentFeeId)) {
    let left = k.value;
    for (const o of obligations) {
      if (left <= 0) break;
      const room = o.amountMinor - (concessionBy.get(o._id) ?? 0);
      const take = Math.min(room, left);
      concessionBy.set(o._id, (concessionBy.get(o._id) ?? 0) + take);
      left -= take;
    }
  }
  const paidBy = new Map<Id<"studentFees">, number>();
  for (const p of payments) for (const a of p.allocations) paidBy.set(a.studentFeeId, (paidBy.get(a.studentFeeId) ?? 0) + a.amountMinor);

  const rows = obligations.map((o) => {
    const concession = concessionBy.get(o._id) ?? 0;
    const paid = paidBy.get(o._id) ?? 0;
    const net = o.amountMinor - concession;
    return { obligationId: o._id, label: o.label, dueDate: o.dueDate, amountMinor: o.amountMinor, concessionMinor: concession, netMinor: net, paidMinor: paid, outstandingMinor: Math.max(0, net - paid) };
  });
  const paymentRows = [];
  for (const p of payments.sort((a, b) => b.paidOn.localeCompare(a.paidOn))) {
    const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", p._id)).first();
    paymentRows.push({ paymentId: p._id, paidOn: p.paidOn, amountMinor: p.amountMinor, method: p.method, receiptNo: receipt && receipt.schoolId === student.schoolId ? receipt.receiptNo : null });
  }
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    academicYear: year.name,
    obligations: rows,
    payments: paymentRows,
    totals: { grossMinor: sum((r) => r.amountMinor), concessionMinor: sum((r) => r.concessionMinor), paidMinor: sum((r) => r.paidMinor), outstandingMinor: sum((r) => r.outstandingMinor) },
  };
}

/** Homework set for a section in a year, with this student's own submission (if any). */
export async function homeworkFor(ctx: QueryCtx, student: Doc<"students">, section: Doc<"sections">) {
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
      submission: sub && sub.schoolId === student.schoolId ? { status: sub.status, submittedAt: sub.submittedAt, feedback: sub.feedback ?? null } : null,
    });
  }
  return out;
}

/** The weekly timetable of a section (its own academic year), with the bell schedule. */
export async function timetableFor(ctx: QueryCtx, section: Doc<"sections">) {
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
    lessons.push({ dayOfWeek: e.dayOfWeek, periodId: e.periodId, subject: await nameOf(e.subjectId, "subject"), teacher: await nameOf(e.teacherId, "teacher"), room: e.room ?? null });
  }
  return { periods, lessons };
}

/**
 * Published notices addressed to a student in a section: the whole school,
 * the student role, the student's class or the student's section. Only notices
 * already published on `today` and not expired before it.
 */
export async function noticesForStudent(ctx: QueryCtx, schoolId: Id<"schools">, placementRow: Doc<"enrollments"> | null, today: string) {
  const rows = await ctx.db
    .query("notices")
    .withIndex("by_school_status_publish", (q) => q.eq("schoolId", schoolId).eq("status", "published").lte("publishDate", today))
    .order("desc")
    .take(MAX_NOTICES);
  const active = placementRow && placementRow.status === "active" ? placementRow : null;
  return rows
    .filter((n) => !n.expiresOn || n.expiresOn >= today)
    .filter((n) => {
      const a = n.audience;
      if (a.kind === "all") return true;
      if (a.kind === "roles") return a.roles.includes("student");
      if (a.kind === "classes") return !!active && a.classIds.includes(active.classId);
      return !!active && a.sectionIds.includes(active.sectionId);
    })
    .map((n) => ({ noticeId: n._id, title: n.title, body: n.body, type: n.type, priority: n.priority, publishDate: n.publishDate, eventDate: n.eventDate ?? null, expiresOn: n.expiresOn ?? null }));
}
