/**
 * Permission catalogue — the SINGLE source of truth for RBAC.
 *
 * Imported by Convex functions (server-side enforcement) AND by the Next.js
 * frontend (`src/lib/permissions/permissions.ts` re-exports it for navigation,
 * route guards and showing/hiding controls). Never define a second list.
 *
 * Pure TypeScript: no Convex or React imports, so it is safe on both sides.
 *
 * Roles are portal roles (which dashboard a member uses). A guardian is NOT a
 * role: a guardian is a `student`-role membership linked to a guardian record
 * and scoped to the students linked through `guardianLinks`.
 * Optional permission sets (e.g. "accountant") are layered on a membership.
 */

export const ROLES = ["admin", "teacher", "student"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Workspace areas
  "area:admin", "area:teacher", "area:student",
  // Students
  "students:read:all", "students:write", "students:read:assigned",
  // Academics & staff
  "academics:manage", "staff:manage",
  // Attendance — VIEW is separate from MARK (create) and EDIT (correct).
  // Mark/edit ALSO require class-teacher ownership of the section
  // (see convex/core/authorization.ts → requireClassTeacher).
  // There is deliberately no attendance:delete.
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
  // Platform administration within a school
  "users:manage", "audit:read", "files:upload",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that only make sense for a specific person's own scope. */
const SCOPED_TO_SELF_OR_ASSIGNED: Permission[] = [
  "students:read:assigned", "attendance:read:assigned", "attendance:mark:class_teacher", "attendance:edit:class_teacher",
  "attendance:read:own", "fees:read:own", "marks:enter:assigned", "exams:read:assigned", "results:read:own",
  "timetable:read:own", "homework:manage:assigned", "homework:read:own", "homework:submit",
];

/**
 * Admin / Principal: school-wide administration. Attendance is VIEW-ONLY
 * (attendance:read:all) — "full school administration" does not mean the admin
 * performs every operational action. Marking belongs to class teachers.
 */
const ADMIN: Permission[] = PERMISSIONS.filter((p) => !p.startsWith("area:") || p === "area:admin").filter(
  (p) => !SCOPED_TO_SELF_OR_ASSIGNED.includes(p),
);

const TEACHER: Permission[] = [
  "area:teacher", "students:read:assigned", "attendance:read:assigned", "attendance:mark:class_teacher", "attendance:edit:class_teacher",
  "marks:enter:assigned", "exams:read:assigned",
  "timetable:read:own", "homework:manage:assigned", "notices:read", "notifications:read", "profile:read:own", "files:upload",
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
 * Optional sets layered on a membership (`schoolMemberships.permissionSets`).
 * "accountant" is restricted finance access — not a role, no separate portal.
 */
export const PERMISSION_SETS = {
  accountant: ["area:admin", "fees:manage", "reports:finance", "students:read:all", "notifications:read", "profile:read:own"],
} as const satisfies Record<string, readonly Permission[]>;

export type PermissionSetName = keyof typeof PERMISSION_SETS;
export const PERMISSION_SET_NAMES = Object.keys(PERMISSION_SETS) as PermissionSetName[];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  teacher: "Teacher",
  student: "Student",
};

/**
 * Resolve the effective permission set for a role + optional sets.
 *
 * RESTRICTED ADMIN: an ADMIN membership carrying the "accountant" set gets
 * EXACTLY the accountant permissions (finance only) — not the full admin set.
 * This is how a school gives its accountant an office login without a new
 * primary role. On any other role a set is additive (legacy; not creatable
 * through the API).
 */
export function resolvePermissions(role: Role | null | undefined, permissionSets: readonly string[] = []): Set<Permission> {
  if (role === "admin" && permissionSets.includes("accountant")) return new Set<Permission>(PERMISSION_SETS.accountant);
  const set = new Set<Permission>(role ? ROLE_PERMISSIONS[role] : []);
  for (const name of permissionSets) {
    const extra = (PERMISSION_SETS as Record<string, readonly Permission[]>)[name];
    extra?.forEach((p) => set.add(p));
  }
  return set;
}

/** True when an admin membership is restricted to the accountant (finance-only) permissions. */
export function isAccountantOnly(role: Role | null | undefined, permissionSets: readonly string[] = []): boolean {
  return role === "admin" && permissionSets.includes("accountant");
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
