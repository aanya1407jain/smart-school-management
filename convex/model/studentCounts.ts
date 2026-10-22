/**
 * THE student-count rule, shared by every screen that shows a student total
 * (Students page, admin dashboard, reports), so the numbers always agree with
 * each other AND with the Students list (accounts.listPeople):
 *
 *   enrolled (this year) = DISTINCT students of the school whose student record
 *                          is ACTIVE and who have an ACTIVE enrollment in the
 *                          CURRENT academic year. A stray duplicate enrollment
 *                          never counts a student twice; a record marked
 *                          inactive / alumni / transferred is never counted even
 *                          if an enrollment was left open; memberships/accounts
 *                          play no part.
 *   in a section         = the same, restricted to active enrollments in that
 *                          section (a student is counted once per section).
 *   active records       = student records of the school with status "active"
 *                          (includes admitted students not yet placed in a class).
 *   not enrolled         = active records without an active enrollment this year.
 *
 * Everything is read through indexes scoped to the caller's school; another
 * school's students can never be counted. Bounded: above MAX_COUNTED_STUDENTS
 * the caller gets CONFLICT rather than a silently truncated number.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { conflict } from "../core/errors";

export const MAX_COUNTED_STUDENTS = 5000;

/** Ids of the school's student records with status "active". */
export async function activeStudentRecordIds(ctx: QueryCtx, schoolId: Id<"schools">) {
  const rows = await ctx.db
    .query("students")
    .withIndex("by_school_status_name", (q) => q.eq("schoolId", schoolId).eq("status", "active"))
    .take(MAX_COUNTED_STUDENTS + 1);
  if (rows.length > MAX_COUNTED_STUDENTS) throw conflict(`More than ${MAX_COUNTED_STUDENTS} active students to count; this school needs paginated reporting.`);
  return new Set(rows.map((s) => s._id));
}

/**
 * Distinct ACTIVE students with an active enrollment in the year, each with the
 * set of sections they are actively enrolled in (normally exactly one).
 * Pass `active` when the caller already loaded activeStudentRecordIds.
 */
export async function enrolledStudents(
  ctx: QueryCtx,
  schoolId: Id<"schools">,
  academicYearId: Id<"academicYears">,
  active?: Set<Id<"students">>,
) {
  const activeIds = active ?? (await activeStudentRecordIds(ctx, schoolId));
  const rows = await ctx.db
    .query("enrollments")
    .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId))
    .take(MAX_COUNTED_STUDENTS * 2 + 1);
  if (rows.length > MAX_COUNTED_STUDENTS * 2) throw conflict(`More than ${MAX_COUNTED_STUDENTS} students to count; this school needs paginated reporting.`);
  const sectionsOf = new Map<Id<"students">, Set<Id<"sections">>>();
  for (const e of rows) {
    if (e.status !== "active" || e.schoolId !== schoolId || !activeIds.has(e.studentId)) continue;
    const set = sectionsOf.get(e.studentId) ?? new Set<Id<"sections">>();
    set.add(e.sectionId); // a student is counted once, however many rows
    sectionsOf.set(e.studentId, set);
  }
  return sectionsOf;
}

/** Distinct enrolled students in one section (same rule as enrolledStudents). */
export function enrolledInSection(enrolled: Map<Id<"students">, Set<Id<"sections">>>, sectionId: Id<"sections">) {
  let n = 0;
  for (const sections of enrolled.values()) if (sections.has(sectionId)) n++;
  return n;
}
