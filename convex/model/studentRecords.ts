/**
 * Read models for ONE student's school records, shared by the student portal
 * (convex/studentPortal.ts) and the staff profile view
 * (academics.getStudentProfile).
 *
 * BUG-012: Dynamic siblings lookup, account details, and full class teacher integration.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { classTeacherOf, teacherDisplayName, fullName } from "./academics";

export type EnrollmentState = "active" | "ended" | "missing" | "no_current_year";

const MAX_NOTICES = 100;

export async function currentYear(ctx: QueryCtx, schoolId: Id<"schools">): Promise<Doc<"academicYears"> | null> {
  const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
  if (!settings?.currentAcademicYearId) return null;
  const year = await ctx.db.get(settings.currentAcademicYearId);
  return year && year.schoolId === schoolId ? year : null;
}

export async function currentEnrollmentRow(ctx: QueryCtx, student: Doc<"students">, year: Doc<"academicYears"> | null) {
  if (!year) return null;
  const rows = (await ctx.db
    .query("enrollments")
    .withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id))
    .collect()).filter((e) => e.schoolId === student.schoolId);
  return rows.find((e) => e.status === "active") ?? rows.sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
}

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
      classTeacherDetails: teacher ? {
        teacherId: teacher._id,
        name: teacherDisplayName(teacher),
        employeeId: teacher.employeeId,
        email: teacher.email ?? null,
        phone: teacher.phone ?? null,
      } : null,
    },
  };
}

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
    previousSchool: s.previousSchool ?? null,
  };
}

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
 * BUG-012 Fix: Look up real siblings sharing the same guardian contacts in the school.
 */
export async function siblingsOf(ctx: QueryCtx, student: Doc<"students">) {
  const guardianLinks = (await ctx.db
    .query("guardianLinks")
    .withIndex("by_student", (q) => q.eq("studentId", student._id))
    .collect()).filter((l) => l.schoolId === student.schoolId);

  const guardianIds = [...new Set(guardianLinks.map((l) => l.guardianId))];
  const siblingIds = new Set<Id<"students">>();

  for (const gId of guardianIds) {
    const linked = await ctx.db
      .query("guardianLinks")
      .withIndex("by_guardian", (q) => q.eq("guardianId", gId))
      .collect();
    for (const l of linked) {
      if (l.schoolId === student.schoolId && l.studentId !== student._id) {
        siblingIds.add(l.studentId);
      }
    }
  }

  const siblings = [];
  for (const sid of siblingIds) {
    const sib = await ctx.db.get(sid);
    if (!sib || sib.schoolId !== student.schoolId) continue;
    const year = await currentYear(ctx, student.schoolId);
    const place = await placement(ctx, sib, year);
    siblings.push({
      studentId: sib._id,
      name: fullName(sib),
      admissionNo: sib.admissionNo,
      scholarNo: sib.scholarNo ?? null,
      status: sib.status,
      className: place.enrollment?.className ?? null,
      sectionDisplayName: place.enrollment?.sectionDisplayName ?? null,
    });
  }
  return siblings;
}

/**
 * BUG-012 Fix: Retrieve actual student login account details from schoolMemberships.
 */
export async function accountOfStudent(ctx: QueryCtx, student: Doc<"students">) {
  const membership = (await ctx.db
    .query("schoolMemberships")
    .withIndex("by_student", (q) => q.eq("studentId", student._id))
    .collect()).find((m) => m.schoolId === student.schoolId && m.role === "student");

  if (!membership) return null;

  return {
    membershipId: membership._id,
    loginId: membership.loginId ?? null,
    status: membership.status,
    role: membership.role,
    activatedAt: membership.activatedAt ?? null,
  };
}

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