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
  /** The configurable module this page belongs to (convex/core/modules.ts); absent = core page. */
  module?: ModuleKey;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation is built from the module manifests SHIPPED in this build
 * (src/modules/registry.generated.ts): Core's items plus each module's, grouped
 * per role in manifest order. A module that is not in the build has no item
 * and no route; a shipped module the school has not enabled is hidden by
 * `module` (the stored entitlement key). Every manifest page is backed by live
 * (Convex) records.
 */
function navFor(role: UserAccount["role"]): NavGroup[] {
  const items = [
    ...CORE.nav.map((n) => ({ n, module: n.entitlementKey })),
    ...MODULE_MANIFESTS.flatMap((m) => m.nav.map((n) => ({ n, module: (n.entitlementKey ?? m.entitlementKey) as ModuleKey | undefined }))),
  ]
    .filter(({ n }) => n.role === role)
    .sort((a, b) => a.n.order - b.n.order);
  const groups: NavGroup[] = [];
  for (const { n, module } of items) {
    let g = groups.find((x) => x.label === n.group);
    if (!g) groups.push((g = { label: n.group, items: [] }));
    g.items.push({ label: n.label, href: n.href, icon: n.icon as NavIcon, anyOf: [...n.anyOf], live: true, ...(module ? { module } : {}) });
  }
  return groups;
}

const ADMIN_NAV = navFor("admin");
const TEACHER_NAV = navFor("teacher");
const STUDENT_NAV = navFor("student");

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
