/**
 * Module manifest contract (docs/modularization/02-step1-contracts-and-registries.md §1).
 *
 * Shared by the Convex backend, the Next.js app and the build tooling: pure
 * types and constants, no Convex runtime, no React, no imports from any module.
 *
 * A manifest DESCRIBES what a module's folders contain and is verified against
 * them (tests/convex/module-manifests.test.ts). It never hides code: modules a
 * product does not buy are excluded from the export, not switched off here.
 * Runtime entitlement (what a school may use) stays in core/modules.ts.
 */
import type { ModuleKey } from "../core/modules";
import type { Permission, Role } from "../core/permissions";
import type { ProviderId } from "./providers";

export const MODULE_IDS = ["students", "attendance", "academics", "fees", "examinations"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (MODULE_IDS as readonly string[]).includes(value);
}

/**
 * The stored entitlement key (core/modules.ts, `schoolModules`) that gates each
 * module at runtime TODAY. Stored keys are never renamed or reused; Examinations
 * shares "academics" until the D2 migration introduces an "examinations" key.
 */
export const ENTITLEMENT_KEY = {
  students: "students",
  attendance: "attendance",
  academics: "academics",
  fees: "finance",
  examinations: "academics",
} as const satisfies Record<ModuleId, ModuleKey>;

export type SemVer = `${number}.${number}.${number}`;

export type RouteContribution = {
  /** URL path (Next.js app-router syntax, e.g. "/admin/fees/[studentId]"). */
  path: string;
  /** Repo-relative page file that serves it. */
  file: string;
  roles: readonly Role[];
  /** Any one of these is enough; empty = public page (must be explained in `publicReason`). */
  anyOf: readonly Permission[];
  publicReason?: string;
  /** The stored entitlement that gates the page; defaults to the manifest's key (Core pages: none). */
  entitlementKey?: ModuleKey;
};

export type NavContribution = {
  role: Role;
  group: string;
  label: string;
  href: string;
  icon: string;
  anyOf: readonly Permission[];
  order: number;
  /** The stored entitlement that gates the item; defaults to the manifest's key (Core items: none). */
  entitlementKey?: ModuleKey;
};

export type CronContribution = { name: string; schedule: { daily: { hourUTC: number; minuteUTC: number } }; fn: string };

/** `dataPreserving: true` is a literal: a migration that deletes business data cannot be declared. */
export type MigrationDeclaration = { id: string; description: string; fn?: string; dataPreserving: true };

/** Versioned event name, e.g. "students.withdrawn@1". None exist yet (§5: specify only). */
export type EventName = `${ModuleId}.${string}@${number}`;

export type ModuleManifest = {
  id: ModuleId;
  version: SemVer;
  entitlementKey: ModuleKey;
  /** Always shipped together with this module; never added to a product automatically. */
  requires: readonly ModuleId[];
  /** Integrations through Core provider contracts only — never imports. */
  optional: readonly ModuleId[];
  /** The only files other owners may import from this module (enforced once set, V9). */
  publicEntries: { frontend?: string; backend?: string };
  /** Repo-relative source roots/files owned by the module (shipped only when selected). */
  sources: readonly string[];
  permissions: readonly Permission[];
  routes: readonly RouteContribution[];
  nav: readonly NavContribution[];
  backend: {
    /** Convex function files; every public function in them uses this module's wrapper. */
    functionFiles: readonly string[];
    /** Tables this module owns; must match the ownership map exactly. */
    tables: readonly string[];
    crons: readonly CronContribution[];
    migrations: readonly MigrationDeclaration[];
  };
  provides: readonly ProviderId[];
  /** Consumed optionally: the consumer must handle "not installed". */
  consumes: readonly ProviderId[];
  contributes?: { dashboardPanels?: readonly string[]; reportTabs?: readonly string[]; studentProfileSections?: readonly string[] };
  events: { emits: readonly EventName[]; listens: readonly EventName[] };
  tests: { unit: readonly string[]; e2e?: readonly string[] };
};

/** Core's own contributions (Core is not a selectable module and always ships). */
export type CoreContributions = {
  permissions: readonly Permission[];
  tables: readonly string[];
  routes: readonly RouteContribution[];
  nav: readonly NavContribution[];
  crons: readonly CronContribution[];
};

/** Identity helper that keeps literal types (e.g. exact ids and permission names). */
export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
