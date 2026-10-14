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
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { Role } from "../core/permissions";

export type AuditInput = {
  schoolId: Id<"schools">;
  actor?: { userId: Id<"users">; role?: Role } | null;
  action: string;
  entity: { table: string; id: string };
  summary: string;
  metadata?: Record<string, unknown>;
};

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
