/**
 * Module registry (docs/modularization/02-step1-contracts-and-registries.md §1.5, §3).
 *
 * Pure functions over manifests — no Convex runtime, no filesystem. Used by
 * tests, the export script and (after extraction) the app shell. The registry
 * decides what EXISTS in a build; permissions and school entitlements still
 * decide what a person in a school may open.
 */
import type { CoreContributions, ModuleId, ModuleManifest, NavContribution, RouteContribution } from "./manifest";
import { MODULE_IDS, isModuleId } from "./manifest";
import { PROVIDER_IDS, providerOwner, type ProviderId } from "./providers";

export type RegistryProblemCode =
  | "UNKNOWN_MODULE" | "DUPLICATE" | "MISSING_REQUIRED" | "CYCLE" | "SELF_DEPENDENCY" | "REQUIRED_AND_OPTIONAL"
  | "PERMISSION_UNKNOWN" | "PERMISSION_OWNER" | "TABLE_OWNER" | "ROUTE_CONFLICT" | "NAV_WITHOUT_ROUTE"
  | "PROVIDER_UNKNOWN" | "PROVIDER_OWNER" | "PROVIDER_UNDECLARED" | "PUBLIC_ROUTE_UNEXPLAINED" | "EMPTY";

export type RegistryProblem = { code: RegistryProblemCode; detail: string };

/** Route path → regexp matching concrete URLs ("[id]" segments match one segment). */
function routeMatcher(path: string): RegExp {
  return new RegExp(`^${path.split("/").map((seg) => (/^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/")}$`);
}

/** Find one cycle in the `requires` graph of the given manifests (or null). */
export function requiresCycle(manifests: readonly Pick<ModuleManifest, "id" | "requires">[]): string[] | null {
  const deps = new Map(manifests.map((m) => [m.id as string, m.requires as readonly string[]]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const d of deps.get(id) ?? []) { const c = visit(d); if (c) return c; }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const id of deps.keys()) { const c = visit(id); if (c) return c; }
  return null;
}

/**
 * Validate a full set of manifests plus Core (V1–V5, V7, V8 of the proposal).
 * `catalogue.permissions` is the permission catalogue (core/permissions.ts);
 * `catalogue.tableOwner` the ownership map. File-system checks (route files,
 * function files) are done by the caller.
 */
export function validateManifests(
  manifests: readonly ModuleManifest[],
  core: CoreContributions,
  catalogue: { permissions: readonly string[]; tableOwner: Readonly<Record<string, string>> },
): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const ids = new Set<string>();
  for (const m of manifests) {
    if (!isModuleId(m.id)) problems.push({ code: "UNKNOWN_MODULE", detail: `Unknown module id "${m.id}".` });
    if (ids.has(m.id)) problems.push({ code: "DUPLICATE", detail: `Module "${m.id}" is declared twice.` });
    ids.add(m.id);
  }
  for (const m of manifests) {
    for (const d of [...m.requires, ...m.optional]) if (!isModuleId(d)) problems.push({ code: "UNKNOWN_MODULE", detail: `${m.id} names unknown module "${d}".` });
    if (m.requires.includes(m.id) || m.optional.includes(m.id)) problems.push({ code: "SELF_DEPENDENCY", detail: `${m.id} depends on itself.` });
    for (const d of m.requires) if (m.optional.includes(d)) problems.push({ code: "REQUIRED_AND_OPTIONAL", detail: `${m.id} lists ${d} as both required and optional.` });
  }
  const cycle = requiresCycle(manifests);
  if (cycle) problems.push({ code: "CYCLE", detail: `Required-module cycle: ${cycle.join(" → ")}` });

  // Permissions: known, and owned by exactly one module or Core.
  const permOwner = new Map<string, string>();
  const claim = (perm: string, owner: string) => {
    if (!catalogue.permissions.includes(perm)) problems.push({ code: "PERMISSION_UNKNOWN", detail: `${owner} declares unknown permission "${perm}".` });
    const prev = permOwner.get(perm);
    if (prev && prev !== owner) problems.push({ code: "PERMISSION_OWNER", detail: `"${perm}" is owned by both ${prev} and ${owner}.` });
    permOwner.set(perm, owner);
  };
  for (const p of core.permissions) claim(p, "core");
  for (const m of manifests) for (const p of m.permissions) claim(p, m.id);
  for (const p of catalogue.permissions) if (!permOwner.has(p)) problems.push({ code: "PERMISSION_OWNER", detail: `Permission "${p}" has no owner.` });

  // Tables: each manifest's set equals the ownership map; nothing owned twice.
  const tableClaims = new Map<string, string>();
  const claimTable = (t: string, owner: string) => {
    const prev = tableClaims.get(t);
    if (prev && prev !== owner) problems.push({ code: "TABLE_OWNER", detail: `Table "${t}" is claimed by ${prev} and ${owner}.` });
    tableClaims.set(t, owner);
    if (catalogue.tableOwner[t] !== owner) problems.push({ code: "TABLE_OWNER", detail: `${owner} claims "${t}", the ownership map says ${catalogue.tableOwner[t] ?? "nobody"}.` });
  };
  for (const t of core.tables) claimTable(t, "core");
  for (const m of manifests) for (const t of m.backend.tables) claimTable(t, m.id);
  for (const [t, owner] of Object.entries(catalogue.tableOwner)) if (!tableClaims.has(t)) problems.push({ code: "TABLE_OWNER", detail: `${owner} owns "${t}" but its manifest does not declare it.` });

  // Routes: unique paths; public routes explained; nav hrefs resolve to a declared route.
  const routes: { r: RouteContribution; owner: string }[] = [...core.routes.map((r) => ({ r, owner: "core" })), ...manifests.flatMap((m) => m.routes.map((r) => ({ r, owner: m.id as string })))];
  const byPath = new Map<string, string>();
  for (const { r, owner } of routes) {
    const prev = byPath.get(r.path);
    if (prev) problems.push({ code: "ROUTE_CONFLICT", detail: `Route ${r.path} is declared by ${prev} and ${owner}.` });
    byPath.set(r.path, owner);
    if (r.anyOf.length === 0 && !r.publicReason) problems.push({ code: "PUBLIC_ROUTE_UNEXPLAINED", detail: `${owner} route ${r.path} has no permission and no publicReason.` });
  }
  const matchers = routes.map(({ r }) => routeMatcher(r.path));
  for (const n of [...core.nav, ...manifests.flatMap((m) => m.nav)]) {
    if (!matchers.some((re) => re.test(n.href))) problems.push({ code: "NAV_WITHOUT_ROUTE", detail: `Navigation item "${n.label}" (${n.href}) has no declared route.` });
  }

  // Providers: known, provided only by their owner, consumed ones provided somewhere or by an optional/required module.
  const provided = new Set<ProviderId>();
  for (const m of manifests) for (const p of m.provides) {
    if (!(PROVIDER_IDS as readonly string[]).includes(p)) problems.push({ code: "PROVIDER_UNKNOWN", detail: `${m.id} provides unknown "${p}".` });
    else if (providerOwner(p) !== m.id) problems.push({ code: "PROVIDER_OWNER", detail: `${m.id} provides "${p}", which belongs to ${providerOwner(p)}.` });
    provided.add(p);
  }
  for (const m of manifests) for (const p of m.consumes) {
    if (!(PROVIDER_IDS as readonly string[]).includes(p)) { problems.push({ code: "PROVIDER_UNKNOWN", detail: `${m.id} consumes unknown "${p}".` }); continue; }
    const owner = providerOwner(p) as ModuleId;
    if (!m.requires.includes(owner) && !m.optional.includes(owner)) problems.push({ code: "PROVIDER_UNDECLARED", detail: `${m.id} consumes "${p}" but does not list ${owner} as required or optional.` });
    else if (!provided.has(p)) problems.push({ code: "PROVIDER_UNDECLARED", detail: `${m.id} consumes "${p}", which no manifest provides.` });
  }
  return problems;
}

/**
 * Resolve a product selection: every id known, no duplicates, every required
 * module present. Missing requirements are REPORTED, never added.
 */
export function resolveSelection(manifests: readonly ModuleManifest[], selection: readonly string[]): { modules: ModuleManifest[]; problems: RegistryProblem[] } {
  const problems: RegistryProblem[] = [];
  if (selection.length === 0) problems.push({ code: "EMPTY", detail: "Choose at least one module." });
  const byId = new Map(manifests.map((m) => [m.id as string, m]));
  const seen = new Set<string>();
  for (const id of selection) {
    if (!byId.has(id)) problems.push({ code: "UNKNOWN_MODULE", detail: `Unknown module "${id}".` });
    else if (seen.has(id)) problems.push({ code: "DUPLICATE", detail: `Module "${id}" is listed twice.` });
    seen.add(id);
  }
  for (const id of seen) for (const d of byId.get(id)?.requires ?? []) {
    if (!seen.has(d)) problems.push({ code: "MISSING_REQUIRED", detail: `${id} requires ${d}; add it to the product (modules are never added automatically).` });
  }
  const modules = MODULE_IDS.filter((id) => seen.has(id) && byId.has(id)).map((id) => byId.get(id)!);
  return { modules, problems };
}

/** Navigation contributions of Core + the given modules, ordered per role/group. */
export function buildNavigation(modules: readonly ModuleManifest[], core: CoreContributions): NavContribution[] {
  return [...core.nav, ...modules.flatMap((m) => m.nav)].sort((a, b) => a.role.localeCompare(b.role) || a.order - b.order);
}

/** Route contributions of Core + the given modules. */
export function buildRouteRules(modules: readonly ModuleManifest[], core: CoreContributions): RouteContribution[] {
  return [...core.routes, ...modules.flatMap((m) => m.routes)];
}
