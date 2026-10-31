/**
 * Live (Convex-only) student portal identity — pure, no browser or demo-data
 * dependencies, so it can be unit-tested.
 */
import type { Viewer } from "@convex/users";
import type { UserAccount as CurrentUser } from "@/types/core";

/**
 * The portal user for a student-portal membership that has no demo-data
 * counterpart. Everything comes from the server-derived viewer: the role,
 * permission sets and the linked students (Convex student ids). Nothing is
 * read from, or written to, the demo data.
 */
export function liveStudentPortalUser(viewer: Pick<Viewer, "membershipId" | "loginId" | "email" | "role" | "displayName" | "permissionSets" | "students">): CurrentUser {
  return {
    id: viewer.membershipId,
    loginId: viewer.loginId ?? undefined,
    email: viewer.email ?? "",
    role: viewer.role,
    displayName: viewer.displayName,
    phone: "",
    studentIds: viewer.students.map((s) => s.studentId),
    permissionSets: [...viewer.permissionSets],
  };
}

/**
 * The workspace user for an ADMIN or TEACHER membership that has no demo-data
 * counterpart (any school-created staff account). Role, permission sets and
 * the teacher link come only from the server-derived viewer; nothing is read
 * from, or written to, the demo data. Such sessions use the live workspace:
 * only pages backed by Convex records are reachable (see
 * src/lib/permissions/navigation.ts `isLiveRoute`); the rest explain that they
 * are not connected yet instead of showing demo data.
 */
export function liveStaffUser(viewer: Pick<Viewer, "membershipId" | "loginId" | "email" | "role" | "displayName" | "permissionSets" | "teacher">): CurrentUser {
  if (viewer.role !== "admin" && viewer.role !== "teacher") throw new Error("liveStaffUser: not a staff membership");
  return {
    id: viewer.membershipId,
    loginId: viewer.loginId ?? undefined,
    email: viewer.email ?? "",
    role: viewer.role,
    displayName: viewer.displayName,
    phone: "",
    ...(viewer.teacher ? { teacherId: viewer.teacher.teacherId } : {}),
    permissionSets: [...viewer.permissionSets],
  };
}

/**
 * The live (Convex-only) workspace user for any membership the demo data does
 * not know. Every role has a live workspace now; the role is the SERVER's.
 */
export function liveWorkspaceUser(viewer: Pick<Viewer, "membershipId" | "loginId" | "email" | "role" | "displayName" | "permissionSets" | "students" | "teacher">): CurrentUser {
  return viewer.role === "student" ? liveStudentPortalUser(viewer) : liveStaffUser(viewer);
}
