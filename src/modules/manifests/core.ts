/**
 * Core contributions (Core always ships; it is not a selectable module).
 * Items gated by the stored "administration" entitlement carry `entitlementKey`.
 * Current (pre-extraction) paths; the transitional shells (dashboards, Academics
 * setup page, reports, My Classes) are served by Core until their module parts
 * become contributions.
 */
import type { CoreContributions, RouteContribution } from "../../../convex/contracts/manifest";

const page = (path: string, anyOf: RouteContribution["anyOf"], roles: RouteContribution["roles"], publicReason?: string): RouteContribution => ({
  path, file: `src/app${path === "/" ? "" : path}/page.tsx`, roles, anyOf, ...(publicReason ? { publicReason } : {}),
});

export const core: CoreContributions = {
  permissions: [
    "area:admin", "area:teacher", "area:student",
    "students:read:assigned", // a teacher's roster scope (Core My Classes shell)
    "academics:manage", "staff:manage", // school structure (D1) and staff records
    "notices:manage", "notices:read", "notifications:read", // communications (D3)
    "reports:read", "settings:manage", "profile:read:own",
    "users:manage", "audit:read", "files:upload",
  ],
  tables: [
    "_storage", "users", "authAccounts", "authSessions", "authRefreshTokens", "authVerificationCodes", "authVerifiers", "authRateLimits",
    "schools", "schoolSettings", "schoolModules", "schoolMemberships", "teachers",
    "academicYears", "classes", "sections",
    "counters", "auditLogs", "files", "notifications", "notices", "events", "bulkAccountJobs", "bulkAccountJobItems",
  ],
  routes: [
    page("/", [], [], "Entry point; redirects to sign-in or the user's workspace."),
    page("/login", [], [], "Sign-in page."),
    page("/account", ["profile:read:own"], ["admin", "teacher", "student"]),
    page("/admin", ["area:admin"], ["admin"]),
    page("/admin/dashboard", ["reports:read", "fees:manage"], ["admin"]),
    page("/admin/academics", ["academics:manage"], ["admin"]),
    page("/admin/teachers", ["staff:manage"], ["admin"]),
    page("/admin/teachers/new", ["staff:manage"], ["admin"]),
    page("/admin/teachers/[id]", ["staff:manage"], ["admin"]),
    page("/admin/teachers/[id]/edit", ["staff:manage"], ["admin"]),
    page("/admin/accounts", ["users:manage", "students:write", "staff:manage"], ["admin"]),
    page("/admin/permissions", ["users:manage"], ["admin"]),
    { ...page("/admin/notices", ["notices:manage"], ["admin"]), entitlementKey: "administration" },
    page("/admin/notifications", ["notifications:read"], ["admin"]),
    { ...page("/admin/reports", ["reports:read", "reports:finance"], ["admin"]), entitlementKey: "administration" },
    page("/admin/audit", ["audit:read"], ["admin"]),
    page("/admin/settings", ["settings:manage"], ["admin"]),
    page("/admin/profile", ["profile:read:own"], ["admin"]),
    page("/teacher", ["area:teacher"], ["teacher"]),
    page("/teacher/dashboard", ["area:teacher"], ["teacher"]),
    { ...page("/teacher/notices", ["notices:read"], ["teacher"]), entitlementKey: "administration" },
    page("/teacher/notifications", ["notifications:read"], ["teacher"]),
    page("/teacher/profile", ["profile:read:own"], ["teacher"]),
    // Personal account settings (password & security) — same access as the own profile.
    page("/teacher/settings", ["profile:read:own"], ["teacher"]),
    page("/student", ["area:student"], ["student"]),
    page("/student/notifications", ["notifications:read"], ["student"]),
    page("/student/settings", ["profile:read:own"], ["student"]),
  ],
  nav: [
    { role: "admin", group: "Overview", label: "Dashboard", href: "/admin/dashboard", icon: "dashboard", anyOf: ["reports:read", "fees:manage"], order: 0 },
    { role: "admin", group: "People & academics", label: "Academics", href: "/admin/academics", icon: "academics", anyOf: ["academics:manage"], order: 12 },
    { role: "admin", group: "People & academics", label: "Teachers & Staff", href: "/admin/teachers", icon: "teachers", anyOf: ["staff:manage"], order: 13 },
    { role: "admin", group: "People & academics", label: "Accounts & Import", href: "/admin/accounts", icon: "accounts", anyOf: ["users:manage", "students:write", "staff:manage"], order: 14 },
    { role: "admin", group: "People & academics", label: "Staff & Permissions", href: "/admin/permissions", icon: "settings", anyOf: ["users:manage"], order: 15 },
    { role: "admin", group: "Communication & insight", label: "Notices & Events", href: "/admin/notices", icon: "notices", anyOf: ["notices:manage"], order: 30, entitlementKey: "administration" },
    { role: "admin", group: "Communication & insight", label: "Notifications", href: "/admin/notifications", icon: "notifications", anyOf: ["notifications:read"], order: 31 },
    { role: "admin", group: "Communication & insight", label: "Reports", href: "/admin/reports", icon: "reports", anyOf: ["reports:read", "reports:finance"], order: 32, entitlementKey: "administration" },
    { role: "admin", group: "Communication & insight", label: "Audit log", href: "/admin/audit", icon: "audit", anyOf: ["audit:read"], order: 33 },
    { role: "admin", group: "Communication & insight", label: "Settings", href: "/admin/settings", icon: "settings", anyOf: ["settings:manage"], order: 34 },
    { role: "admin", group: "Communication & insight", label: "Profile", href: "/admin/profile", icon: "profile", anyOf: ["profile:read:own"], order: 35 },
    { role: "teacher", group: "Overview", label: "Dashboard", href: "/teacher/dashboard", icon: "dashboard", anyOf: ["area:teacher"], order: 0 },
    { role: "teacher", group: "Updates", label: "Notices", href: "/teacher/notices", icon: "notices", anyOf: ["notices:read"], order: 30, entitlementKey: "administration" },
    { role: "teacher", group: "Updates", label: "Notifications", href: "/teacher/notifications", icon: "notifications", anyOf: ["notifications:read"], order: 31 },
    { role: "teacher", group: "Updates", label: "Profile", href: "/teacher/profile", icon: "profile", anyOf: ["profile:read:own"], order: 32 },
    { role: "teacher", group: "Updates", label: "Settings", href: "/teacher/settings", icon: "settings", anyOf: ["profile:read:own"], order: 33 },
    { role: "student", group: "Updates", label: "Notifications", href: "/student/notifications", icon: "notifications", anyOf: ["notifications:read"], order: 31 },
    { role: "student", group: "Updates", label: "Settings", href: "/student/settings", icon: "settings", anyOf: ["profile:read:own"], order: 33 },
  ],
  crons: [],
};
