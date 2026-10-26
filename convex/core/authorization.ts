/**
 * Centralised authorization & data-access helpers.
 *
 * Rule of thumb for every function:
 *   1. ctx.actor            → who + which school (from schoolQuery/schoolMutation)
 *   2. getInSchool(...)      → load each client-supplied id inside that school
 *   3. requirePermission(...) / requireStudentAccess(...) / requireClassTeacher(...)
 *   4. only then read/write
 *
 * Never compare roles inline in module code (`if (actor.role === "admin")`);
 * use permissions so optional permission sets (accountant) keep working.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { Actor } from "./actor";
import { forbidden, notFound } from "./errors";
import type { Permission } from "./permissions";

type Ctx = QueryCtx & { actor: Actor };

// ---------------------------------------------------------------- permissions
export function hasPermission(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw forbidden();
}

export function requireAnyPermission(actor: Actor, permissions: Permission[]): Permission {
  const found = permissions.find((p) => actor.permissions.has(p));
  if (!found) throw forbidden();
  return found;
}

// ---------------------------------------------------------------- tenant isolation
/** Tables whose documents carry a `schoolId`. */
export type SchoolTable = {
  [T in TableNames]: Doc<T> extends { schoolId: Id<"schools"> } ? T : never;
}[TableNames];

/**
 * Load a document by id and verify it belongs to the actor's school.
 * Missing and cross-school documents both raise NOT_FOUND, so a caller can
 * never probe another school's ids.
 */
export async function getInSchool<T extends SchoolTable>(ctx: Ctx, table: T, id: Id<T>, label?: string): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as Doc<T> | null;
  // `table` is used for the message only; v.id(table) arg validators already pin the table.
  if (!doc || (doc as unknown as { schoolId: Id<"schools"> }).schoolId !== ctx.actor.schoolId) throw notFound(label ?? humanize(table));
  return doc;
}

function humanize(table: string) {
  const s = table.replace(/([A-Z])/g, " $1").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/s$/, "");
}

// ---------------------------------------------------------------- academic year
export async function getSchoolSettings(ctx: QueryCtx, schoolId: Id<"schools">): Promise<Doc<"schoolSettings">> {
  const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).unique();
  if (!settings) throw notFound("School settings");
  return settings;
}

export async function getCurrentAcademicYearId(ctx: QueryCtx, schoolId: Id<"schools">): Promise<Id<"academicYears">> {
  const settings = await getSchoolSettings(ctx, schoolId);
  if (!settings.currentAcademicYearId) throw notFound("Current academic year");
  return settings.currentAcademicYearId;
}

// ---------------------------------------------------------------- teacher scope
/** True when the actor is the CLASS TEACHER (attendance owner) of the section. */
export function isClassTeacherOf(actor: Actor, section: Pick<Doc<"sections">, "classTeacherId" | "schoolId">): boolean {
  return !!actor.teacherId && section.schoolId === actor.schoolId && section.classTeacherId === actor.teacherId;
}

/**
 * Attendance ownership gate. Requires the permission AND class-teacher
 * ownership of this exact section. Subject assignments never qualify.
 */
export async function requireClassTeacher(
  ctx: Ctx,
  sectionId: Id<"sections">,
  permission: Extract<Permission, "attendance:mark:class_teacher" | "attendance:edit:class_teacher">,
): Promise<Doc<"sections">> {
  const section = await getInSchool(ctx, "sections", sectionId, "Section");
  if (!hasPermission(ctx.actor, permission) || !isClassTeacherOf(ctx.actor, section)) {
    throw forbidden("Only the class teacher of this section can mark or edit its attendance.");
  }
  return section;
}

/** Sections the actor's teacher record is linked to in a year: subject assignments ∪ class-teacher sections. */
export async function teacherSectionIds(ctx: QueryCtx, teacherId: Id<"teachers">, academicYearId: Id<"academicYears">): Promise<Set<Id<"sections">>> {
  const ids = new Set<Id<"sections">>();
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", academicYearId))
    .collect();
  assignments.forEach((a) => ids.add(a.sectionId));
  const owned = await ctx.db
    .query("sections")
    .withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacherId).eq("academicYearId", academicYearId))
    .collect();
  owned.forEach((s) => ids.add(s._id));
  return ids;
}

/**
 * Sections whose data the actor may READ at the "assigned" tier in a year:
 * their teaching sections (teacherSectionIds) plus any sections the Principal
 * added to their Students/Attendance view grants (`actor.sectionScope`).
 * Use only for READ checks — teaching duties (marking attendance, homework,
 * marks entry) keep using the teacher's own assignments.
 */
export async function readScopeSectionIds(ctx: QueryCtx, actor: Actor, academicYearId: Id<"academicYears">): Promise<Set<Id<"sections">>> {
  const ids = actor.teacherId ? await teacherSectionIds(ctx, actor.teacherId, academicYearId) : new Set<Id<"sections">>();
  for (const id of actor.sectionScope) ids.add(id);
  return ids;
}

/** Require that the actor teaches (any subject) in, or is class teacher of, the section. */
export async function requireTeacherAssignment(ctx: Ctx, sectionId: Id<"sections">): Promise<Doc<"sections">> {
  const section = await getInSchool(ctx, "sections", sectionId, "Section");
  if (!ctx.actor.teacherId) throw forbidden();
  const ids = await teacherSectionIds(ctx, ctx.actor.teacherId, section.academicYearId);
  if (!ids.has(section._id)) throw forbidden("You are not assigned to this section.");
  return section;
}

/**
 * Read access to a section's data (roster, registers…):
 *   - `*:read:all` permission (admin)           → any section in the school
 *   - `*:read:assigned` permission (teacher)    → only sections in teacher scope
 */
export async function requireSectionRead(
  ctx: Ctx,
  sectionId: Id<"sections">,
  perms: { all: Permission; assigned: Permission },
): Promise<Doc<"sections">> {
  const section = await getInSchool(ctx, "sections", sectionId, "Section");
  if (hasPermission(ctx.actor, perms.all)) return section;
  if (hasPermission(ctx.actor, perms.assigned)) {
    const ids = await readScopeSectionIds(ctx, ctx.actor, section.academicYearId);
    if (ids.has(section._id)) return section;
  }
  throw forbidden();
}

// ---------------------------------------------------------------- students (own records)
/**
 * Students the actor may see in the student portal: only the student's own
 * record (a student-role membership). Parent contacts have no accounts.
 * Kept async/array-shaped so every caller goes through one rule.
 */
export async function linkedStudentIds(_ctx: QueryCtx, actor: Actor): Promise<Id<"students">[]> {
  return actor.studentId ? [actor.studentId] : [];
}

/** Student-portal check: the student must be the signed-in student themself (else NOT_FOUND). */
export async function requireOwnStudentAccess(ctx: Ctx, studentId: Id<"students">): Promise<Doc<"students">> {
  const student = await getInSchool(ctx, "students", studentId, "Student");
  const linked = await linkedStudentIds(ctx, ctx.actor);
  if (!linked.includes(student._id)) throw notFound("Student");
  return student;
}

/** The student's enrollment in a given academic year (active or historical). */
export async function enrollmentFor(ctx: QueryCtx, studentId: Id<"students">, academicYearId: Id<"academicYears">) {
  return await ctx.db
    .query("enrollments")
    .withIndex("by_student_year", (q) => q.eq("studentId", studentId).eq("academicYearId", academicYearId))
    .first();
}

/**
 * Access to one student's records for a data area. `perms` names the three
 * tiers for that area, e.g. attendance: { all: "attendance:read:all",
 * assigned: "attendance:read:assigned", own: "attendance:read:own" }.
 *   - all      → admin / permission-set holders
 *   - assigned → teacher whose scope includes the student's CURRENT section
 *   - own      → the student themself
 */
export async function requireStudentAccess(
  ctx: Ctx,
  studentId: Id<"students">,
  perms: { all?: Permission; assigned?: Permission; own?: Permission },
): Promise<Doc<"students">> {
  const student = await getInSchool(ctx, "students", studentId, "Student");
  const { actor } = ctx;
  if (perms.all && hasPermission(actor, perms.all)) return student;

  if (perms.assigned && hasPermission(actor, perms.assigned) && (actor.teacherId || actor.sectionScope.length)) {
    const yearId = await getCurrentAcademicYearId(ctx, actor.schoolId);
    const enrollment = await enrollmentFor(ctx, student._id, yearId);
    if (enrollment && enrollment.status === "active") {
      const scope = await readScopeSectionIds(ctx, actor, yearId);
      if (scope.has(enrollment.sectionId)) return student;
    }
  }

  if (perms.own && hasPermission(actor, perms.own)) {
    const linked = await linkedStudentIds(ctx, actor);
    if (linked.includes(student._id)) return student;
  }
  // Same response as "no such student" — do not confirm existence to outsiders.
  throw notFound("Student");
}

/**
 * Subject-teaching gate (marks entry, homework): the actor's teacher record
 * must hold a PERSISTED assignment for this subject in this section. Class
 * teacher ownership alone does not qualify, and neither does teaching another
 * subject in the section.
 */
export async function isSubjectTeacherOf(ctx: QueryCtx, teacherId: Id<"teachers"> | undefined, sectionId: Id<"sections">, subjectId: Id<"subjects">): Promise<boolean> {
  if (!teacherId) return false;
  const rows = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", sectionId).eq("subjectId", subjectId)).collect();
  return rows.some((a) => a.teacherId === teacherId);
}

export async function requireSubjectTeacher(ctx: Ctx, sectionId: Id<"sections">, subjectId: Id<"subjects">, message = "You do not teach this subject in this section."): Promise<Doc<"sections">> {
  const section = await getInSchool(ctx, "sections", sectionId, "Section");
  if (!(await isSubjectTeacherOf(ctx, ctx.actor.teacherId, section._id, subjectId))) throw forbidden(message);
  return section;
}
