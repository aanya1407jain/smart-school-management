import type { UserAccount } from "@/types/domain";
import { hasAnyPermission, hasPermission, type Permission } from "./permissions";

/**
 * Route → permission rules. The first matching rule wins.
 * Every protected route MUST be covered by a rule; unknown routes inside a
 * workspace fall back to the workspace's area permission.
 */
interface RouteRule {
  pattern: RegExp;
  anyOf: Permission[];
}

const r = (path: string) => new RegExp(`^${path}(?:/.*)?$`);

export const ROUTE_RULES: RouteRule[] = [
  // Admin workspace
  { pattern: r("/admin/dashboard"), anyOf: ["reports:read", "fees:manage"] },
  { pattern: r("/admin/students"), anyOf: ["students:read:all"] },
  { pattern: r("/admin/academics"), anyOf: ["academics:manage"] },
  { pattern: r("/admin/teachers"), anyOf: ["staff:manage"] },
  { pattern: r("/admin/accounts"), anyOf: ["users:manage", "students:write", "staff:manage"] },
  { pattern: r("/admin/attendance"), anyOf: ["attendance:read:all"] },
  { pattern: r("/admin/fees"), anyOf: ["fees:manage"] },
  { pattern: r("/admin/examinations"), anyOf: ["exams:manage"] },
  { pattern: r("/admin/timetable"), anyOf: ["timetable:manage"] },
  { pattern: r("/admin/homework"), anyOf: ["homework:read:all"] },
  { pattern: r("/admin/notices"), anyOf: ["notices:manage"] },
  { pattern: r("/admin/notifications"), anyOf: ["notifications:read"] },
  { pattern: r("/admin/reports"), anyOf: ["reports:read", "reports:finance"] },
  { pattern: r("/admin/settings"), anyOf: ["settings:manage"] },
  { pattern: r("/admin/profile"), anyOf: ["profile:read:own"] },
  // Teacher workspace
  { pattern: r("/teacher/dashboard"), anyOf: ["area:teacher"] },
  { pattern: r("/teacher/classes"), anyOf: ["students:read:assigned"] },
  { pattern: r("/teacher/students"), anyOf: ["students:read:assigned"] },
  { pattern: r("/teacher/attendance"), anyOf: ["attendance:read:assigned"] },
  { pattern: r("/teacher/homework"), anyOf: ["homework:manage:assigned"] },
  { pattern: r("/teacher/examinations"), anyOf: ["marks:enter:assigned"] },
  { pattern: r("/teacher/timetable"), anyOf: ["timetable:read:own"] },
  { pattern: r("/teacher/notices"), anyOf: ["notices:read"] },
  { pattern: r("/teacher/notifications"), anyOf: ["notifications:read"] },
  { pattern: r("/teacher/profile"), anyOf: ["profile:read:own"] },
  // Student portal
  { pattern: r("/student/dashboard"), anyOf: ["area:student"] },
  { pattern: r("/student/attendance"), anyOf: ["attendance:read:own"] },
  { pattern: r("/student/timetable"), anyOf: ["timetable:read:own"] },
  { pattern: r("/student/homework"), anyOf: ["homework:read:own"] },
  { pattern: r("/student/results"), anyOf: ["results:read:own"] },
  { pattern: r("/student/fees"), anyOf: ["fees:read:own"] },
  { pattern: r("/student/notices"), anyOf: ["notices:read"] },
  { pattern: r("/student/notifications"), anyOf: ["notifications:read"] },
  { pattern: r("/student/profile"), anyOf: ["profile:read:own"] },
];

const AREA_RULES: { prefix: string; permission: Permission }[] = [
  { prefix: "/admin", permission: "area:admin" },
  { prefix: "/teacher", permission: "area:teacher" },
  { prefix: "/student", permission: "area:student" },
];

export type RouteAccess = "allowed" | "unauthenticated" | "forbidden";

export function isProtectedRoute(pathname: string) {
  return AREA_RULES.some((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
}

export function canAccessRoute(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined, pathname: string): RouteAccess {
  if (!isProtectedRoute(pathname)) return "allowed";
  if (!user) return "unauthenticated";
  const area = AREA_RULES.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`))!;
  if (!hasPermission(user, area.permission)) return "forbidden";
  const rule = ROUTE_RULES.find((rule) => rule.pattern.test(pathname));
  if (rule && !hasAnyPermission(user, rule.anyOf)) return "forbidden";
  return "allowed";
}
