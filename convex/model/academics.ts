/**
 * Academic-structure read helpers shared by modules.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
export const teacherDisplayName = (t: Doc<"teachers">) => [t.title, t.firstName, t.lastName].filter(Boolean).join(" ");

/** Students actively enrolled in a section, ordered by roll number then name. */
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
  rows.sort((a, b) => (a.enrollment.rollNo ?? 1e9) - (b.enrollment.rollNo ?? 1e9) || fullName(a.student).localeCompare(fullName(b.student)));
  return rows;
}

export async function classTeacherOf(ctx: QueryCtx, section: Doc<"sections">): Promise<Doc<"teachers"> | null> {
  if (!section.classTeacherId) return null;
  const t = await ctx.db.get(section.classTeacherId);
  return t && t.schoolId === section.schoolId ? t : null;
}
