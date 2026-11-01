import type { ModuleKey } from "@convex/core/modules";
import { hasAnyPermission, hasPermission, type Permission } from "./permissions";
import { CORE, MODULE_MANIFESTS } from "@/modules/registry.generated";
import { moduleAllowed, type NavUser } from "./navigation";

/**
 * Route → permission rules, built from the routes of Core and the module
 * manifests SHIPPED in this build (src/modules/registry.generated.ts) — no
 * hard-coded paths. A concrete URL uses the most specific declared route
 * ("/admin/examinations/marks" before "/admin/examinations/[id]"); a path below
 * a declared page uses the closest declared ancestor; anything else inside a
 * workspace falls back to the workspace's area permission.
 */
interface RouteRule {
  path: string;
  pattern: RegExp;
  /** Pattern for the page and everything below it. */
  prefix: RegExp;
  dynamicSegments: number;
  anyOf: Permission[];
  /** The module the page belongs to; the school must have it enabled (convex/core/modules.ts). */
  module?: ModuleKey;
}

function toRule(path: string, anyOf: readonly Permission[], module: ModuleKey | undefined): RouteRule {
  // Declared paths are plain segments ("fees", "[studentId]"); only dynamic ones become patterns.
  const body = path.split("/").map((seg) => (/^\[.+\]$/.test(seg) ? "[^/]+" : seg)).join("/");
  return {
    path, pattern: new RegExp(`^${body}$`), prefix: new RegExp(`^${body}(?:/.*)?$`),
    dynamicSegments: path.split("/").filter((seg) => /^\[.+\]$/.test(seg)).length,
    anyOf: [...anyOf], ...(module ? { module } : {}),
  };
}

export const ROUTE_RULES: RouteRule[] = [
  ...CORE.routes.map((r) => toRule(r.path, r.anyOf, r.entitlementKey)),
  ...MODULE_MANIFESTS.flatMap((m) => m.routes.map((r) => toRule(r.path, r.anyOf, r.entitlementKey ?? m.entitlementKey))),
].filter((r) => r.anyOf.length > 0); // public pages need no rule

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
  const exact = ROUTE_RULES.filter((rule) => rule.pattern.test(pathname)).sort((a, b) => a.dynamicSegments - b.dynamicSegments)[0];
  if (exact) return exact;
  // Closest declared ancestor (longest path), e.g. an unknown sub-page of a module.
  return ROUTE_RULES.filter((rule) => rule.prefix.test(pathname)).sort((a, b) => b.path.length - a.path.length)[0];
}

/**
 * Is this page part of the build at all (declared by Core or a shipped
 * module)? Shared screens use it to hide links to modules that are not shipped.
 */
export function isRouteShipped(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return SHIPPED_PATHS.some((re) => re.test(path));
}
const SHIPPED_PATHS = [...CORE.routes, ...MODULE_MANIFESTS.flatMap((m) => m.routes)].map((r) => toRule(r.path, r.anyOf, undefined).pattern);

export function isProtectedRoute(pathname: string) {
  return AREA_RULES.some((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
}

export function canAccessRoute(user: NavUser | null | undefined, pathname: string): RouteAccess {
  if (!isProtectedRoute(pathname)) return "allowed";
  if (!user) return "unauthenticated";
  const area = AREA_RULES.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`))!;
  if (!hasPermission(user, area.permission)) return "forbidden";
  const rule = routeRuleFor(pathname);
  if (rule && !hasAnyPermission(user, rule.anyOf)) return "forbidden";
  if (rule && !moduleAllowed(user, rule.module)) return "module_disabled";
  return "allowed";
}
