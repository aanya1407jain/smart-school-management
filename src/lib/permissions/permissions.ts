/**
 * Frontend view of the centralised permission model.
 *
 * The catalogue itself (permissions, role → permission map, optional sets
 * such as "accountant") lives in `convex/core/permissions.ts` and is shared
 * with the Convex backend, which enforces it server-side. This file only adds
 * UI helpers. Never declare permissions here.
 */
import type { UserAccount } from "@/types/domain";
import { PERMISSIONS, PERMISSION_SETS, ROLE_LABELS, ROLE_PERMISSIONS, resolvePermissions, type Permission } from "@convex/core/permissions";

export { PERMISSIONS, PERMISSION_SETS, ROLE_LABELS, ROLE_PERMISSIONS };
export type { Permission };

export function permissionsFor(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined): Set<Permission> {
  if (!user) return new Set();
  return resolvePermissions(user.role, user.permissionSets ?? []);
}

export function hasPermission(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined, permission: Permission): boolean {
  return permissionsFor(user).has(permission);
}

export function hasAnyPermission(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined, permissions: Permission[]): boolean {
  const set = permissionsFor(user);
  return permissions.some((p) => set.has(p));
}

/** Where a signed-in user lands after login. */
export function homeRouteFor(user: Pick<UserAccount, "role"> | null | undefined): string {
  switch (user?.role) {
    case "admin": return "/admin/dashboard";
    case "teacher": return "/teacher/dashboard";
    case "student": return "/student/dashboard";
    default: return "/login";
  }
}
