/**
 * The browser's reading of `viewer.modules` (src/features/auth/session-modules.ts).
 *
 * Regression: "TypeError: session.viewer.modules is not iterable" — the P1
 * frontend talking to a Convex deployment that predates module entitlements
 * (its `users.session` has no `modules`). The session must not crash, and must
 * not grant any module it was not explicitly given.
 */
import { describe, expect, test } from "vitest";
import { MODULE_KEYS } from "../../convex/core/modules";
import { parseSessionModules, withSessionModules } from "../../src/features/auth/session-modules";
import { canAccessRoute } from "../../src/lib/permissions/routes";

const admin = { id: "u1", role: "admin" as const, name: "Principal", permissionSets: [] as string[] };

describe("parseSessionModules", () => {
  test("a valid server list is kept as is (catalogue order)", () => {
    expect(parseSessionModules([...MODULE_KEYS])).toEqual({ modules: [...MODULE_KEYS], status: "ok", ignored: [] });
    expect(parseSessionModules(["administration", "students", "finance"])).toEqual({ modules: ["students", "finance", "administration"], status: "ok", ignored: [] });
  });

  test("an empty list is valid: the school has no modules", () => {
    expect(parseSessionModules([])).toEqual({ modules: [], status: "ok", ignored: [] });
  });

  test("missing (older backend) grants nothing", () => {
    expect(parseSessionModules(undefined)).toEqual({ modules: [], status: "missing", ignored: [] });
    expect(parseSessionModules(null)).toEqual({ modules: [], status: "missing", ignored: [] });
  });

  test("malformed values grant nothing", () => {
    for (const bad of ["finance", 5, true, {}, { finance: true }, new Set(["finance"]), ["finance", 1], [null], [["students"]]]) {
      expect(parseSessionModules(bad), JSON.stringify(bad)).toEqual({ modules: [], status: "malformed", ignored: [] });
    }
  });

  test("unknown keys (e.g. from a newer backend) are ignored, never granted; duplicates collapse", () => {
    expect(parseSessionModules(["students", "library", "students", "Finance"])).toEqual({ modules: ["students"], status: "ok", ignored: ["library", "Finance"] });
  });

  test("a module whose dependency is absent is dropped, never auto-enabled", () => {
    expect(parseSessionModules(["finance", "attendance", "academics", "administration"])).toEqual({ modules: ["administration"], status: "ok", ignored: [] });
  });
});

describe("withSessionModules (demo personas and live accounts alike)", () => {
  test("a demo persona gets exactly the server's list, replacing any stale client value", () => {
    const persona = { ...admin, modules: [...MODULE_KEYS] };
    expect(withSessionModules(persona, { modules: ["students", "academics"] }).modules).toEqual(["students", "academics"]);
    expect(withSessionModules(persona, { modules: [...MODULE_KEYS] }).modules).toEqual([...MODULE_KEYS]);
  });

  test("a session without modules leaves the user with none (stale client value is not kept)", () => {
    const persona = { ...admin, modules: [...MODULE_KEYS] };
    expect(withSessionModules(persona, {}).modules).toEqual([]);
    expect(withSessionModules(persona, null).modules).toEqual([]);
    expect(withSessionModules(persona, { modules: "finance" }).modules).toEqual([]);
  });

  test("other user fields are untouched", () => {
    const u = withSessionModules(admin, { modules: ["students"] });
    expect(u).toEqual({ ...admin, modules: ["students"] });
  });

  test("route guard: missing modules hide module pages but keep core pages", () => {
    const u = withSessionModules(admin, {});
    expect(canAccessRoute(u, "/admin/fees")).toBe("module_disabled");
    expect(canAccessRoute(u, "/admin/students")).toBe("module_disabled");
    expect(canAccessRoute(u, "/admin/dashboard")).toBe("allowed");
    const ok = withSessionModules(admin, { modules: [...MODULE_KEYS] });
    expect(canAccessRoute(ok, "/admin/fees")).toBe("allowed");
  });
});
