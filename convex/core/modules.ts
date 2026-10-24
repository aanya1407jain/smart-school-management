/**
 * School module catalogue — THE single definition of the configurable product
 * modules, shared by the Convex backend (enforcement) and the frontend
 * (navigation, route guard). Pure: no database access here; the per-school
 * state is read in convex/model/modules.ts.
 *
 * Three separate concepts, never mixed:
 *   - module entitlement (this file + `schoolModules`): what the SCHOOL may use;
 *   - account role (admin | teacher | student): which workspace a person uses;
 *   - permissions (core/permissions.ts): what that PERSON may do.
 * An enabled module never grants a permission; a disabled module blocks its
 * functions for everyone in that school, whatever their permissions.
 *
 * The shared core is not a module and is never disabled: sign-in and accounts,
 * staff access, school profile and settings, academic structure (years,
 * classes, sections, subjects, class/subject teachers), teacher records,
 * student records as the identity other modules point at (read-only profile
 * views), notifications, school/profile files, the audit log, and the role
 * dashboards (whose module panels are gated individually).
 *
 * Module keys are stable identifiers stored in the database — never rename or
 * reuse one. A NEW key must be added with `legacyDefault: false` so schools
 * that were never configured do not silently gain it (see model/modules.ts).
 */
import { v, type Infer } from "convex/values";

export const MODULE_KEYS = ["students", "academics", "attendance", "finance", "administration"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const vModuleKey = v.union(
  v.literal("students"),
  v.literal("academics"),
  v.literal("attendance"),
  v.literal("finance"),
  v.literal("administration"),
);
// Compile-time guard: the validator must list exactly MODULE_KEYS.
const _keysMatch: readonly Infer<typeof vModuleKey>[] = MODULE_KEYS;
void _keysMatch;

export type ModuleDefinition = {
  label: string;
  description: string;
  /** Modules that must also be enabled. Never enabled automatically: a selection missing one is rejected. */
  requires: readonly ModuleKey[];
  /**
   * Enabled for a school that has NO module configuration at all (schools that
   * existed before entitlements). True only for the five original modules.
   */
  legacyDefault: boolean;
};

export const MODULES: Record<ModuleKey, ModuleDefinition> = {
  students: {
    label: "Student Management",
    description: "Admissions, student list and totals, enrollment, transfers and withdrawals, student imports and documents.",
    requires: [],
    legacyDefault: true,
  },
  academics: {
    label: "Academics & Examinations",
    description: "Examinations, marks, results and report cards, timetable, homework.",
    requires: ["students"],
    legacyDefault: true,
  },
  attendance: {
    label: "Attendance & Operations",
    description: "Student attendance, staff attendance and leave.",
    requires: ["students"],
    legacyDefault: true,
  },
  finance: {
    label: "Accounts & Finance",
    description: "Fee structures, concessions, payments, receipts, balances, fee reports and reminders.",
    requires: ["students"],
    legacyDefault: true,
  },
  administration: {
    label: "Administration & Insights",
    description: "Notices and events, the reports pages.",
    requires: [],
    legacyDefault: true,
  },
};

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Check a requested selection: no unknown or repeated keys, every dependency
 * present. Returns the problems (empty = valid); nothing is auto-enabled.
 */
export function selectionProblems(selection: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const key of selection) {
    if (!isModuleKey(key)) problems.push(`Unknown module "${key}".`);
    else if (seen.has(key)) problems.push(`Module "${key}" is listed twice.`);
    seen.add(key);
  }
  for (const key of MODULE_KEYS) {
    if (!seen.has(key)) continue;
    for (const dep of MODULES[key].requires) {
      if (!seen.has(dep)) problems.push(`${MODULES[key].label} requires ${MODULES[dep].label}.`);
    }
  }
  return problems;
}
