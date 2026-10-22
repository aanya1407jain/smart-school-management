/**
 * School access management (admin: `users:manage`).
 *
 * Accounts are never self-registered: they are created by an administrator
 * (convex/accounts.ts), a data import (convex/imports.ts), the deployment setup
 * (convex/setup.ts) or the demo seed. This module lists memberships and changes
 * their access (suspend / reactivate, optional permission sets).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { schoolQuery, schoolMutation } from "./core/functions";
import { getInSchool, requirePermission } from "./core/authorization";
import { forbidden, invalid } from "./core/errors";
import { vMembershipStatus, vPermissionSet, vRole } from "./core/validators";
import { accountTarget, writeAudit } from "./model/audit";

/**
 * Members of the caller's school (admin), newest first, PAGINATED — a school
 * has one membership per staff member and student (thousands).
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
        _id: m._id, loginId: m.loginId ?? null, email: m.email ?? null, displayName: m.displayName, role: m.role, status: m.status,
        permissionSets: m.permissionSets, teacherId: m.teacherId ?? null, studentId: m.studentId ?? null,
        /** A removed guardian sign-in awaiting migrations:removeGuardianAccounts; never grants access. */
        legacy: !!m.guardianId,
        activatedAt: m.activatedAt ?? null,
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
    if (target.guardianId) throw invalid("This sign-in type no longer exists; accounts are for administrators, teachers and students only.");
    if (status && target.status === "invited") throw invalid("This account has no credentials yet. Issue a temporary password first.");
    if (status === "active" && !target.userId) throw invalid("This account has no credentials yet. Issue a temporary password first.");
    if (permissionSets && target.role !== "admin") throw invalid("Permission sets can only be added to administrative memberships.");
    await ctx.db.patch(target._id, { ...(status ? { status } : {}), ...(permissionSets ? { permissionSets } : {}) });
    // Same rule as accounts.setStatus: suspending signs the account out everywhere.
    if (status === "suspended" && target.status !== "suspended" && target.userId) {
      await ctx.scheduler.runAfter(0, internal.accounts.revokeSessions, { userId: target.userId });
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "membership.access_changed",
      entity: { table: "schoolMemberships", id: target._id },
      summary: `Changed access for ${target.displayName}`,
      metadata: { ...accountTarget(target), from: { status: target.status, permissionSets: target.permissionSets }, to: { status: status ?? target.status, permissionSets: permissionSets ?? target.permissionSets } },
    });
    return { ok: true };
  },
});
