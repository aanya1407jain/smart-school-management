/**
 * Student portal — the signed-in student's (or linked guardian's) OWN school
 * record, resolved entirely on the server:
 *
 *   Convex Auth session → users → schoolMemberships (role "student")
 *     → membership.studentId (student account)  or  guardianLinks (guardian)
 *     → students → enrollments (current academic year) → sections / classes
 *
 * The browser never supplies the identity. `studentId` is OPTIONAL and only
 * CHOOSES among the students the server already links to this membership
 * (guardians with several children); anything else is NOT_FOUND, exactly like
 * every other student-data function. Roll numbers are display data only.
 *
 * Missing data is reported explicitly (`state` / `enrollmentState`) instead of
 * being papered over, so the UI can tell the student what to ask the office.
 */
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolQuery } from "./core/functions";
import { getSchoolSettings, linkedStudentIds, requireGuardianStudentAccess, requirePermission } from "./core/authorization";
import { classTeacherOf, fullName, teacherDisplayName } from "./model/academics";

type EnrollmentState = "active" | "ended" | "missing" | "no_current_year";

async function currentYear(ctx: QueryCtx, schoolId: Id<"schools">): Promise<Doc<"academicYears"> | null> {
  const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
  if (!settings?.currentAcademicYearId) return null;
  const year = await ctx.db.get(settings.currentAcademicYearId);
  return year && year.schoolId === schoolId ? year : null;
}

/** The student's placement in the current year: the active enrollment, else the most recent one of that year. */
async function placement(ctx: QueryCtx, student: Doc<"students">, year: Doc<"academicYears"> | null) {
  if (!year) return { enrollmentState: "no_current_year" as EnrollmentState, enrollment: null };
  const rows = (await ctx.db
    .query("enrollments")
    .withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id))
    .collect()).filter((e) => e.schoolId === student.schoolId);
  const chosen = rows.find((e) => e.status === "active") ?? rows.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (!chosen) return { enrollmentState: "missing" as EnrollmentState, enrollment: null };
  const section = await ctx.db.get(chosen.sectionId);
  const klass = await ctx.db.get(chosen.classId);
  const sectionOk = section && section.schoolId === student.schoolId ? section : null;
  const teacher = sectionOk ? await classTeacherOf(ctx, sectionOk) : null;
  return {
    enrollmentState: (chosen.status === "active" ? "active" : "ended") as EnrollmentState,
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

/**
 * My school record. Returns `{ state: "no_student_record" }` when this
 * membership is not linked to any student in its school (the account exists
 * but the office has not linked it — never filled with demo data).
 */
export const myProfile = schoolQuery({
  args: { studentId: v.optional(v.id("students")) },
  handler: async (ctx, { studentId }) => {
    requirePermission(ctx.actor, "area:student");
    let student: Doc<"students"> | null = null;
    if (studentId) {
      // Self, or a child linked to this guardian — otherwise NOT_FOUND.
      student = await requireGuardianStudentAccess(ctx, studentId);
    } else {
      for (const id of await linkedStudentIds(ctx, ctx.actor)) {
        const s = await ctx.db.get(id);
        if (s && s.schoolId === ctx.actor.schoolId) { student = s; break; }
      }
    }
    if (!student) return { state: "no_student_record" as const };

    const year = await currentYear(ctx, ctx.actor.schoolId);
    const { enrollmentState, enrollment } = await placement(ctx, student, year);
    const links = (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect())
      .filter((l) => l.schoolId === ctx.actor.schoolId);
    const guardians = [];
    for (const l of links) {
      const g = await ctx.db.get(l.guardianId);
      if (g && g.schoolId === ctx.actor.schoolId) {
        guardians.push({ name: g.name, relationship: l.relationship, phone: g.phone, email: g.email ?? null, isPrimary: l.isPrimary });
      }
    }
    guardians.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);

    return {
      state: "ok" as const,
      relation: ctx.actor.studentId === student._id ? ("self" as const) : ("guardian" as const),
      student: {
        studentId: student._id,
        name: fullName(student),
        firstName: student.firstName,
        lastName: student.lastName,
        admissionNo: student.admissionNo,
        admissionDate: student.admissionDate ?? null,
        status: student.status,
        gender: student.gender ?? null,
        dateOfBirth: student.dateOfBirth ?? null,
        bloodGroup: student.bloodGroup ?? null,
        email: student.email ?? null,
        phone: student.phone ?? null,
        address: student.address ?? null,
      },
      academicYear: year ? { academicYearId: year._id, name: year.name, startDate: year.startDate, endDate: year.endDate, status: year.status } : null,
      enrollmentState,
      enrollment,
      guardians,
      lowAttendanceThreshold: settings.attendance.lowAttendanceThreshold,
    };
  },
});

/**
 * READ-ONLY diagnostic for student accounts (internal: CLI/dashboard only,
 * never callable from a browser). Reports, per school, whether every active
 * student account is linked to a student record of the same school with a
 * current-year enrollment, and whether any student has more than one account.
 * Returns Login IDs only — no names beyond what is needed, no secrets. Writes
 * nothing.
 *
 *   npx convex run studentPortal:diagnoseStudentAccounts '{"schoolSlug":"aster-academy"}'
 */
export const diagnoseStudentAccounts = internalQuery({
  args: { schoolSlug: v.string() },
  handler: async (ctx, { schoolSlug }) => {
    const school = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug)).first();
    if (!school) return { found: false as const };
    const year = await currentYear(ctx, school._id);
    const memberships = (await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", school._id).eq("role", "student")).collect())
      .filter((m) => m.role === "student" && !m.guardianId);
    const problems: { loginId: string | null; membershipStatus: string; problem: string }[] = [];
    const perStudent = new Map<string, number>();
    let ok = 0;
    for (const m of memberships) {
      const report = (problem: string) => problems.push({ loginId: m.loginId ?? null, membershipStatus: m.status, problem });
      if (!m.studentId) { report("membership_not_linked_to_student"); continue; }
      perStudent.set(m.studentId, (perStudent.get(m.studentId) ?? 0) + 1);
      const s = await ctx.db.get(m.studentId);
      if (!s) { report("student_record_missing"); continue; }
      if (s.schoolId !== school._id) { report("student_in_other_school"); continue; }
      if (m.status === "active") {
        if (!m.userId) { report("active_without_sign_in_user"); continue; }
        const u = await ctx.db.get(m.userId);
        if (!u || u.loginId !== m.loginId) { report("sign_in_user_login_id_mismatch"); continue; }
      }
      if (!year) { report("school_has_no_current_academic_year"); continue; }
      const { enrollmentState } = await placement(ctx, s, year);
      if (enrollmentState !== "active") { report(`enrollment_${enrollmentState}`); continue; }
      ok++;
    }
    const duplicates = [...perStudent.values()].filter((n) => n > 1).length;
    return {
      found: true as const,
      currentAcademicYear: year?.name ?? null,
      studentAccounts: memberships.length,
      byStatus: memberships.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {}),
      fullyResolved: ok,
      studentsWithMoreThanOneAccount: duplicates,
      problems: problems.slice(0, 200),
    };
  },
});
