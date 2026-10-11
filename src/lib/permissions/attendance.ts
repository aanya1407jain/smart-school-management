/**
 * Attendance ownership — the single source of truth for who may MARK or EDIT
 * student attendance.
 *
 *   attendance record → section → section.classTeacherId → user.teacherId
 *
 * Only the teacher who is the CLASS TEACHER of a section may mark (create) or
 * edit (correct) that section's attendance. A subject assignment, timetable
 * slot or access to the students is NOT enough. Admins and students/guardians
 * are view-only. The mock services call these functions before every write,
 * and the UI only shows controls when the service reports `canMark/canEdit`.
 *
 * Stage 2: the same checks must run server-side inside the Convex mutations.
 */
import type { Section, UserAccount } from "@/types/domain";
import { hasPermission } from "./permissions";

type Actor = Pick<UserAccount, "role" | "permissionSets" | "teacherId"> | null | undefined;
type SectionRef = Pick<Section, "classTeacherId">;

export type AttendanceAction = "view" | "mark" | "edit";

/** True when the actor is the class teacher of the section. */
export function isClassTeacherOf(actor: Actor, section: SectionRef | null | undefined): boolean {
  return !!actor?.teacherId && !!section?.classTeacherId && section.classTeacherId === actor.teacherId;
}

/** Create a register for a date that has none yet. */
export function canMarkAttendance(actor: Actor, section: SectionRef | null | undefined): boolean {
  return hasPermission(actor, "attendance:mark:class_teacher") && isClassTeacherOf(actor, section);
}

/** Correct an existing register. */
export function canEditAttendance(actor: Actor, section: SectionRef | null | undefined): boolean {
  return hasPermission(actor, "attendance:edit:class_teacher") && isClassTeacherOf(actor, section);
}

/** Any attendance view permission (scope is checked separately by the service). */
export function canViewAttendance(actor: Actor): boolean {
  return hasPermission(actor, "attendance:read:all") || hasPermission(actor, "attendance:read:assigned") || hasPermission(actor, "attendance:read:own");
}

/** Human-readable reason shown in read-only states. */
export function attendanceReadOnlyReason(actor: Actor, classTeacherName: string | null, sectionLabel: string): string {
  if (actor?.role === "admin") return `Attendance for Class ${sectionLabel} is marked by its class teacher${classTeacherName ? ` (${classTeacherName})` : ""}. Administrators can view and monitor attendance but cannot mark or edit it.`;
  if (actor?.role === "student") return "Attendance is view-only in the student portal.";
  return `Only the class teacher of ${sectionLabel}${classTeacherName ? ` (${classTeacherName})` : ""} can mark or edit its attendance. You can view it because you teach this class.`;
}
