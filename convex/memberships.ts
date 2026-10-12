/**
 * School access management (admin: `users:manage`).
 *
 * Accounts are never self-registered. An admin invites a person to the school
 * with a role and a link to their teacher / student / guardian record. The
 * invite returns a one-time code (shown once, stored only as a hash). The
 * person activates it on the sign-up screen (`flow: "signUp", inviteCode`), or
 * — if they already have an account (e.g. another school) — via
 * `acceptInvitation` while signed in.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { schoolAction, schoolQuery, schoolMutation, userMutation } from "./core/functions";
import { requireActor } from "./core/actor";
import { getInSchool, requirePermission } from "./core/authorization";
import { AppError, conflict, forbidden, invalid } from "./core/errors";
import { assertNonEmpty, normalizeEmail, vMembershipStatus, vPermissionSet, vRole } from "./core/validators";
import { assertMembershipShape, generateInviteCode, hashInviteCode, INVITE_TTL_MS } from "./model/memberships";
import { writeAudit } from "./model/audit";

const inviteArgs = {
  email: v.string(),
  displayName: v.string(),
  role: vRole,
  permissionSets: v.optional(v.array(vPermissionSet)),
  teacherId: v.optional(v.id("teachers")),
  studentId: v.optional(v.id("students")),
  guardianId: v.optional(v.id("guardians")),
};

/**
 * Invite someone to the caller's school. Runs as an action so the code is
 * generated with real randomness; authorization happens in the internal
 * mutation, which runs with the caller's identity.
 */
export const invite = schoolAction({
  args: inviteArgs,
  handler: async (ctx, args): Promise<{ membershipId: Id<"schoolMemberships">; inviteCode: string; expiresAt: number }> => {
    const inviteCode = generateInviteCode();
    const codeHash = await hashInviteCode(inviteCode);
    const result: { membershipId: Id<"schoolMemberships">; expiresAt: number } = await ctx.runMutation(internal.memberships.createInvitation, {
      ...args,
      membershipId: ctx.membershipId,
      codeHash,
    });
    return { ...result, inviteCode };
  },
});

export const createInvitation = internalMutation({
  args: { ...inviteArgs, membershipId: v.optional(v.id("schoolMemberships")), codeHash: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.membershipId);
    requirePermission(actor, "users:manage");
    const scoped = { ...ctx, actor };
    const email = normalizeEmail(args.email);
    const displayName = assertNonEmpty(args.displayName, "displayName", 120);
    assertMembershipShape(args);
    // Linked records must belong to the same school.
    if (args.teacherId) await getInSchool(scoped, "teachers", args.teacherId, "Teacher");
    if (args.studentId) await getInSchool(scoped, "students", args.studentId, "Student");
    if (args.guardianId) await getInSchool(scoped, "guardians", args.guardianId, "Guardian");
    if (args.permissionSets?.length && args.role !== "admin") {
      throw invalid("Permission sets can only be added to administrative memberships.");
    }

    const existing = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_school_email", (q) => q.eq("schoolId", actor.schoolId).eq("email", email))
      .collect();
    if (existing.some((m) => m.role === args.role && m.status !== "suspended" && m.teacherId === args.teacherId && m.studentId === args.studentId && m.guardianId === args.guardianId)) {
      throw conflict("This person already has (or has been invited to) this access.");
    }

    const expiresAt = Date.now() + INVITE_TTL_MS;
    const membershipId = await ctx.db.insert("schoolMemberships", {
      schoolId: actor.schoolId, email, displayName, role: args.role, status: "invited",
      permissionSets: args.permissionSets ?? [], teacherId: args.teacherId, studentId: args.studentId, guardianId: args.guardianId,
      inviteCodeHash: args.codeHash, inviteExpiresAt: expiresAt, invitedByUserId: actor.userId,
    });
    await writeAudit(ctx, {
      schoolId: actor.schoolId, actor, action: "membership.invited",
      entity: { table: "schoolMemberships", id: membershipId },
      summary: `Invited ${displayName} (${email}) as ${args.role}`,
      metadata: { role: args.role, permissionSets: args.permissionSets ?? [] },
    });
    return { membershipId, expiresAt };
  },
});

/** For a user who already has an account: accept an invitation to another school/role. */
export const acceptInvitation = userMutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    if (!ctx.user.email) throw forbidden();
    const codeHash = await hashInviteCode(inviteCode);
    const invited = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_email_status", (q) => q.eq("email", ctx.user.email!).eq("status", "invited"))
      .collect();
    const match = invited.find((m) => m.inviteCodeHash === codeHash && (m.inviteExpiresAt ?? 0) > Date.now());
    if (!match) throw new AppError("FORBIDDEN", "This invitation code is invalid or has expired.");
    await ctx.db.patch(match._id, { userId: ctx.user._id, status: "active", activatedAt: Date.now(), inviteCodeHash: undefined, inviteExpiresAt: undefined });
    await writeAudit(ctx, {
      schoolId: match.schoolId, actor: { userId: ctx.user._id, role: match.role }, action: "membership.activated",
      entity: { table: "schoolMemberships", id: match._id }, summary: `${match.displayName} accepted an invitation`,
    });
    return { membershipId: match._id };
  },
});

/**
 * Members of the caller's school (admin), newest first, PAGINATED — a school
 * has one membership per staff member, student and guardian (thousands).
 * Use with `usePaginatedQuery(api.memberships.list, { role }, { initialNumItems: 50 })`.
 */
export const list = schoolQuery({
  args: { role: v.optional(vRole), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { role, paginationOpts }) => {
    requirePermission(ctx.actor, "users:manage");
    const query = role
      ? ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("role", role))
      : ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", ctx.actor.schoolId));
    const result = await query.order("desc").paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((m) => ({
        _id: m._id, email: m.email, displayName: m.displayName, role: m.role, status: m.status, permissionSets: m.permissionSets,
        teacherId: m.teacherId ?? null, studentId: m.studentId ?? null, guardianId: m.guardianId ?? null,
        activatedAt: m.activatedAt ?? null, inviteExpiresAt: m.inviteExpiresAt ?? null,
      })),
    };
  },
});

/** Suspend / reactivate access or change optional permission sets (role changes are audited). */
export const updateAccess = schoolMutation({
  args: {
    targetMembershipId: v.id("schoolMemberships"),
    status: v.optional(vMembershipStatus),
    permissionSets: v.optional(v.array(vPermissionSet)),
  },
  handler: async (ctx, { targetMembershipId, status, permissionSets }) => {
    requirePermission(ctx.actor, "users:manage");
    const target = await getInSchool(ctx, "schoolMemberships", targetMembershipId, "Member");
    if (target._id === ctx.actor.membershipId) throw forbidden("You cannot change your own access.");
    if (status === "invited") throw invalid("Status can only be set to active or suspended.");
    if (status === "active" && !target.userId) throw invalid("This invitation has not been accepted yet.");
    if (permissionSets && target.role !== "admin") throw invalid("Permission sets can only be added to administrative memberships.");
    await ctx.db.patch(target._id, { ...(status ? { status } : {}), ...(permissionSets ? { permissionSets } : {}) });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "membership.access_changed",
      entity: { table: "schoolMemberships", id: target._id },
      summary: `Changed access for ${target.displayName}`,
      metadata: { from: { status: target.status, permissionSets: target.permissionSets }, to: { status: status ?? target.status, permissionSets: permissionSets ?? target.permissionSets } },
    });
    return { ok: true };
  },
});
