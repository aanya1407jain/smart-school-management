import type { ModuleKey } from "@convex/core/modules";
import { hasAnyPermission, hasPermission, type Permission } from "./permissions";
import { moduleAllowed, type NavUser } from "./navigation";

/**
 * Route → permission rules. The first matching rule wins.
 * Every protected route MUST be covered by a rule; unknown routes inside a
 * workspace fall back to the workspace's area permission.
 */
interface RouteRule {
  pattern: RegExp;
  anyOf: Permission[];
  /** The module the page belongs to; the school must have it enabled (convex/core/modules.ts). */
  module?: ModuleKey;
}

const r = (path: string) => new RegExp(`^${path}(?:/.*)?$`);

export const ROUTE_RULES: RouteRule[] = [
  // Admin workspace
  { pattern: r("/admin/dashboard"), anyOf: ["reports:read", "fees:manage"] },
  { pattern: r("/admin/students"), anyOf: ["students:read:all"], module: "students" },
  { pattern: r("/admin/promotions"), anyOf: ["students:lifecycle"], module: "students" },
  { pattern: r("/admin/permissions"), anyOf: ["users:manage"] },
  { pattern: r("/admin/academics"), anyOf: ["academics:manage"] },
  { pattern: r("/admin/teachers"), anyOf: ["staff:manage"] },
  { pattern: r("/admin/accounts"), anyOf: ["users:manage", "students:write", "staff:manage"] },
  { pattern: r("/admin/attendance"), anyOf: ["attendance:read:all"], module: "attendance" },
  { pattern: r("/admin/fees"), anyOf: ["fees:manage"], module: "finance" },
  { pattern: r("/admin/examinations"), anyOf: ["exams:manage"], module: "academics" },
  { pattern: r("/admin/timetable"), anyOf: ["timetable:manage"], module: "academics" },
  { pattern: r("/admin/notices"), anyOf: ["notices:manage"], module: "administration" },
  { pattern: r("/admin/notifications"), anyOf: ["notifications:read"] },
  { pattern: r("/admin/reports"), anyOf: ["reports:read", "reports:finance"], module: "administration" },
  { pattern: r("/admin/settings"), anyOf: ["settings:manage"] },
  { pattern: r("/admin/audit"), anyOf: ["audit:read"] },
  { pattern: r("/admin/profile"), anyOf: ["profile:read:own"] },
  // Teacher workspace
  { pattern: r("/teacher/dashboard"), anyOf: ["area:teacher"] },
  { pattern: r("/teacher/classes"), anyOf: ["students:read:assigned"] },
  { pattern: r("/teacher/students"), anyOf: ["students:read:assigned"] },
  { pattern: r("/teacher/attendance"), anyOf: ["attendance:read:assigned"], module: "attendance" },
  { pattern: r("/teacher/homework"), anyOf: ["homework:manage:assigned"], module: "academics" },
  { pattern: r("/teacher/examinations"), anyOf: ["marks:enter:assigned"], module: "academics" },
  { pattern: r("/teacher/timetable"), anyOf: ["timetable:read:own"], module: "academics" },
  { pattern: r("/teacher/notices"), anyOf: ["notices:read"], module: "administration" },
  { pattern: r("/teacher/notifications"), anyOf: ["notifications:read"] },
  { pattern: r("/teacher/profile"), anyOf: ["profile:read:own"] },
  // Student portal
  { pattern: r("/student/dashboard"), anyOf: ["area:student"] },
  { pattern: r("/student/attendance"), anyOf: ["attendance:read:own"], module: "attendance" },
  { pattern: r("/student/timetable"), anyOf: ["timetable:read:own"], module: "academics" },
  { pattern: r("/student/homework"), anyOf: ["homework:read:own"], module: "academics" },
  { pattern: r("/student/results"), anyOf: ["results:read:own"], module: "academics" },
  { pattern: r("/student/fees"), anyOf: ["fees:read:own"], module: "finance" },
  { pattern: r("/student/notices"), anyOf: ["notices:read"], module: "administration" },
  { pattern: r("/student/notifications"), anyOf: ["notifications:read"] },
  { pattern: r("/student/profile"), anyOf: ["profile:read:own"] },
];

const AREA_RULES: { prefix: string; permission: Permission }[] = [
  { prefix: "/admin", permission: "area:admin" },
  { prefix: "/teacher", permission: "area:teacher" },
  { prefix: "/student", permission: "area:student" },
];

/**
 * "module_disabled": the user may use this kind of page, but their SCHOOL does
 * not have the module. The page is not rendered (so none of its queries run);
 * the server would refuse its functions with MODULE_DISABLED anyway.
 */
export type RouteAccess = "allowed" | "unauthenticated" | "forbidden" | "module_disabled";

/** The rule that covers a path (for messages such as which module is off). */
export function routeRuleFor(pathname: string): RouteRule | undefined {
  return ROUTE_RULES.find((rule) => rule.pattern.test(pathname));
}

export function isProtectedRoute(pathname: string) {
  return AREA_RULES.some((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
}

export function canAccessRoute(user: NavUser | null | undefined, pathname: string): RouteAccess {
  if (!isProtectedRoute(pathname)) return "allowed";
  if (!user) return "unauthenticated";
  const area = AREA_RULES.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`))!;
  if (!hasPermission(user, area.permission)) return "forbidden";
  const rule = ROUTE_RULES.find((rule) => rule.pattern.test(pathname));
  if (rule && !hasAnyPermission(user, rule.anyOf)) return "forbidden";
  if (rule && !moduleAllowed(user, rule.module)) return "module_disabled";
  return "allowed";
}
