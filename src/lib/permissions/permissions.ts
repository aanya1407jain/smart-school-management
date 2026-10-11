/**
 * Centralised permission model.
 *
 * Roles map to permission sets. Additional sets (e.g. a future "accountant"
 * set for office staff) can be layered onto an account via
 * `UserAccount.permissionSets` without touching any component.
 *
 * IMPORTANT: this is frontend authorization only. When the backend is added,
 * the same rules must be enforced server-side (e.g. inside Convex functions).
 */
import type { Role, UserAccount } from "@/types/domain";

export const PERMISSIONS = [
  // Workspace areas
  "area:admin", "area:teacher", "area:student",
  // Students
  "students:read:all", "students:write", "students:read:assigned",
  // Academics & staff
  "academics:manage", "staff:manage",
  // Attendance — VIEW is separate from MARK (create) and EDIT (correct).
  // Mark/edit are capabilities that ALSO require class-teacher ownership of the
  // section (see ./attendance.ts). There is deliberately no attendance:delete.
  "attendance:read:all", "attendance:read:assigned", "attendance:read:own",
  "attendance:mark:class_teacher", "attendance:edit:class_teacher",
  // Fees
  "fees:manage", "fees:read:own",
  // Examinations
  "exams:manage", "exams:publish", "marks:enter:any", "marks:enter:assigned", "exams:read:assigned", "results:read:own",
  // Timetable
  "timetable:manage", "timetable:read:own",
  // Homework
  "homework:read:all", "homework:manage:assigned", "homework:read:own", "homework:submit",
  // Notices & notifications
  "notices:manage", "notices:read", "notifications:read",
  // Reports, settings, profile
  "reports:read", "reports:finance", "settings:manage", "profile:read:own",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Admin: everything administrative, but attendance is VIEW-ONLY
 * (attendance:read:all). Marking/editing student attendance belongs to the
 * class teacher of each section, not to "full admin access".
 */
const ADMIN: Permission[] = PERMISSIONS.filter((p) => !p.startsWith("area:") || p === "area:admin").filter(
  (p) => !["students:read:assigned", "attendance:read:assigned", "attendance:mark:class_teacher", "attendance:edit:class_teacher", "attendance:read:own", "fees:read:own", "marks:enter:assigned", "exams:read:assigned", "results:read:own", "timetable:read:own", "homework:manage:assigned", "homework:read:own", "homework:submit"].includes(p),
);

const TEACHER: Permission[] = [
  "area:teacher", "students:read:assigned", "attendance:read:assigned", "attendance:mark:class_teacher", "attendance:edit:class_teacher",
  "marks:enter:assigned", "exams:read:assigned",
  "timetable:read:own", "homework:manage:assigned", "notices:read", "notifications:read", "profile:read:own",
];

const STUDENT: Permission[] = [
  "area:student", "attendance:read:own", "timetable:read:own", "homework:read:own", "homework:submit",
  "results:read:own", "fees:read:own", "notices:read", "notifications:read", "profile:read:own",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(ADMIN),
  teacher: new Set(TEACHER),
  student: new Set(STUDENT),
};

/**
 * Optional permission sets that can be granted on top of (or instead of) a
 * full role. Not assigned to any demo account yet — ready for Stage 2.
 */
export const PERMISSION_SETS: Record<string, Permission[]> = {
  accountant: ["area:admin", "fees:manage", "reports:finance", "students:read:all", "notifications:read", "profile:read:own"],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  teacher: "Teacher",
  student: "Student",
};

export function permissionsFor(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined): Set<Permission> {
  if (!user) return new Set();
  const set = new Set<Permission>(ROLE_PERMISSIONS[user.role]);
  for (const name of user.permissionSets ?? []) PERMISSION_SETS[name]?.forEach((p) => set.add(p));
  return set;
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
