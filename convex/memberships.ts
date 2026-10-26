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
import { vAction, vMembershipStatus, vPermissionSet, vRole } from "./core/validators";
import { vModuleKey } from "./core/modules";
import { ACCOUNTANT_ACCESS, describeAccess, grantProblems, normalizeGrants, type Grant } from "./core/grants";
import { resolvePermissions } from "./core/permissions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
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
    // "Accountant only" is stored as the Accountant grants preset (core/grants.ts), not the legacy
    // permission set; any other permission-set change (e.g. [] = full administrator) clears grants.
    const access = !permissionSets ? {}
      : permissionSets.includes("accountant") ? { permissionSets: [], grants: ACCOUNTANT_ACCESS.grants, accessProfile: ACCOUNTANT_ACCESS.accessProfile, sectionScope: undefined }
      : { permissionSets, grants: undefined, accessProfile: undefined, sectionScope: undefined };
    await ctx.db.patch(target._id, { ...(status ? { status } : {}), ...access });
    // Same rule as accounts.setStatus: suspending signs the account out everywhere.
    if (status === "suspended" && target.status !== "suspended" && target.userId) {
      await ctx.scheduler.runAfter(0, internal.accounts.revokeSessions, { userId: target.userId });
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "membership.access_changed",
      entity: { table: "schoolMemberships", id: target._id },
      summary: `Changed access for ${target.displayName}`,
      metadata: {
        ...accountTarget(target),
        from: { status: target.status, permissionSets: target.permissionSets, grants: target.grants ?? null },
        to: { status: status ?? target.status, ...("grants" in access ? { permissionSets: access.permissionSets, grants: access.grants ?? null } : { permissionSets: target.permissionSets, grants: target.grants ?? null }) },
      },
    });
    return { ok: true };
  },
});

// ================================================================ staff permissions (the Principal)
/**
 * Who may manage staff permissions: a FULL administrator (`users:manage`,
 * which is never grantable — core/grants.ts PRINCIPAL_ONLY). Restricted
 * office logins and teachers never hold it, so nobody can raise their own
 * or anyone's access beyond what a full administrator decides.
 */
function requirePermissionManager(actor: { permissions: ReadonlySet<string>; restricted: boolean; role: string }) {
  if (actor.role !== "admin" || actor.restricted || !actor.permissions.has("users:manage")) {
    throw forbidden("Only a full administrator (the Principal) can manage staff permissions.");
  }
}

const MAX_STAFF = 2000;

function accessView(m: Doc<"schoolMemberships">) {
  const grants = m.grants === undefined ? undefined : normalizeGrants(m.grants);
  return {
    fullAdministrator: m.role === "admin" && m.grants === undefined && !m.permissionSets.includes("accountant"),
    legacyAccountant: m.role === "admin" && m.grants === undefined && m.permissionSets.includes("accountant"),
    grants: grants ?? [],
    accessProfile: m.accessProfile ?? null,
    sectionIds: m.sectionScope ?? [],
    summary: describeAccess(m.role, grants, m.permissionSets),
  };
}

async function sectionLabels(ctx: QueryCtx, ids: readonly Id<"sections">[]) {
  const out: { sectionId: Id<"sections">; label: string }[] = [];
  for (const id of ids) {
    const s = await ctx.db.get(id);
    out.push({ sectionId: id, label: s?.displayName ?? "(removed section)" });
  }
  return out;
}

/** Staff logins (admin + teacher memberships) with their access, for the Staff & Permissions page. */
export const staffAccess = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermissionManager(ctx.actor);
    const rows: Doc<"schoolMemberships">[] = [];
    for (const role of ["admin", "teacher"] as const) {
      const part = await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("role", role)).take(MAX_STAFF + 1);
      if (part.length > MAX_STAFF) throw invalid(`More than ${MAX_STAFF} ${role} logins; this list needs pagination.`);
      rows.push(...part.filter((m) => !m.guardianId));
    }
    const out = [];
    for (const m of rows) {
      const teacher = m.teacherId ? await ctx.db.get(m.teacherId) : null;
      out.push({
        membershipId: m._id,
        displayName: m.displayName,
        loginId: m.loginId ?? null,
        role: m.role,
        status: m.status,
        hasCredentials: !!m.userId,
        isSelf: m._id === ctx.actor.membershipId,
        teacherEmployeeId: teacher && teacher.schoolId === ctx.actor.schoolId ? teacher.employeeId : null,
        ...accessView(m),
        sections: await sectionLabels(ctx, m.sectionScope ?? []),
        permissionCount: resolvePermissions(m.role, m.permissionSets, { grants: m.grants, sectionLimited: m.role === "teacher" && (m.sectionScope?.length ?? 0) > 0 }).size,
      });
    }
    return out.sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin") || a.displayName.localeCompare(b.displayName));
  },
});

/**
 * Set a staff member's grants (the Principal). `fullAdministrator: true` (admin
 * logins only) removes all restrictions; otherwise the member gets exactly
 * `grants` (office logins) or teaching + `grants` (teachers). `sectionIds`
 * limits a teacher's Students/Attendance view grants to those sections.
 * Rejected: own access, students, unknown/unavailable/partial cells, section
 * limits on office logins. Takes effect on the member's next request (the
 * server re-reads the membership every call). Audited with before/after.
 */
export const setPermissions = schoolMutation({
  args: {
    targetMembershipId: v.id("schoolMemberships"),
    fullAdministrator: v.optional(v.boolean()),
    grants: v.array(v.object({ module: vModuleKey, actions: v.array(vAction) })),
    accessProfile: v.optional(v.union(v.string(), v.null())),
    sectionIds: v.optional(v.array(v.id("sections"))),
  },
  handler: async (ctx, a) => {
    requirePermissionManager(ctx.actor);
    const target = await getInSchool(ctx, "schoolMemberships", a.targetMembershipId, "Member");
    if (target._id === ctx.actor.membershipId) throw forbidden("You cannot change your own access.");
    if (target.guardianId) throw invalid("This sign-in type no longer exists; accounts are for administrators, teachers and students only.");
    if (target.role === "student") throw invalid("Student accounts cannot be given staff permissions.");
    const full = a.fullAdministrator === true;
    if (full && target.role !== "admin") throw invalid("Only administrator logins can be full administrators.");
    if (full && (a.grants.length || a.sectionIds?.length)) throw invalid("A full administrator has every permission; clear the module grants first.");
    const sectionIds = [...new Set(a.sectionIds ?? [])];
    const problems = full ? [] : grantProblems(target.role, a.grants, sectionIds.length > 0);
    if (problems.length) throw invalid(problems.join(" "), { grants: problems.join(" ") });
    for (const id of sectionIds) await getInSchool(ctx, "sections", id, "Section");
    const profile = a.accessProfile?.trim() || undefined;
    if (profile && profile.length > 60) throw invalid("The access label is too long (60 characters at most).", { accessProfile: "Too long" });

    const grants: Grant[] | undefined = full ? undefined : normalizeGrants(a.grants);
    const before = accessView(target);
    await ctx.db.patch(target._id, {
      grants: target.role === "teacher" && grants && grants.length === 0 ? undefined : grants,
      accessProfile: full ? undefined : profile,
      sectionScope: sectionIds.length ? sectionIds : undefined,
      // Grants replace the legacy accountant set on admin logins.
      ...(target.role === "admin" ? { permissionSets: [] } : {}),
    });
    const after = accessView((await ctx.db.get(target._id))!);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "membership.permissions_changed",
      entity: { table: "schoolMemberships", id: target._id },
      summary: `Changed permissions for ${target.displayName}: ${after.summary}`,
      metadata: {
        ...accountTarget(target),
        from: { summary: before.summary, fullAdministrator: before.fullAdministrator, grants: before.grants, accessProfile: before.accessProfile, sectionIds: before.sectionIds },
        to: { summary: after.summary, fullAdministrator: after.fullAdministrator, grants: after.grants, accessProfile: after.accessProfile, sectionIds: after.sectionIds },
      },
    });
    return { ok: true, summary: after.summary };
  },
});

/** Recent permission and access changes (newest first), optionally for one member. */
export const permissionHistory = schoolQuery({
  args: { targetMembershipId: v.optional(v.id("schoolMemberships")), limit: v.optional(v.number()) },
  handler: async (ctx, { targetMembershipId, limit }) => {
    requirePermissionManager(ctx.actor);
    const take = Math.min(Math.max(Math.floor(limit ?? 50), 1), 200);
    const actions = ["membership.permissions_changed", "membership.access_changed"];
    let rows: Doc<"auditLogs">[];
    if (targetMembershipId) {
      const target = await getInSchool(ctx, "schoolMemberships", targetMembershipId, "Member");
      rows = (await ctx.db.query("auditLogs").withIndex("by_school_entity", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("entity.table", "schoolMemberships").eq("entity.id", target._id)).order("desc").take(take * 4))
        .filter((r) => actions.includes(r.action));
    } else {
      rows = [];
      for (const action of actions) rows.push(...(await ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("action", action)).order("desc").take(take)));
    }
    rows.sort((x, y) => y._creationTime - x._creationTime);
    const names = new Map<string, string>();
    const out = [];
    for (const r of rows.slice(0, take)) {
      let by = "System";
      if (r.actorUserId) {
        const key = r.actorUserId as string;
        if (!names.has(key)) {
          const m = (await ctx.db.query("schoolMemberships").withIndex("by_user", (x) => x.eq("userId", r.actorUserId!)).collect()).find((x) => x.schoolId === ctx.actor.schoolId);
          names.set(key, m?.displayName ?? "Former member");
        }
        by = names.get(key)!;
      }
      out.push({ auditId: r._id, at: r._creationTime, action: r.action, summary: r.summary, by, targetMembershipId: r.entity.id, metadata: r.metadata ?? null });
    }
    return out;
  },
});
