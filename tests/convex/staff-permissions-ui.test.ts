/**
 * Frontend helpers for per-member grants: the UI uses the SERVER's effective
 * permissions (users.session → viewer.permissions), and navigation / route
 * guards / landing pages follow them. UI only — the server enforces.
 */
import { describe, expect, test } from "vitest";
import { MODULE_KEYS } from "../../convex/core/modules";
import { GRANT_PRESETS } from "../../convex/core/grants";
import { resolvePermissions } from "../../convex/core/permissions";
import { parseSessionPermissions, withServerAccess } from "../../src/features/auth/session-modules";
import { canAccessRoute } from "../../src/lib/permissions/routes";
import { getNavigationForUser, landingRouteFor } from "../../src/lib/permissions/navigation";
import { hasPermission } from "../../src/lib/permissions/permissions";

const modules = [...MODULE_KEYS];
const office = (grants: { module: string; actions: string[] }[]) => ({ role: "admin" as const, permissionSets: [], modules, permissions: [...resolvePermissions("admin", [], { grants })] });
const teacher = (grants: { module: string; actions: string[] }[], sectionLimited = false) => ({ role: "teacher" as const, permissionSets: [], modules, permissions: [...resolvePermissions("teacher", [], { grants, sectionLimited })] });

describe("server permissions in the session", () => {
  test("only known permission names are kept; malformed → fall back to the role", () => {
    expect(parseSessionPermissions(["fees:manage", "made:up"])).toEqual(["fees:manage"]);
    expect(parseSessionPermissions("fees:manage")).toBeUndefined();
    expect(parseSessionPermissions([1])).toBeUndefined();
    const u = withServerAccess({ role: "admin" as const, permissionSets: [] as string[], permissions: ["users:manage"] }, { modules, permissions: "bad" });
    expect(u.permissions).toBeUndefined(); // stale client value dropped
    expect(hasPermission(u, "users:manage")).toBe(true); // role fallback: a full admin
  });

  test("a restricted office login is restricted in the UI too", () => {
    const accountant = office(GRANT_PRESETS.find((p) => p.key === "accountant")!.grants);
    expect(hasPermission(accountant, "fees:manage")).toBe(true);
    expect(hasPermission(accountant, "users:manage")).toBe(false);
    expect(canAccessRoute(accountant, "/admin/fees")).toBe("allowed");
    expect(canAccessRoute(accountant, "/admin/permissions")).toBe("forbidden");
    expect(canAccessRoute(accountant, "/admin/settings")).toBe("forbidden");
    expect(getNavigationForUser(accountant).flatMap((g) => g.items).map((i) => i.href)).not.toContain("/admin/accounts");
  });

  test("an office login without dashboard access lands on its first page", () => {
    const admissions = office(GRANT_PRESETS.find((p) => p.key === "admission_officer")!.grants);
    expect(landingRouteFor(admissions)).toBe("/admin/students");
    expect(landingRouteFor(office(GRANT_PRESETS.find((p) => p.key === "accountant")!.grants))).toBe("/admin/dashboard");
  });

  test("the Principal sees Staff & Permissions and Promotions", () => {
    const principal = { role: "admin" as const, permissionSets: [], modules, permissions: [...resolvePermissions("admin")] };
    const hrefs = getNavigationForUser(principal).flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs).toContain("/admin/permissions");
    expect(hrefs).toContain("/admin/promotions");
    expect(canAccessRoute(principal, "/admin/promotions")).toBe("allowed");
    expect(canAccessRoute({ ...principal, modules: ["administration"] }, "/admin/promotions")).toBe("module_disabled");
  });

  test("teacher extra duties: an exam coordinator gets an Additional duties menu", () => {
    const coordinator = teacher(GRANT_PRESETS.find((p) => p.key === "exam_coordinator")!.grants);
    const groups = getNavigationForUser(coordinator);
    const duties = groups.find((g) => g.label === "Additional duties");
    expect(duties?.items.map((i) => i.href)).toEqual(expect.arrayContaining(["/admin/examinations", "/admin/timetable", "/admin/academics"]));
    expect(duties?.items.map((i) => i.href)).not.toContain("/admin/permissions");
    expect(canAccessRoute(coordinator, "/admin/examinations")).toBe("allowed");
    expect(landingRouteFor(coordinator)).toBe("/teacher/dashboard");
    // A plain teacher has none.
    expect(getNavigationForUser(teacher([])).some((g) => g.label === "Additional duties")).toBe(false);
    expect(canAccessRoute(teacher([]), "/admin/examinations")).toBe("forbidden");
    // Section-limited view grants do not open the admin workspace.
    expect(getNavigationForUser(teacher([{ module: "students", actions: ["view"] }], true)).some((g) => g.label === "Additional duties")).toBe(false);
  });
});
