/**
 * Audit trail helper. Call from any mutation that changes important data:
 *
 *   await writeAudit(ctx, {
 *     schoolId: actor.schoolId,
 *     actor,                                  // or omit for system jobs
 *     action: "attendance.corrected",         // "<entity>.<past-tense verb>"
 *     entity: { table: "attendanceSessions", id: session._id },
 *     summary: "Corrected 10-A register for 2026-10-09 (2 changes)",
 *     metadata: { changes },                  // small, no secrets/passwords
 *   });
 *
 * Audit rows are append-only: there is no public or internal function that
 * updates or deletes them (the only patch is audit:backfillCategories, which
 * fills the derived `category` of old rows and touches nothing else).
 * `logAuditEvent` is the same helper under the name used in the audit spec.
 *
 * Every row also gets, automatically:
 *   category   — from the action (core/auditCategories.ts), for filtering;
 *   actorName  — the actor's display name in this school at the time.
 * The timestamp is the server-set `_creationTime`; clients never supply it.
 * IP address / user agent are NOT recorded: Convex mutations cannot see them,
 * and values sent by the browser could be forged.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Role } from "../core/permissions";
import { auditCategoryOf } from "../core/auditCategories";

/*
 * Field semantics (auditLogs):
 *   actorUserId / actorRole → WHO performed the operation (the signed-in member,
 *                             e.g. the administrator who created an account).
 *                             Absent for system jobs (seed, migrations).
 *   entity                  → WHAT was changed.
 *   metadata.target*        → for account/membership events, the AFFECTED
 *                             account: targetRole ("student" | "teacher" |
 *                             "admin"), targetKind (same values; "legacy_guardian"
 *                             only for the removed guardian sign-ins) and
 *                             targetLoginId. Never the actor's role.
 */

export type AuditInput = {
  schoolId: Id<"schools">;
  /** Usually `ctx.actor` (its displayName is recorded); `{ userId, role }` also works (name looked up). */
  actor?: { userId: Id<"users">; role?: Role; displayName?: string } | null;
  action: string;
  entity: { table: string; id: string };
  summary: string;
  metadata?: Record<string, unknown>;
};

/** Structured description of the account an account/membership event is about. */
export function accountTarget(m: Pick<Doc<"schoolMemberships">, "role" | "loginId" | "guardianId">) {
  return {
    targetRole: m.role,
    targetKind: m.guardianId ? ("legacy_guardian" as const) : m.role,
    ...(m.loginId ? { targetLoginId: m.loginId } : {}),
  };
}

/**
 * The role a user holds in a school — used when the acting user is known only
 * by id (e.g. the administrator recorded on a reserved account). Undefined if
 * they have no membership there.
 */
export async function roleInSchool(ctx: QueryCtx, userId: Id<"users">, schoolId: Id<"schools">): Promise<Role | undefined> {
  const rows = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  return rows.find((m) => m.schoolId === schoolId)?.role;
}

/** The member's display name in a school (for rows whose actor was given without one). */
async function displayNameInSchool(ctx: QueryCtx, userId: Id<"users">, schoolId: Id<"schools">): Promise<string | undefined> {
  const rows = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  return rows.find((m) => m.schoolId === schoolId)?.displayName;
}

export async function writeAudit(ctx: MutationCtx, input: AuditInput): Promise<Id<"auditLogs">> {
  const actor = input.actor ?? null;
  const actorName = actor ? (actor.displayName ?? (await displayNameInSchool(ctx, actor.userId, input.schoolId))) : undefined;
  return await ctx.db.insert("auditLogs", {
    schoolId: input.schoolId,
    actorUserId: actor?.userId,
    actorRole: actor?.role,
    action: input.action,
    entity: input.entity,
    summary: input.summary,
    metadata: input.metadata,
    category: auditCategoryOf(input.action),
    ...(actorName ? { actorName } : {}),
  });
}

/**
 * `{ before, after }` for the given fields of a record (shown side by side in
 * the audit viewer). Missing values are recorded as null. Never pass secrets.
 */
export function auditDiff(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]) {
  const pick = (o: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f, o[f] ?? null]));
  return { before: pick(before), after: pick(after) };
}

/** Append one audit entry from inside the mutation that made the change (alias of writeAudit). */
export const logAuditEvent = writeAudit;

/**
 * One CSV cell: quoted, inner quotes doubled, and cells a spreadsheet would
 * treat as a formula (= + - @, tab, CR) prefixed with ' (CSV/formula injection).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
