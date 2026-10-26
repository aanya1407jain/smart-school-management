/**
 * Academic-structure read helpers shared by modules.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { compareRosterEntries } from "./rollNumbers";

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
export const teacherDisplayName = (t: Doc<"teachers">) => [t.title, t.firstName, t.lastName].filter(Boolean).join(" ");

/**
 * Students actively enrolled in a section, in the documented alphabetical order
 * (model/rollNumbers.ts compareRosterEntries: first name, last name — case-,
 * accent- and whitespace-insensitive — then student id, then enrollment id).
 *
 * The order does NOT depend on the stored `rollNo`: legacy rosters whose numbers
 * predate alphabetical renumbering still list alphabetically. Each row keeps its
 * STORED roll number for display; stale numbers are corrected only by the
 * explicit reconciliation (convex/rollNumberMaintenance.ts) or the next roster
 * change of that section.
 */
export async function activeRoster(ctx: QueryCtx, sectionId: Id<"sections">) {
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active"))
    .collect();
  const rows: { enrollment: Doc<"enrollments">; student: Doc<"students"> }[] = [];
  for (const enrollment of enrollments) {
    const student = await ctx.db.get(enrollment.studentId);
    if (student && student.schoolId === enrollment.schoolId) rows.push({ enrollment, student });
  }
  rows.sort((a, b) => compareRosterEntries(
    { enrollmentId: a.enrollment._id, studentId: a.student._id, firstName: a.student.firstName, lastName: a.student.lastName },
    { enrollmentId: b.enrollment._id, studentId: b.student._id, firstName: b.student.firstName, lastName: b.student.lastName },
  ));
  return rows;
}

export async function classTeacherOf(ctx: QueryCtx, section: Doc<"sections">): Promise<Doc<"teachers"> | null> {
  if (!section.classTeacherId) return null;
  const t = await ctx.db.get(section.classTeacherId);
  return t && t.schoolId === section.schoolId ? t : null;
}

/** True when the subject is in the class curriculum for the year (classSubjects). */
export async function subjectInCurriculum(ctx: QueryCtx, classId: Id<"classes">, academicYearId: Id<"academicYears">, subjectId: Id<"subjects">): Promise<boolean> {
  const row = await ctx.db
    .query("classSubjects")
    .withIndex("by_class_year_subject", (q) => q.eq("classId", classId).eq("academicYearId", academicYearId).eq("subjectId", subjectId))
    .first();
  return !!row;
}
