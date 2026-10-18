import type { UserAccount } from "@/types/domain";
import { hasAnyPermission, type Permission } from "./permissions";

/**
 * Navigation is derived from permissions, never hard-coded per page.
 * Icons are referenced by name and resolved in the UI layer.
 */
export type NavIcon =
  | "dashboard" | "students" | "academics" | "teachers" | "attendance" | "fees" | "exams" | "timetable"
  | "homework" | "notices" | "notifications" | "reports" | "settings" | "classes" | "results" | "profile" | "accounts" | "audit";

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
      { label: "Students", href: "/admin/students", icon: "students", anyOf: ["students:read:all"], live: true },
      { label: "Academics", href: "/admin/academics", icon: "academics", anyOf: ["academics:manage"], live: true },
      { label: "Teachers & Staff", href: "/admin/teachers", icon: "teachers", anyOf: ["staff:manage"], live: true },
      { label: "Accounts & Import", href: "/admin/accounts", icon: "accounts", anyOf: ["users:manage", "students:write", "staff:manage"], live: true },
    ],
  },
  {
    label: "Daily operations",
    items: [
      { label: "Attendance", href: "/admin/attendance", icon: "attendance", anyOf: ["attendance:read:all"], live: true },
      { label: "Fees", href: "/admin/fees", icon: "fees", anyOf: ["fees:manage"], live: true },
      { label: "Examinations", href: "/admin/examinations", icon: "exams", anyOf: ["exams:manage"], live: true },
      { label: "Timetable", href: "/admin/timetable", icon: "timetable", anyOf: ["timetable:manage"], live: true },
      { label: "Homework", href: "/admin/homework", icon: "homework", anyOf: ["homework:read:all"], live: true },
    ],
  },
  {
    label: "Communication & insight",
    items: [
      { label: "Notices & Events", href: "/admin/notices", icon: "notices", anyOf: ["notices:manage"], live: true },
      { label: "Notifications", href: "/admin/notifications", icon: "notifications", anyOf: ["notifications:read"], live: true },
      { label: "Reports", href: "/admin/reports", icon: "reports", anyOf: ["reports:read", "reports:finance"], live: true },
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
      { label: "Attendance", href: "/teacher/attendance", icon: "attendance", anyOf: ["attendance:read:assigned"], live: true },
      { label: "Homework", href: "/teacher/homework", icon: "homework", anyOf: ["homework:manage:assigned"], live: true },
      { label: "Examinations", href: "/teacher/examinations", icon: "exams", anyOf: ["marks:enter:assigned"], live: true },
      { label: "Timetable", href: "/teacher/timetable", icon: "timetable", anyOf: ["timetable:read:own"], live: true },
    ],
  },
  {
    label: "Updates",
    items: [
      { label: "Notices", href: "/teacher/notices", icon: "notices", anyOf: ["notices:read"], live: true },
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
      { label: "My Attendance", href: "/student/attendance", icon: "attendance", anyOf: ["attendance:read:own"], live: true },
      { label: "My Timetable", href: "/student/timetable", icon: "timetable", anyOf: ["timetable:read:own"], live: true },
      { label: "My Homework", href: "/student/homework", icon: "homework", anyOf: ["homework:read:own"], live: true },
      { label: "My Results", href: "/student/results", icon: "results", anyOf: ["results:read:own"], live: true },
      { label: "My Fees", href: "/student/fees", icon: "fees", anyOf: ["fees:read:own"], live: true },
    ],
  },
  {
    label: "Updates",
    items: [
      { label: "Notices", href: "/student/notices", icon: "notices", anyOf: ["notices:read"], live: true },
      { label: "Notifications", href: "/student/notifications", icon: "notifications", anyOf: ["notifications:read"], live: true },
      { label: "Profile", href: "/student/profile", icon: "profile", anyOf: ["profile:read:own"], live: true },
    ],
  },
];

export function getNavigationForUser(
  user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined,
  options: { liveOnly?: boolean } = {},
): NavGroup[] {
  if (!user) return [];
  const source = user.role === "admin" ? ADMIN_NAV : user.role === "teacher" ? TEACHER_NAV : STUDENT_NAV;
  return source
    .map((g) => ({ ...g, items: g.items.filter((i) => hasAnyPermission(user, i.anyOf) && (!options.liveOnly || i.live)) }))
    .filter((g) => g.items.length > 0);
}

/** Base path of the user's workspace, e.g. "/teacher". */
export function workspaceBase(user: Pick<UserAccount, "role"> | null | undefined) {
  return user ? `/${user.role}` : "";
}

/** Title for breadcrumbs from the nav config (falls back to the path segment). */
export function findNavItem(pathname: string, user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined): NavItem | undefined {
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
export function liveNavItems(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined): NavItem[] {
  return getNavigationForUser(user, { liveOnly: true }).flatMap((g) => g.items);
}
