/**
 * Membership rules (server-only helpers, not public functions).
 * Account creation lives in ./accounts.ts.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AppError } from "../core/errors";

/** Validate the role ↔ person-link invariant of a membership. */
export function assertMembershipShape(m: Pick<Doc<"schoolMemberships">, "role" | "teacherId" | "studentId" | "guardianId">) {
  if (m.role === "teacher" && !m.teacherId) {
    throw new AppError("INVALID_RELATIONSHIP", "A teacher membership must be linked to a teacher record.");
  }
  if (m.role === "student" && !!m.studentId === !!m.guardianId) {
    throw new AppError("INVALID_RELATIONSHIP", "A student-portal membership must link exactly one student OR one guardian.");
  }
  if (m.role !== "student" && (m.studentId || m.guardianId)) {
    throw new AppError("INVALID_RELATIONSHIP", "Only student-portal memberships can link a student or guardian.");
  }
}

/** True when the user is enabled and has ≥1 active membership in an active school. */
export async function hasActiveAccess(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || user.disabled) return false;
  const memberships = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const m of memberships) {
    if (m.status !== "active") continue;
    const school = await ctx.db.get(m.schoolId);
    if (school?.status === "active") return true;
  }
  return false;
}
