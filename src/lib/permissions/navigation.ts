import type { UserAccount } from "@/types/domain";
import { hasAnyPermission, type Permission } from "./permissions";

/**
 * Navigation is derived from permissions, never hard-coded per page.
 * Icons are referenced by name and resolved in the UI layer.
 */
export type NavIcon =
  | "dashboard" | "students" | "academics" | "teachers" | "attendance" | "fees" | "exams" | "timetable"
  | "homework" | "notices" | "notifications" | "reports" | "settings" | "classes" | "results" | "profile";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  anyOf: Permission[];
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

const ADMIN_NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/admin/dashboard", icon: "dashboard", anyOf: ["reports:read", "fees:manage"] }] },
  {
    label: "People & academics",
    items: [
      { label: "Students", href: "/admin/students", icon: "students", anyOf: ["students:read:all"] },
      { label: "Academics", href: "/admin/academics", icon: "academics", anyOf: ["academics:manage"] },
      { label: "Teachers & Staff", href: "/admin/teachers", icon: "teachers", anyOf: ["staff:manage"] },
    ],
  },
  {
    label: "Daily operations",
    items: [
      { label: "Attendance", href: "/admin/attendance", icon: "attendance", anyOf: ["attendance:read:all"] },
      { label: "Fees", href: "/admin/fees", icon: "fees", anyOf: ["fees:manage"] },
      { label: "Examinations", href: "/admin/examinations", icon: "exams", anyOf: ["exams:manage"] },
      { label: "Timetable", href: "/admin/timetable", icon: "timetable", anyOf: ["timetable:manage"] },
      { label: "Homework", href: "/admin/homework", icon: "homework", anyOf: ["homework:read:all"] },
    ],
  },
  {
    label: "Communication & insight",
    items: [
      { label: "Notices & Events", href: "/admin/notices", icon: "notices", anyOf: ["notices:manage"] },
      { label: "Notifications", href: "/admin/notifications", icon: "notifications", anyOf: ["notifications:read"] },
      { label: "Reports", href: "/admin/reports", icon: "reports", anyOf: ["reports:read", "reports:finance"] },
      { label: "Settings", href: "/admin/settings", icon: "settings", anyOf: ["settings:manage"] },
    ],
  },
];

const TEACHER_NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/teacher/dashboard", icon: "dashboard", anyOf: ["area:teacher"] }] },
  {
    label: "Teaching",
    items: [
      { label: "My Classes", href: "/teacher/classes", icon: "classes", anyOf: ["students:read:assigned"] },
      { label: "Attendance", href: "/teacher/attendance", icon: "attendance", anyOf: ["attendance:read:assigned"] },
      { label: "Homework", href: "/teacher/homework", icon: "homework", anyOf: ["homework:manage:assigned"] },
      { label: "Examinations", href: "/teacher/examinations", icon: "exams", anyOf: ["marks:enter:assigned"] },
      { label: "Timetable", href: "/teacher/timetable", icon: "timetable", anyOf: ["timetable:read:own"] },
    ],
  },
  {
    label: "Updates",
    items: [
      { label: "Notices", href: "/teacher/notices", icon: "notices", anyOf: ["notices:read"] },
      { label: "Notifications", href: "/teacher/notifications", icon: "notifications", anyOf: ["notifications:read"] },
      { label: "Profile", href: "/teacher/profile", icon: "profile", anyOf: ["profile:read:own"] },
    ],
  },
];

const STUDENT_NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/student/dashboard", icon: "dashboard", anyOf: ["area:student"] }] },
  {
    label: "My school",
    items: [
      { label: "My Attendance", href: "/student/attendance", icon: "attendance", anyOf: ["attendance:read:own"] },
      { label: "My Timetable", href: "/student/timetable", icon: "timetable", anyOf: ["timetable:read:own"] },
      { label: "My Homework", href: "/student/homework", icon: "homework", anyOf: ["homework:read:own"] },
      { label: "My Results", href: "/student/results", icon: "results", anyOf: ["results:read:own"] },
      { label: "My Fees", href: "/student/fees", icon: "fees", anyOf: ["fees:read:own"] },
    ],
  },
  {
    label: "Updates",
    items: [
      { label: "Notices", href: "/student/notices", icon: "notices", anyOf: ["notices:read"] },
      { label: "Notifications", href: "/student/notifications", icon: "notifications", anyOf: ["notifications:read"] },
      { label: "Profile", href: "/student/profile", icon: "profile", anyOf: ["profile:read:own"] },
    ],
  },
];

export function getNavigationForUser(user: Pick<UserAccount, "role" | "permissionSets"> | null | undefined): NavGroup[] {
  if (!user) return [];
  const source = user.role === "admin" ? ADMIN_NAV : user.role === "teacher" ? TEACHER_NAV : STUDENT_NAV;
  return source
    .map((g) => ({ ...g, items: g.items.filter((i) => hasAnyPermission(user, i.anyOf)) }))
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
