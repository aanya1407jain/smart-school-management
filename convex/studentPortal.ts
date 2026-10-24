/**
 * Student portal — the signed-in student's OWN school record, resolved
 * entirely on the server:
 *
 *   Convex Auth session → users → schoolMemberships (role "student")
 *     → membership.studentId → students → enrollments (current academic year)
 *     → sections / classes
 *
 * The browser never supplies the identity. `studentId` is OPTIONAL; when given
 * it must be the signed-in student's own id — anything else is NOT_FOUND,
 * exactly like every other student-data function. Roll numbers are display
 * data only. (There are no parent/guardian accounts.)
 *
 * Missing data is reported explicitly (`state` / `enrollmentState`) instead of
 * being papered over, so the UI can tell the student what to ask the office.
 */
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolQuery, moduleQuery } from "./core/functions";
import type { Actor } from "./core/actor";
import type { Permission } from "./core/permissions";
import { getSchoolSettings, linkedStudentIds, requireOwnStudentAccess, requirePermission } from "./core/authorization";
import { assertIsoDate } from "./core/validators";
import { fullName } from "./model/academics";
import {
  currentYear, feeLedger, parentContactsOf, homeworkFor, noticesForStudent, placement, publishedResults, studentFields, timetableFor,
} from "./model/studentRecords";

// Module entitlements (model/modules.ts): myProfile is core; the other pages belong to their module.
const academicsQuery = moduleQuery("academics");
const financeQuery = moduleQuery("finance");
const administrationQuery = moduleQuery("administration");

type Ctx = QueryCtx & { actor: Actor };

/**
 * The student this portal request is about: the signed-in student themself.
 * A `studentId` other than their own is NOT_FOUND. Never trusts a
 * browser-supplied id on its own.
 */
async function resolvePortalStudent(ctx: Ctx, studentId: Id<"students"> | undefined, permission: Permission): Promise<Doc<"students"> | null> {
  requirePermission(ctx.actor, "area:student");
  requirePermission(ctx.actor, permission);
  if (studentId) return await requireOwnStudentAccess(ctx, studentId);
  for (const id of await linkedStudentIds(ctx, ctx.actor)) {
    const s = await ctx.db.get(id);
    if (s && s.schoolId === ctx.actor.schoolId) return s;
  }
  return null;
}

/** The student's active section in the current year (null when not actively enrolled). */
async function activeSection(ctx: Ctx, student: Doc<"students">) {
  const year = await currentYear(ctx, ctx.actor.schoolId);
  const { row } = await placement(ctx, student, year);
  if (!year || !row || row.status !== "active") return { year, row, section: null };
  const section = await ctx.db.get(row.sectionId);
  return { year, row, section: section && section.schoolId === ctx.actor.schoolId ? section : null };
}

const vPortalStudent = { studentId: v.optional(v.id("students")) };

/**
 * My school record. Returns `{ state: "no_student_record" }` when this
 * membership is not linked to any student in its school (the account exists
 * but the office has not linked it — never filled with demo data).
 */
export const myProfile = schoolQuery({
  args: vPortalStudent,
  handler: async (ctx, { studentId }) => {
    const student = await resolvePortalStudent(ctx, studentId, "profile:read:own");
    if (!student) return { state: "no_student_record" as const };
    const year = await currentYear(ctx, ctx.actor.schoolId);
    const { enrollmentState, enrollment } = await placement(ctx, student, year);
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    return {
      state: "ok" as const,
      student: { ...studentFields(student), name: fullName(student) },
      academicYear: year ? { academicYearId: year._id, name: year.name, startDate: year.startDate, endDate: year.endDate, status: year.status } : null,
      enrollmentState,
      enrollment,
      // The student's own parent contacts (contact data only).
      parentContacts: (await parentContactsOf(ctx, student, true)).map(({ name, relationship, phone, email, isPrimary }) => ({ name, relationship, phone, email, isPrimary })),
      lowAttendanceThreshold: settings.attendance.lowAttendanceThreshold,
    };
  },
});

/** Weekly timetable of the student's current section. */
export const myTimetable = academicsQuery({
  args: vPortalStudent,
  handler: async (ctx, { studentId }) => {
    const student = await resolvePortalStudent(ctx, studentId, "timetable:read:own");
    if (!student) return { state: "no_student_record" as const };
    const { section } = await activeSection(ctx, student);
    if (!section) return { state: "not_enrolled" as const };
    return { state: "ok" as const, section: section.displayName, ...(await timetableFor(ctx, section)) };
  },
});

/** Homework set for the student's current section, with their own submission status. */
export const myHomework = academicsQuery({
  args: vPortalStudent,
  handler: async (ctx, { studentId }) => {
    const student = await resolvePortalStudent(ctx, studentId, "homework:read:own");
    if (!student) return { state: "no_student_record" as const };
    const { section } = await activeSection(ctx, student);
    if (!section) return { state: "not_enrolled" as const };
    return { state: "ok" as const, section: section.displayName, homework: await homeworkFor(ctx, student, section) };
  },
});

/** Published exam results of the student. */
export const myResults = academicsQuery({
  args: vPortalStudent,
  handler: async (ctx, { studentId }) => {
    const student = await resolvePortalStudent(ctx, studentId, "results:read:own");
    if (!student) return { state: "no_student_record" as const };
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    return { state: "ok" as const, school: school.name, student: { name: fullName(student), admissionNo: student.admissionNo }, results: await publishedResults(ctx, student) };
  },
});

/** The student's fee obligations, payments and receipts for the current year. */
export const myFees = financeQuery({
  args: vPortalStudent,
  handler: async (ctx, { studentId }) => {
    const student = await resolvePortalStudent(ctx, studentId, "fees:read:own");
    if (!student) return { state: "no_student_record" as const };
    const year = await currentYear(ctx, ctx.actor.schoolId);
    if (!year) return { state: "no_current_year" as const };
    return { state: "ok" as const, ...(await feeLedger(ctx, student, year)) };
  },
});

/**
 * Published notices addressed to the student (school-wide, students, their
 * class or their section). `today` is the client's date in the school's
 * timezone — queries must not read the clock; it only hides notices whose
 * publish date has not arrived or that have expired.
 */
export const myNotices = administrationQuery({
  args: { ...vPortalStudent, today: v.string() },
  handler: async (ctx, { studentId, today }) => {
    assertIsoDate(today, "today");
    const student = await resolvePortalStudent(ctx, studentId, "notices:read");
    if (!student) return { state: "no_student_record" as const };
    const { row } = await activeSection(ctx, student);
    return { state: "ok" as const, notices: await noticesForStudent(ctx, ctx.actor.schoolId, row, today) };
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
      .filter((m) => m.role === "student" && !m.guardianId); // legacy guardian sign-ins are not student accounts
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
