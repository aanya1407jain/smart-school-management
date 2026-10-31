/**
 * Read models for ONE student's school records, shared by the student portal
 * (convex/studentPortal.ts) and the staff profile view
 * (academics.getStudentProfile).
 *
 * These helpers do NOT authorize: every caller must first resolve the student
 * through an access check (requireStudentAccess / requireOwnStudentAccess
 * / the portal resolver) and decide which sections it may include. Every
 * helper returns explicit, minimal fields — never a spread database document.
 * Amounts are returned in minor units (paise); the UI formats them.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { classTeacherOf, teacherDisplayName } from "./academics";

// Attendance, results, homework, timetable and fee read models live in their
// modules (model/attendanceRecords.ts, examRecords.ts, academicsRecords.ts,
// feeRecords.ts) and are reached through providers (core/registry.ts).

export type EnrollmentState = "active" | "ended" | "missing" | "no_current_year";

/** Bound for list reads (never truncates real data). */
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
    scholarNo: s.scholarNo ?? null,
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

/**
 * Parent contacts of a student (contact data only — never an account). Phone /
 * email only when `withContact` (school staff with full access, or the
 * student themself).
 */
export async function parentContactsOf(ctx: QueryCtx, student: Doc<"students">, withContact: boolean) {
  const links = (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect())
    .filter((l) => l.schoolId === student.schoolId);
  const out = [];
  for (const l of links) {
    const g = await ctx.db.get(l.guardianId);
    if (!g || g.schoolId !== student.schoolId) continue;
    out.push({
      contactId: g._id,
      name: g.name,
      relationship: l.relationship,
      isPrimary: l.isPrimary,
      ...(withContact ? { phone: g.phone, email: g.email ?? null, occupation: g.occupation ?? null } : { phone: null, email: null, occupation: null }),
    });
  }
  return out.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
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
