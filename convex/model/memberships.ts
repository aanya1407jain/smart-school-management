/**
 * Membership & invitation rules (server-only helpers, not public functions).
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AppError } from "../core/errors";
import { normalizeEmail } from "../core/validators";
import { writeAudit } from "./audit";

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** SHA-256 hex of an invitation code. Codes are case-insensitive and dash-insensitive. */
export async function hashInviteCode(code: string): Promise<string> {
  const canonical = code.replace(/[\s-]/g, "").toUpperCase();
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Human-friendly one-time code, e.g. "K7QF-2M9X-HC4P". Generate ONLY in an
 * action or a Node script (true randomness), never in a query/mutation.
 */
export function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

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

const GENERIC_INVITE_ERROR = () =>
  new AppError("FORBIDDEN", "Accounts are created by your school. Check your email and invitation code, or ask the school office for a new code.");

/**
 * Sign-up path: find invited memberships for this email whose code matches,
 * create (or reuse) the user and activate those memberships. Never reveals
 * whether the email has an invitation.
 */
export async function activateInvitationsForNewUser(
  ctx: MutationCtx,
  { email: rawEmail, inviteCode }: { email: string; inviteCode: string },
): Promise<Id<"users">> {
  const email = normalizeEmail(rawEmail);
  if (!inviteCode) throw GENERIC_INVITE_ERROR();
  const codeHash = await hashInviteCode(inviteCode);
  const now = Date.now();

  const invited = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_email_status", (q) => q.eq("email", email).eq("status", "invited"))
    .collect();
  const matching = invited.filter((m) => m.inviteCodeHash === codeHash && (m.inviteExpiresAt ?? 0) > now);
  if (matching.length === 0) throw GENERIC_INVITE_ERROR();

  const existing = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
  const userId = existing?._id ?? (await ctx.db.insert("users", { email, name: matching[0].displayName }));

  for (const m of matching) {
    await ctx.db.patch(m._id, {
      userId,
      status: "active",
      activatedAt: now,
      inviteCodeHash: undefined,
      inviteExpiresAt: undefined,
    });
    await writeAudit(ctx, {
      schoolId: m.schoolId,
      actor: { userId, role: m.role },
      action: "membership.activated",
      entity: { table: "schoolMemberships", id: m._id },
      summary: `${m.displayName} activated their ${m.role} account`,
    });
  }
  return userId;
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
