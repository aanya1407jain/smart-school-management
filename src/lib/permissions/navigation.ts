import type { UserAccount } from "@/types/core";
import type { ModuleKey } from "@convex/core/modules";
import { CORE, MODULE_MANIFESTS } from "@/modules/registry.generated";
import { hasAnyPermission, hasPermission, homeRouteFor, type Permission } from "./permissions";

/**
 * The user as navigation sees it: role + permission sets decide WHO may open
 * an item; `modules` (the school's enabled modules, from the server session)
 * decides whether the item's module exists for this school at all. Missing
 * `modules` means "not known yet" and hides every module item (fail-closed).
 */
export type NavUser = Pick<UserAccount, "role" | "permissionSets" | "permissions"> & { modules?: readonly ModuleKey[] };

/** True when the item needs no module, or the user's school has it. */
export function moduleAllowed(user: Pick<NavUser, "modules"> | null | undefined, module: ModuleKey | undefined): boolean {
  return !module || !!user?.modules?.includes(module);
}

/** Icons are referenced by name and resolved in the UI layer. */
export type NavIcon =
  | "dashboard" | "students" | "academics" | "teachers" | "attendance" | "fees" | "exams" | "timetable"
  | "homework" | "notices" | "notifications" | "reports" | "settings" | "classes" | "results" | "profile" | "accounts" | "audit" | "remarks";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  anyOf: Permission[];
  /**
   * The page is backed by real (Convex) school records. Live accounts (see
   * session-provider `dataSource`: every account that is not a demo persona)
   * only see these; the other pages still run on demo data.
   */
  live?: true;
  /** The configurable module this page belongs to (convex/core/modules.ts); absent = core page. */
  module?: ModuleKey;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

const ADMIN_NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/admin/dashboard", icon: "dashboard", anyOf: ["reports:read", "fees:manage"], live: true }] },
  {
    label: "People & academics",
    items: [
      { label: "Students", href: "/admin/students", icon: "students", anyOf: ["students:read:all"], module: "students", live: true },
      { label: "Promotions & TC", href: "/admin/promotions", icon: "results", anyOf: ["students:lifecycle"], module: "students", live: true },
      { label: "Academics", href: "/admin/academics", icon: "academics", anyOf: ["academics:manage"], live: true },
      { label: "Teachers & Staff", href: "/admin/teachers", icon: "teachers", anyOf: ["staff:manage"], live: true },
      { label: "Accounts & Import", href: "/admin/accounts", icon: "accounts", anyOf: ["users:manage", "students:write", "staff:manage"], live: true },
      { label: "Staff & Permissions", href: "/admin/permissions", icon: "settings", anyOf: ["users:manage"], live: true },
    ],
  },
  {
    label: "Daily operations",
    items: [
      { label: "Attendance", href: "/admin/attendance", icon: "attendance", anyOf: ["attendance:read:all"], module: "attendance", live: true },
      { label: "Fees", href: "/admin/fees", icon: "fees", anyOf: ["fees:manage"], module: "finance", live: true },
      { label: "Examinations", href: "/admin/examinations", icon: "exams", anyOf: ["exams:manage"], module: "academics", live: true },
      { label: "Timetable", href: "/admin/timetable", icon: "timetable", anyOf: ["timetable:manage"], module: "academics", live: true },
    ],
  },
  {
    label: "Communication & insight",
    items: [
      { label: "Notices & Events", href: "/admin/notices", icon: "notices", anyOf: ["notices:manage"], module: "administration", live: true },
      { label: "Notifications", href: "/admin/notifications", icon: "notifications", anyOf: ["notifications:read"], live: true },
      { label: "Reports", href: "/admin/reports", icon: "reports", anyOf: ["reports:read", "reports:finance"], module: "administration", live: true },
      { label: "Audit log", href: "/admin/audit", icon: "audit", anyOf: ["audit:read"], live: true },
      { label: "Settings", href: "/admin/settings", icon: "settings", anyOf: ["settings:manage"], live: true },
      { label: "Profile", href: "/admin/profile", icon: "profile", anyOf: ["profile:read:own"], live: true },
    ],
  },
];

const TEACHER_NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/teacher/dashboard", icon: "dashboard", anyOf: ["area:teacher"], live: true }] },
  {
    label: "Teaching",
    items: [
      { label: "My Classes", href: "/teacher/classes", icon: "classes", anyOf: ["students:read:assigned"], live: true },
      { label: "Attendance", href: "/teacher/attendance", icon: "attendance", anyOf: ["attendance:read:assigned"], module: "attendance", live: true },
      { label: "Homework", href: "/teacher/homework", icon: "homework", anyOf: ["homework:manage:assigned"], module: "academics", live: true },
      { label: "Examinations", href: "/teacher/examinations", icon: "exams", anyOf: ["marks:enter:assigned"], module: "academics", live: true },
      { label: "Timetable", href: "/teacher/timetable", icon: "timetable", anyOf: ["timetable:read:own"], module: "academics", live: true },
    ],
  },
  {
    label: "Updates",
    items: [
      { label: "Notices", href: "/teacher/notices", icon: "notices", anyOf: ["notices:read"], module: "administration", live: true },
      { label: "Notifications", href: "/teacher/notifications", icon: "notifications", anyOf: ["notifications:read"], live: true },
      { label: "Profile", href: "/teacher/profile", icon: "profile", anyOf: ["profile:read:own"], live: true },
    ],
  },
];

const STUDENT_NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/student/dashboard", icon: "dashboard", anyOf: ["area:student"], live: true }] },
  {
    label: "My school",
    items: [
      { label: "My Attendance", href: "/student/attendance", icon: "attendance", anyOf: ["attendance:read:own"], module: "attendance", live: true },
      { label: "My Timetable", href: "/student/timetable", icon: "timetable", anyOf: ["timetable:read:own"], module: "academics", live: true },
      { label: "My Homework", href: "/student/homework", icon: "homework", anyOf: ["homework:read:own"], module: "academics", live: true },
      { label: "My Results", href: "/student/results", icon: "results", anyOf: ["results:read:own"], module: "academics", live: true },
      { label: "My Fees", href: "/student/fees", icon: "fees", anyOf: ["fees:read:own"], module: "finance", live: true },
    ],
  },
  {
    label: "Updates",
    items: [
      { label: "Notices", href: "/student/notices", icon: "notices", anyOf: ["notices:read"], module: "administration", live: true },
      { label: "Notifications", href: "/student/notifications", icon: "notifications", anyOf: ["notifications:read"], live: true },
      { label: "Profile", href: "/student/profile", icon: "profile", anyOf: ["profile:read:own"], live: true },
    ],
  },
];

export function getNavigationForUser(
  user: NavUser | null | undefined,
  options: { liveOnly?: boolean } = {},
): NavGroup[] {
  if (!user) return [];
  const source = user.role === "admin" ? ADMIN_NAV : user.role === "teacher" ? [...TEACHER_NAV, ...extraDutiesFor(user)] : STUDENT_NAV;
  return source
    .map((g) => ({ ...g, items: g.items.filter((i) => hasAnyPermission(user, i.anyOf) && moduleAllowed(user, i.module) && (!options.liveOnly || i.live)) }))
    .filter((g) => g.items.length > 0);
}

/** Admin-workspace pages that are personal or overview pages, never "extra duties". */
const NOT_DUTIES = new Set(["/admin/dashboard", "/admin/notifications", "/admin/profile"]);

/**
 * A teacher whom the Principal gave school-wide grants (core/grants.ts) gets
 * an "Additional duties" group with the admin-workspace pages those grants
 * open (e.g. Examinations for an exam coordinator). Requires `area:admin`,
 * which the server adds only for such grants.
 */
function extraDutiesFor(user: NavUser): NavGroup[] {
  if (!hasPermission(user, "area:admin")) return [];
  const items = ADMIN_NAV.flatMap((g) => g.items).filter((i) => !NOT_DUTIES.has(i.href));
  return [{ label: "Additional duties", items }];
}

/**
 * Where the user lands: their workspace dashboard, or — for a restricted
 * office login without dashboard access — the first page they can open.
 */
export function landingRouteFor(user: NavUser | null | undefined): string {
  if (!user) return "/login";
  if (user.role === "admin" && !hasAnyPermission(user, ["reports:read", "fees:manage"])) {
    const first = getNavigationForUser(user).flatMap((g) => g.items)[0];
    if (first) return first.href;
  }
  return homeRouteFor(user);
}

/** Base path of the user's workspace, e.g. "/teacher". */
export function workspaceBase(user: Pick<UserAccount, "role"> | null | undefined) {
  return user ? `/${user.role}` : "";
}

/** Title for breadcrumbs from the nav config (falls back to the path segment). */
export function findNavItem(pathname: string, user: NavUser | null | undefined): NavItem | undefined {
  return getNavigationForUser(user)
    .flatMap((g) => g.items)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}

/**
 * Pages reachable by LIVE accounts (school-created, non-demo): the `live` nav
 * items plus the live sub-pages below them. Every other workspace page still
 * runs on the in-browser demo data, so a live account gets an explanation
 * instead (components/layout/app-shell.tsx) — never another school's demo data.
 */
const LIVE_EXTRA_ROUTES: RegExp[] = [
  /^\/teacher\/students\/[^/]+$/,
  /^\/(admin|teacher|student)$/, // workspace root redirects
];

export function isLiveRoute(pathname: string): boolean {
  const navs = [ADMIN_NAV, TEACHER_NAV, STUDENT_NAV];
  for (const groups of navs) {
    for (const g of groups) {
      for (const i of g.items) {
        if (i.live && (pathname === i.href || pathname.startsWith(`${i.href}/`))) return true;
      }
    }
  }
  return LIVE_EXTRA_ROUTES.some((r) => r.test(pathname));
}

/** The live pages a live account can open, in navigation order (for the "not connected yet" screen). */
export function liveNavItems(user: NavUser | null | undefined): NavItem[] {
  return getNavigationForUser(user, { liveOnly: true }).flatMap((g) => g.items);
}