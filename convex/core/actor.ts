/**
 * The authenticated actor — WHO is calling and in WHICH school.
 *
 * Derived entirely server-side:
 *   Convex Auth session → users row → active schoolMemberships → school
 *
 * The client may pass `membershipId` only to CHOOSE between its own active
 * memberships (e.g. a principal who works at two schools). It is verified to belong to the
 * signed-in user; it can never grant access.
 */
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { noSchoolAccess, passwordChangeRequired, schoolSelectionRequired, unauthenticated } from "./errors";
import { resolvePermissions, type Permission, type Role } from "./permissions";
import { grantsAccess } from "../model/memberships";

export type Actor = {
  userId: Id<"users">;
  membershipId: Id<"schoolMemberships">;
  schoolId: Id<"schools">;
  role: Role;
  permissions: ReadonlySet<Permission>;
  permissionSets: readonly string[];
  displayName: string;
  /** Canonical Login ID of the signed-in identity. */
  loginId: string | null;
  /** Optional contact email (never used for authorization). */
  email: string | null;
  /** Set for teacher memberships (and admins who also teach). */
  teacherId?: Id<"teachers">;
  /** Set when the member IS a student. */
  studentId?: Id<"students">;
  /**
   * Teachers only: extra sections the Principal limited this member's
   * Students/Attendance VIEW grants to (core/grants.ts). They widen the
   * member's READ scope (core/authorization.ts readScopeSectionIds) and never
   * teaching duties (marking, homework, marks entry).
   */
  sectionScope: readonly Id<"sections">[];
  /** The member's grants are a restricted office login (admin membership with grants). */
  restricted: boolean;
};

/**
 * The signed-in user row, or null. Does not require a membership.
 * The session behind the token must still exist: sign-out everywhere
 * (password reset, password change, disabling) takes effect immediately
 * instead of when the short-lived access token expires.
 */
export async function getCurrentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (!sessionId || !(await ctx.db.get(sessionId))) return null;
  const user = await ctx.db.get(userId);
  if (!user || user.disabled) return null;
  return user;
}

export async function requireAuthenticatedUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

/** All ACTIVE memberships of the user in ACTIVE schools (legacy guardian sign-ins never count). */
export async function activeMembershipsOf(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  const result: { membership: Doc<"schoolMemberships">; school: Doc<"schools"> }[] = [];
  for (const membership of rows) {
    if (!grantsAccess(membership)) continue;
    const school = await ctx.db.get(membership.schoolId);
    if (school && school.status === "active") result.push({ membership, school });
  }
  return result;
}

export function actorFromMembership(user: Doc<"users">, m: Doc<"schoolMemberships">): Actor {
  return {
    userId: user._id,
    membershipId: m._id,
    schoolId: m.schoolId,
    role: m.role,
    permissions: resolvePermissions(m.role, m.permissionSets, {
      grants: m.role === "student" ? undefined : m.grants,
      sectionLimited: m.role === "teacher" && (m.sectionScope?.length ?? 0) > 0,
    }),
    permissionSets: m.permissionSets,
    displayName: m.displayName,
    loginId: user.loginId ?? m.loginId ?? null,
    email: m.email ?? user.email ?? null,
    teacherId: m.teacherId,
    studentId: m.studentId,
    sectionScope: m.role === "teacher" ? (m.sectionScope ?? []) : [],
    restricted: m.role === "admin" && (m.grants !== undefined || m.permissionSets.includes("accountant")),
  };
}

/**
 * Resolve the actor for a school-scoped function.
 * Throws UNAUTHENTICATED / NO_SCHOOL_ACCESS / SCHOOL_SELECTION_REQUIRED, and
 * PASSWORD_CHANGE_REQUIRED while the account still uses a temporary password
 * (only `users.session` opts out, so the UI can send the person to the
 * password change; `account.changePassword` does not use an actor).
 */
export async function requireActor(
  ctx: QueryCtx,
  membershipId?: Id<"schoolMemberships">,
  options: { allowPendingPasswordChange?: boolean } = {},
): Promise<Actor> {
  const user = await requireAuthenticatedUser(ctx);
  const memberships = await activeMembershipsOf(ctx, user._id);
  if (memberships.length === 0) throw noSchoolAccess();

  let chosen: (typeof memberships)[number] | undefined;
  if (membershipId) {
    chosen = memberships.find((x) => x.membership._id === membershipId);
    // Same error whether the membership is someone else's, inactive or nonexistent.
    if (!chosen) throw noSchoolAccess();
  } else if (memberships.length === 1) {
    chosen = memberships[0];
  } else {
    throw schoolSelectionRequired();
  }
  if (user.mustChangePassword && !options.allowPendingPasswordChange) throw passwordChangeRequired();
  return actorFromMembership(user, chosen.membership);
}
