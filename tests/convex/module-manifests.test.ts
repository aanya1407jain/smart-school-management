/**
 * Module manifests (docs/modularization/02-step1-contracts-and-registries.md §3, §8).
 *
 * The five manifests and Core's contributions must DESCRIBE the repository
 * exactly: tables, permissions, routes, navigation, function files, providers
 * (V1–V8). Invalid fixtures prove each validation rule rejects what it should.
 * The registry's selection rules must agree with the boundary tooling.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PERMISSIONS } from "../../convex/core/permissions";
import { MODULE_KEYS } from "../../convex/core/modules";
import { ENTITLEMENT_KEY, MODULE_IDS, type ModuleManifest } from "../../convex/contracts/manifest";
import { buildNavigation, buildRouteRules, requiresCycle, resolveSelection, validateManifests, type RegistryProblemCode } from "../../convex/contracts/registry";
import { PROVIDER_IDS, notInstalled, providerOwner } from "../../convex/contracts/providers";
import { parseIdParam } from "../../convex/contracts/ids";
import { core } from "../../scripts/modularity/manifests/core";
import { MANIFESTS } from "../../scripts/modularity/manifests/modules";
import { REQUIRES, TABLE_OWNER, ownerOf } from "../../scripts/modularity/ownership";
import { resolveClosure } from "../../scripts/modularity/select";
import { schemaTables } from "../../scripts/modularity/boundaries";
import { getNavigationForUser } from "@/lib/permissions/navigation";

const ROOT = join(__dirname, "../..");
const catalogue = { permissions: PERMISSIONS as readonly string[], tableOwner: TABLE_OWNER };
const codes = (ms: readonly ModuleManifest[]) => validateManifests(ms, core, catalogue).map((p) => p.code);
const tweak = (id: string, patch: (m: ModuleManifest) => ModuleManifest) => MANIFESTS.map((m) => (m.id === id ? patch(m) : m));

describe("real manifests describe the repository", () => {
  test("they validate cleanly (V1–V5, V7, V8)", () => {
    expect(validateManifests(MANIFESTS, core, catalogue)).toEqual([]);
  });

  test("one manifest per module id, matching the ownership tooling's dependencies", () => {
    expect(MANIFESTS.map((m) => m.id).sort()).toEqual([...MODULE_IDS].sort());
    for (const m of MANIFESTS) expect([...m.requires].sort(), m.id).toEqual([...REQUIRES[m.id]].sort());
  });

  test("entitlement keys are existing stored keys (no rename)", () => {
    for (const m of MANIFESTS) {
      expect(MODULE_KEYS).toContain(m.entitlementKey);
      expect(m.entitlementKey).toBe(ENTITLEMENT_KEY[m.id]);
    }
  });

  test("every schema table is declared by exactly one owner", () => {
    const declared = [...core.tables, ...MANIFESTS.flatMap((m) => m.backend.tables)];
    for (const t of schemaTables(ROOT)) expect(declared.filter((x) => x === t), t).toHaveLength(1);
  });

  test("function files and route files exist and belong to their module (V6, V7)", () => {
    for (const m of MANIFESTS) {
      for (const f of m.backend.functionFiles) {
        expect(existsSync(join(ROOT, f)), f).toBe(true);
        expect(ownerOf(f), f).toBe(m.id);
      }
      for (const r of m.routes) {
        expect(existsSync(join(ROOT, r.file)), r.file).toBe(true);
        expect(ownerOf(r.file), r.file).toBe(m.id);
      }
    }
    for (const r of core.routes) {
      expect(existsSync(join(ROOT, r.file)), r.file).toBe(true);
      expect(["core", "transitional"]).toContain(ownerOf(r.file));
    }
  });

  test("every page in src/app is declared exactly once", () => {
    const declared = buildRouteRules(MANIFESTS, core).map((r) => r.file).sort();
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name === "page.tsx" ? [join(dir, e.name)] : []));
    const pages = walk(join(ROOT, "src/app")).map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/")).sort();
    expect(declared).toEqual(pages);
  });

  test("crons declared by modules are the crons in convex/crons.ts", () => {
    const src = readFileSync(join(ROOT, "convex/crons.ts"), "utf8");
    const real = [...src.matchAll(/crons\.\w+\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    expect([...core.crons, ...MANIFESTS.flatMap((m) => m.backend.crons)].map((c) => c.name).sort()).toEqual(real);
  });

  test("generated navigation equals today's hard-coded navigation for each role (two sources agree until the switch)", () => {
    const all = buildNavigation(MANIFESTS, core);
    for (const role of ["admin", "teacher", "student"] as const) {
      // Every permission and module, but no admin area for teachers (that adds "Additional duties").
      const permissions = PERMISSIONS.filter((p) => role !== "teacher" || p !== "area:admin");
      const current = getNavigationForUser({ role, permissions: [...permissions], permissionSets: [], modules: [...MODULE_KEYS] } as never).flatMap((g) => g.items.map((i) => i.href)).sort();
      expect(all.filter((n) => n.role === role).map((n) => n.href).sort(), role).toEqual(current);
    }
  });

  test("providers are owned by the module whose id prefixes them", () => {
    for (const m of MANIFESTS) for (const p of m.provides) expect(providerOwner(p)).toBe(m.id);
    expect(MANIFESTS.flatMap((m) => m.provides).sort()).toEqual([...PROVIDER_IDS].sort()); // every contract has exactly one implementer
    expect(notInstalled("fees.studentDues")).toEqual({ installed: false, reason: "fees is not installed" });
  });
});

describe("validation rejects invalid manifests", () => {
  const expectCode = (ms: readonly ModuleManifest[], code: RegistryProblemCode) => expect(codes(ms)).toContain(code);

  test("unknown id, duplicate, self-dependency, required-and-optional", () => {
    expectCode(tweak("fees", (m) => ({ ...m, id: "library" as never })), "UNKNOWN_MODULE");
    expectCode([...MANIFESTS, MANIFESTS[0]], "DUPLICATE");
    expectCode(tweak("fees", (m) => ({ ...m, requires: ["students", "fees"] })), "SELF_DEPENDENCY");
    expectCode(tweak("fees", (m) => ({ ...m, optional: ["students"] })), "REQUIRED_AND_OPTIONAL");
  });

  test("a required-module cycle is detected", () => {
    const cyclic = tweak("students", (m) => ({ ...m, requires: ["fees"], optional: m.optional.filter((x) => x !== "fees") }));
    expectCode(cyclic, "CYCLE");
    expect(requiresCycle([{ id: "students", requires: ["fees"] }, { id: "fees", requires: ["students"] }])).toEqual(["students", "fees", "students"]);
  });

  test("permissions: unknown, owned twice, unowned", () => {
    expectCode(tweak("fees", (m) => ({ ...m, permissions: [...m.permissions, "fees:delete" as never] })), "PERMISSION_UNKNOWN");
    expectCode(tweak("fees", (m) => ({ ...m, permissions: [...m.permissions, "students:write"] })), "PERMISSION_OWNER");
    expectCode(tweak("fees", (m) => ({ ...m, permissions: ["fees:manage"] })), "PERMISSION_OWNER");
  });

  test("tables: claimed twice, claimed against the ownership map, owned but undeclared", () => {
    expectCode(tweak("fees", (m) => ({ ...m, backend: { ...m.backend, tables: [...m.backend.tables, "students"] } })), "TABLE_OWNER");
    expectCode(tweak("fees", (m) => ({ ...m, backend: { ...m.backend, tables: m.backend.tables.filter((t) => t !== "receipts") } })), "TABLE_OWNER");
  });

  test("routes: conflicting path, unexplained public route, nav item without a route", () => {
    expectCode(tweak("fees", (m) => ({ ...m, routes: [...m.routes, { path: "/admin/students", file: "x", roles: ["admin"], anyOf: ["fees:manage"] }] })), "ROUTE_CONFLICT");
    expectCode(tweak("fees", (m) => ({ ...m, routes: [...m.routes, { path: "/fees/public", file: "x", roles: [], anyOf: [] }] })), "PUBLIC_ROUTE_UNEXPLAINED");
    expectCode(tweak("fees", (m) => ({ ...m, nav: [...m.nav, { role: "admin", group: "x", label: "Ghost", href: "/admin/ghost", icon: "fees", anyOf: ["fees:manage"], order: 99 }] })), "NAV_WITHOUT_ROUTE");
  });

  test("providers: unknown, wrong owner, consumed without declaring the provider's module", () => {
    expectCode(tweak("fees", (m) => ({ ...m, provides: [...m.provides, "fees.nope" as never] })), "PROVIDER_UNKNOWN");
    expectCode(tweak("fees", (m) => ({ ...m, provides: [...m.provides, "students.roster"] })), "PROVIDER_OWNER");
    expectCode(tweak("attendance", (m) => ({ ...m, consumes: [...m.consumes, "fees.studentDues"] })), "PROVIDER_UNDECLARED");
  });
});

describe("selection through the registry agrees with the tooling", () => {
  const products = [["students"], ["students", "attendance"], ["attendance"], ["academics"], ["students", "academics", "examinations"], ["students", "examinations"], ["fees"], ["students", "attendance", "academics", "fees", "examinations"], ["students", "library"]];
  test.each(products.map((p) => [p.join("+") || "(empty)", p]))("%s", (_name, product) => {
    const viaRegistry = resolveSelection(MANIFESTS, product as string[]).problems.map((p) => p.code).sort();
    const viaTooling = resolveClosure(product as string[]).problems.map((p) => p.code).sort();
    expect(viaRegistry).toEqual(viaTooling);
  });

  test("Students + Attendance selects no Academics, Fees or Examinations contribution", () => {
    const { modules, problems } = resolveSelection(MANIFESTS, ["students", "attendance"]);
    expect(problems).toEqual([]);
    const nav = buildNavigation(modules, core).map((n) => n.href);
    const routes = buildRouteRules(modules, core).map((r) => r.path);
    for (const href of ["/admin/fees", "/admin/examinations", "/admin/timetable", "/student/results", "/student/fees", "/teacher/homework"]) {
      expect(nav).not.toContain(href);
      expect(routes).not.toContain(href);
    }
    expect(nav).toEqual(expect.arrayContaining(["/admin/students", "/admin/attendance", "/student/attendance"]));
  });
});

describe("id parsing at untrusted boundaries", () => {
  test("accepts Convex-shaped ids and rejects everything else", () => {
    expect(parseIdParam("students", "j572s7s98p9wyn4rz6m3ymefhh8h0mwt")).toBe("j572s7s98p9wyn4rz6m3ymefhh8h0mwt");
    for (const bad of ["", "x", "../etc", "ABC", "sec_10a", 42, null, undefined, "a".repeat(80)]) expect(parseIdParam("students", bad)).toBeNull();
  });
});
