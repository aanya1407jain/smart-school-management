/**
 * Live (Convex-only) student portal identity — pure, no browser or demo-data
 * dependencies, so it can be unit-tested.
 */
import type { Viewer } from "@convex/users";
import type { CurrentUser } from "@/lib/services/auth.service";

/**
 * The portal user for a student-portal membership that has no demo-data
 * counterpart. Everything comes from the server-derived viewer: the role,
 * permission sets and the linked students (Convex student ids). Nothing is
 * read from, or written to, the demo data.
 */
export function liveStudentPortalUser(viewer: Pick<Viewer, "membershipId" | "loginId" | "email" | "role" | "displayName" | "permissionSets" | "students" | "guardian">): CurrentUser {
  return {
    id: viewer.membershipId,
    loginId: viewer.loginId ?? undefined,
    email: viewer.email ?? "",
    role: viewer.role,
    displayName: viewer.displayName,
    phone: "",
    studentIds: viewer.students.map((s) => s.studentId),
    ...(viewer.guardian ? { guardianId: viewer.guardian.guardianId } : {}),
    permissionSets: [...viewer.permissionSets],
  };
}
