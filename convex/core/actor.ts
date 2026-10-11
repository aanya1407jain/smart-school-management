/**
 * The authenticated actor — WHO is calling and in WHICH school.
 *
 * Derived entirely server-side:
 *   Convex Auth session → users row → active schoolMemberships → school
 *
 * The client may pass `membershipId` only to CHOOSE between its own active
 * memberships (e.g. a teacher who is also a guardian at the same school, or a
 * parent with children at two schools). It is verified to belong to the
 * signed-in user; it can never grant access.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { noSchoolAccess, schoolSelectionRequired, unauthenticated } from "./errors";
import { resolvePermissions, type Permission, type Role } from "./permissions";

export type Actor = {
  userId: Id<"users">;
  membershipId: Id<"schoolMemberships">;
  schoolId: Id<"schools">;
  role: Role;
  permissions: ReadonlySet<Permission>;
  permissionSets: readonly string[];
  displayName: string;
  email: string;
  /** Set for teacher memberships (and admins who also teach). */
  teacherId?: Id<"teachers">;
  /** Set when the member IS a student. */
  studentId?: Id<"students">;
  /** Set when the member is a guardian using the student portal. */
  guardianId?: Id<"guardians">;
};

/** The signed-in user row, or null. Does not require a membership. */
export async function getCurrentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user || user.disabled) return null;
  return user;
}

export async function requireAuthenticatedUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

/** All ACTIVE memberships of the user in ACTIVE schools. */
export async function activeMembershipsOf(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  const result: { membership: Doc<"schoolMemberships">; school: Doc<"schools"> }[] = [];
  for (const membership of rows) {
    if (membership.status !== "active") continue;
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
    permissions: resolvePermissions(m.role, m.permissionSets),
    permissionSets: m.permissionSets,
    displayName: m.displayName,
    email: m.email,
    teacherId: m.teacherId,
    studentId: m.studentId,
    guardianId: m.guardianId,
  };
}

/**
 * Resolve the actor for a school-scoped function.
 * Throws UNAUTHENTICATED / NO_SCHOOL_ACCESS / SCHOOL_SELECTION_REQUIRED.
 */
export async function requireActor(ctx: QueryCtx, membershipId?: Id<"schoolMemberships">): Promise<Actor> {
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
  return actorFromMembership(user, chosen.membership);
}
