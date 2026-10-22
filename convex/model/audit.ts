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
 * Audit rows are append-only: there is no update/delete function for them.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Role } from "../core/permissions";

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
  actor?: { userId: Id<"users">; role?: Role } | null;
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

export async function writeAudit(ctx: MutationCtx, input: AuditInput): Promise<Id<"auditLogs">> {
  return await ctx.db.insert("auditLogs", {
    schoolId: input.schoolId,
    actorUserId: input.actor?.userId,
    actorRole: input.actor?.role,
    action: input.action,
    entity: input.entity,
    summary: input.summary,
    metadata: input.metadata,
  });
}
