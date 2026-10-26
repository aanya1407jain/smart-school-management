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
// Per-member grants (the Principal's module x action controls) - shared contract for every portal.
export { ACTIONS, ACTION_LABELS, CAPABILITIES, GRANT_PRESETS, PRINCIPAL_ONLY } from "@convex/core/grants";
export type { Action, Grant } from "@convex/core/grants";

type PermissionUser = Pick<UserAccount, "role" | "permissionSets" | "permissions">;

/**
 * The user's permissions: the SERVER-computed set when the session provided it
 * (it includes the Principal's per-member grants), else the role's own set.
 */
export function permissionsFor(user: PermissionUser | null | undefined): Set<Permission> {
  if (!user) return new Set();
  if (Array.isArray(user.permissions)) return new Set(user.permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)));
  return resolvePermissions(user.role, user.permissionSets ?? []);
}

export function hasPermission(user: PermissionUser | null | undefined, permission: Permission): boolean {
  return permissionsFor(user).has(permission);
}

export function hasAnyPermission(user: PermissionUser | null | undefined, permissions: Permission[]): boolean {
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
