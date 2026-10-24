/**
 * Reading the school's module entitlements out of the server session
 * (`users.session` → `viewer.modules`) without trusting its shape.
 *
 * The browser bundle and the Convex deployment are released separately, so the
 * session can come from a backend that predates entitlements (no `modules`
 * field at all) or be malformed. Every such case FAILS CLOSED: the result never
 * contains a module the server did not explicitly list, and the UI is told the
 * list could not be confirmed (`status !== "ok"`) so it can say so instead of
 * claiming the school's plan lacks the module.
 *
 * Demo personas and school-created (live) accounts use the same source: the
 * server session of the account that signed in. There is no client-side
 * default module list.
 *
 * This is UI only. The server enforces entitlements on every module function
 * (convex/core/functions.ts → MODULE_DISABLED) whatever the browser shows.
 */
import { MODULE_KEYS, MODULES, isModuleKey, type ModuleKey } from "@convex/core/modules";
import { PERMISSIONS, type Permission } from "@convex/core/permissions";

export type SessionModulesStatus =
  /** A valid list from the server (it may be empty: a school with no modules). */
  | "ok"
  /** The session has no `modules` field: the backend predates module entitlements. */
  | "missing"
  /** `modules` is present but is not a list of module keys. */
  | "malformed";

export interface SessionModules {
  /** Enabled modules in catalogue order. Empty unless `status` is "ok". */
  modules: ModuleKey[];
  status: SessionModulesStatus;
  /** Keys the server sent that this browser build does not know (ignored, never granted). */
  ignored: string[];
}

/**
 * Parse `viewer.modules`.
 *  - not present (undefined / null)          → "missing", no modules;
 *  - not an array, or any non-string entry   → "malformed", no modules;
 *  - an array of strings                     → "ok": known keys only (unknown ones
 *    — e.g. a module added by a newer backend — are ignored, never granted),
 *    duplicates collapsed, and a module whose required module is absent is
 *    dropped (the server already guarantees this; checked again, fail-closed).
 */
export function parseSessionModules(value: unknown): SessionModules {
  if (value === undefined || value === null) return { modules: [], status: "missing", ignored: [] };
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return { modules: [], status: "malformed", ignored: [] };
  const listed = new Set<ModuleKey>();
  const ignored: string[] = [];
  for (const v of value as string[]) {
    if (isModuleKey(v)) listed.add(v);
    else if (!ignored.includes(v)) ignored.push(v);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...listed]) {
      if (MODULES[key].requires.some((dep) => !listed.has(dep))) {
        listed.delete(key);
        changed = true;
      }
    }
  }
  return { modules: MODULE_KEYS.filter((k) => listed.has(k)), status: "ok", ignored };
}

/**
 * Attach the session's modules to a portal user (demo persona or live account).
 * Whatever `user.modules` held before is replaced: the server session is the
 * only source.
 */
export function withSessionModules<U extends object>(user: U, viewer: { modules?: unknown } | null | undefined): U & { modules: ModuleKey[] } {
  return { ...user, modules: parseSessionModules(viewer?.modules).modules };
}

/**
 * The server's effective permissions for the session (role + sets + grants).
 * Only known permission names are kept; anything else is dropped. Missing or
 * malformed → undefined, and the UI falls back to the role's own permissions
 * (never more than the role; the server enforces either way).
 */
export function parseSessionPermissions(value: unknown): Permission[] | undefined {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return undefined;
  return (value as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
}

/** Attach the session's modules AND server-computed permissions to a portal user. */
export function withServerAccess<U extends object>(user: U, viewer: { modules?: unknown; permissions?: unknown } | null | undefined): U & { modules: ModuleKey[]; permissions?: Permission[] } {
  const permissions = parseSessionPermissions(viewer?.permissions);
  const { permissions: _stale, ...rest } = user as U & { permissions?: unknown };
  void _stale;
  return { ...(rest as U), modules: parseSessionModules(viewer?.modules).modules, ...(permissions ? { permissions } : {}) };
}

export const MODULES_UNCONFIRMED_MESSAGE =
  "Your school's modules could not be confirmed, so module pages are hidden. The school backend may be out of date — please try again later or contact your service provider.";
