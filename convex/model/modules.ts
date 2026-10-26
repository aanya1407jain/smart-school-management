/**
 * Per-school module entitlements: reading the state and enforcing it.
 *
 * ENTITLEMENT POLICY (fail-closed, deterministic):
 *
 *  1. Unconfigured school — no `schoolModules` row at all (every school that
 *     existed before entitlements, incl. the demo school): "legacy" mode. It
 *     keeps exactly the modules it has always had: the keys whose catalogue
 *     entry says `legacyDefault: true` (the five original modules). A module
 *     introduced later is added with `legacyDefault: false`, so a missing
 *     configuration never grants it.
 *  2. Configured school — at least one row: "configured" mode. A module is
 *     enabled ONLY if it has a row with `enabled: true`. Anything else is
 *     disabled:
 *       - no row for that key (incomplete configuration, or a key added after
 *         the school was configured);
 *       - several rows for the same key that are not all `enabled: true`
 *         (malformed — e.g. edited by hand in the dashboard).
 *     The operator mutation (convex/schoolModules.ts) always writes one row
 *     per key, so a configured school is complete unless edited by hand.
 *  3. Dependencies are enforced on read too: a module whose required module
 *     is disabled counts as disabled (e.g. Finance without Student Management).
 *
 * Disabling never deletes anything: the module's tables, files and history
 * stay as they are and come back when the module is enabled again.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AppError, invalid, notFound } from "../core/errors";
import { MODULE_KEYS, MODULES, selectionProblems, type ModuleKey } from "../core/modules";
import { writeAudit } from "./audit";

export type ModuleState = {
  mode: "legacy" | "configured";
  enabled: ReadonlySet<ModuleKey>;
  /** Why a configured school's state is not what a clean configuration would give (for operators). */
  problems: string[];
};

/** A catalogue as the policy needs it (the real one is core/modules.ts; tests can pass a hypothetical one). */
export type ModuleCatalogue<K extends string> = {
  keys: readonly K[];
  defs: Record<K, { requires: readonly K[]; legacyDefault: boolean }>;
};

/**
 * THE policy, as a pure function of the school's rows and the catalogue (see
 * the header). Kept pure so the rules — including "a future module is off by
 * default" — can be tested with a catalogue that has a module the real one
 * does not have yet.
 */
export function resolveModuleState<K extends string>(
  rows: readonly { module: string; enabled: boolean }[],
  catalogue: ModuleCatalogue<K>,
): { mode: "legacy" | "configured"; enabled: Set<K>; problems: string[] } {
  const { keys, defs } = catalogue;
  const problems: string[] = [];
  let enabled: Set<K>;
  if (rows.length === 0) {
    enabled = new Set(keys.filter((k) => defs[k].legacyDefault));
  } else {
    enabled = new Set();
    for (const key of keys) {
      const forKey = rows.filter((r) => r.module === key);
      if (forKey.length === 0) {
        problems.push(`No setting for "${key}": treated as disabled.`);
        continue;
      }
      if (forKey.length > 1) problems.push(`${forKey.length} settings for "${key}": enabled only if all say enabled.`);
      if (forKey.every((r) => r.enabled === true)) enabled.add(key);
    }
    for (const r of rows) if (!(keys as readonly string[]).includes(r.module)) problems.push(`Unknown module "${String(r.module)}" ignored.`);
  }
  // Dependencies, fail-closed (repeat until stable).
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...enabled]) {
      const missing = defs[key].requires.filter((dep) => !enabled.has(dep));
      if (missing.length) {
        enabled.delete(key);
        changed = true;
        problems.push(`"${key}" is off because it requires ${missing.map((m) => `"${m}"`).join(", ")}.`);
      }
    }
  }
  return { mode: rows.length === 0 ? "legacy" : "configured", enabled, problems };
}

const CATALOGUE: ModuleCatalogue<ModuleKey> = { keys: MODULE_KEYS, defs: MODULES };

export async function moduleStateOf(ctx: QueryCtx, schoolId: Id<"schools">): Promise<ModuleState> {
  const rows = await ctx.db.query("schoolModules").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  return resolveModuleState(rows, CATALOGUE);
}

export async function isModuleEnabled(ctx: QueryCtx, schoolId: Id<"schools">, key: ModuleKey): Promise<boolean> {
  return (await moduleStateOf(ctx, schoolId)).enabled.has(key);
}

export const moduleDisabled = (key: ModuleKey) =>
  new AppError("MODULE_DISABLED", `${MODULES[key].label} is not enabled for your school.`, { module: key });

/** Throws MODULE_DISABLED unless every listed module is enabled for the school. */
export async function requireModule(ctx: QueryCtx, schoolId: Id<"schools">, ...keys: ModuleKey[]): Promise<void> {
  const state = await moduleStateOf(ctx, schoolId);
  for (const key of keys) if (!state.enabled.has(key)) throw moduleDisabled(key);
}

/** Enabled module keys in catalogue order (what the session sends to the browser). */
export function enabledList(state: ModuleState): ModuleKey[] {
  return MODULE_KEYS.filter((k) => state.enabled.has(k));
}

/**
 * Write a complete module selection for a school (operator paths only:
 * schoolModules.setSchoolModules and setup.createSchoolAndAdmin). Validates
 * keys and dependencies (nothing is auto-enabled), writes exactly one row per
 * catalogue key, audits the change, and never touches any module's data.
 */
export async function applyModuleSelection(
  ctx: MutationCtx,
  input: { schoolId: Id<"schools">; enabled: readonly string[]; updatedBy: string; reason: string },
) {
  const updatedBy = input.updatedBy.trim();
  const reason = input.reason.trim();
  if (!updatedBy) throw invalid("Say who is making this change (updatedBy).", { updatedBy: "Required" });
  if (!reason) throw invalid("Give a reason for this change.", { reason: "Required" });
  if (updatedBy.length > 120 || reason.length > 500) throw invalid("updatedBy or reason is too long.");
  const problems = selectionProblems(input.enabled);
  if (problems.length) throw invalid(problems.join(" "), { enabled: problems.join(" ") });
  const school = await ctx.db.get(input.schoolId);
  if (!school) throw notFound("School");

  const before = await moduleStateOf(ctx, input.schoolId);
  const wanted = new Set(input.enabled as ModuleKey[]);
  const now = Date.now();
  const rows = await ctx.db.query("schoolModules").withIndex("by_school", (q) => q.eq("schoolId", input.schoolId)).collect();
  let written = 0;
  for (const key of MODULE_KEYS) {
    const enabled = wanted.has(key);
    const forKey = rows.filter((r) => r.module === key);
    if (forKey.length === 0) {
      await ctx.db.insert("schoolModules", { schoolId: input.schoolId, module: key, enabled, updatedAt: now, updatedBy, reason });
      written++;
      continue;
    }
    for (const r of forKey) {
      if (r.enabled !== enabled) {
        await ctx.db.patch(r._id, { enabled, updatedAt: now, updatedBy, reason });
        written++;
      }
    }
  }
  const after = await moduleStateOf(ctx, input.schoolId);
  const beforeList = enabledList(before);
  const afterList = enabledList(after);
  const changed = written > 0 || before.mode !== after.mode;
  if (changed) {
    await writeAudit(ctx, {
      schoolId: input.schoolId,
      actor: null, // operator (deployment admin), not a school member
      action: "school.modules_changed",
      entity: { table: "schools", id: input.schoolId },
      summary: `Modules set to: ${afterList.length ? afterList.map((k) => MODULES[k].label).join(", ") : "none"}`,
      metadata: {
        before: { mode: before.mode, enabled: beforeList },
        after: { mode: after.mode, enabled: afterList },
        enabledNow: afterList.filter((k) => !beforeList.includes(k)),
        disabledNow: beforeList.filter((k) => !afterList.includes(k)),
        updatedBy,
        reason,
      },
    });
  }
  return { changed, mode: after.mode, enabled: afterList, disabled: MODULE_KEYS.filter((k) => !after.enabled.has(k)) };
}
