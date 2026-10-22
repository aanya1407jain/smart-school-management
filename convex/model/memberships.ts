/**
 * Membership rules (server-only helpers, not public functions).
 * Account creation lives in ./accounts.ts.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AppError } from "../core/errors";
import { isRole } from "../core/permissions";

/** Validate the role ↔ person-link invariant of a membership. */
export function assertMembershipShape(m: Pick<Doc<"schoolMemberships">, "role" | "teacherId" | "studentId" | "guardianId">) {
  if (m.guardianId) {
    throw new AppError("INVALID_RELATIONSHIP", "Accounts can only be created for administrators, teachers and students.");
  }
  if (m.role === "teacher" && !m.teacherId) {
    throw new AppError("INVALID_RELATIONSHIP", "A teacher membership must be linked to a teacher record.");
  }
  if (m.role === "student" && !m.studentId) {
    throw new AppError("INVALID_RELATIONSHIP", "A student membership must be linked to a student record.");
  }
  if (m.role !== "student" && m.studentId) {
    throw new AppError("INVALID_RELATIONSHIP", "Only student memberships can link a student.");
  }
}

/**
 * A membership that grants access: active, one of the three account roles
 * (admin, teacher, student), and not a legacy guardian sign-in (removed
 * account type — never grants access, even before the migration deletes it).
 * A student record link on a non-student membership is refused too, so no
 * admin/teacher login can pick up "own student" rights. Enforced on the server
 * for every function that resolves the caller (core/actor.ts) and at sign-in,
 * not by hiding UI. (A student login whose record link is missing keeps its
 * session but reads nothing: the portal reports `no_student_record`.)
 */
export function grantsAccess(m: Pick<Doc<"schoolMemberships">, "status" | "guardianId" | "role" | "studentId">): boolean {
  if (m.status !== "active" || m.guardianId || !isRole(m.role)) return false;
  return m.role === "student" || !m.studentId;
}

/** True when the user is enabled and has ≥1 active membership in an active school. */
export async function hasActiveAccess(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user || user.disabled) return false;
  const memberships = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const m of memberships) {
    if (!grantsAccess(m)) continue;
    const school = await ctx.db.get(m.schoolId);
    if (school?.status === "active") return true;
  }
  return false;
}
