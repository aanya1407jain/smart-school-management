/**
 * Who may READ a homework item (and its attachments):
 *   - `homework:read:all` (admin)
 *   - the teacher who set it, or any teacher linked to the section that year
 *   - a student whose enrollment in that year is in the section
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { Actor } from "../core/actor";
import { enrollmentFor, hasPermission, linkedStudentIds, teacherSectionIds } from "../core/authorization";

export async function canReadHomework(ctx: QueryCtx & { actor: Actor }, hw: Doc<"homework">): Promise<boolean> {
  const { actor } = ctx;
  if (hw.schoolId !== actor.schoolId) return false;
  if (hasPermission(actor, "homework:read:all")) return true;
  if (actor.teacherId) {
    if (hw.teacherId === actor.teacherId) return true;
    const scope = await teacherSectionIds(ctx, actor.teacherId, hw.academicYearId);
    if (scope.has(hw.sectionId)) return true;
  }
  if (hasPermission(actor, "homework:read:own")) {
    for (const studentId of await linkedStudentIds(ctx, actor)) {
      const e = await enrollmentFor(ctx, studentId, hw.academicYearId);
      if (e && e.sectionId === hw.sectionId) return true;
    }
  }
  return false;
}
