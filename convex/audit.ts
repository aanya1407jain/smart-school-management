/**
 * Read access to the audit trail (admin: `audit:read`). Writing happens only
 * through `writeAudit` (convex/model/audit.ts) inside the mutation that made
 * the change; there are no public write/delete functions.
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { schoolQuery } from "./core/functions";
import { requirePermission } from "./core/authorization";

export const list = schoolQuery({
  args: {
    entity: v.optional(v.object({ table: v.string(), id: v.string() })),
    action: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entity, action, limit }) => {
    requirePermission(ctx.actor, "audit:read");
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    const schoolId = ctx.actor.schoolId;
    if (entity) {
      return await ctx.db.query("auditLogs").withIndex("by_school_entity", (q) => q.eq("schoolId", schoolId).eq("entity.table", entity.table).eq("entity.id", entity.id)).order("desc").take(take);
    }
    if (action) {
      return await ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", schoolId).eq("action", action)).order("desc").take(take);
    }
    return await ctx.db.query("auditLogs").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).order("desc").take(take);
  },
});

/**
 * READ-ONLY check of account creation for one school (internal: CLI/dashboard
 * only). For every `account.created` audit row it reports, side by side:
 *   actorRole  — who created the account (from the audit row), and
 *   targetRole — the role the created membership ACTUALLY has (from
 *                schoolMemberships, not from the audit row),
 * plus whether a student-portal account is linked to a student of the same
 * school. Writes nothing; returns Login IDs only — no names, no secrets.
 *
 *   npx convex run audit:accountCreationReport '{"schoolSlug":"aster-academy"}'
 */
export const accountCreationReport = internalQuery({
  args: { schoolSlug: v.string(), sinceMs: v.optional(v.number()) },
  handler: async (ctx, { schoolSlug, sinceMs }) => {
    const school = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug)).first();
    if (!school) return { found: false as const };
    const rows = (await ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", school._id).eq("action", "account.created")).collect())
      .filter((r) => !sinceMs || r._creationTime >= sinceMs);
    const byActorRole: Record<string, number> = {};
    const byTargetRole: Record<string, number> = {};
    const problems: { loginId: string | null; problem: string }[] = [];
    for (const r of rows) {
      byActorRole[r.actorRole ?? "(system)"] = (byActorRole[r.actorRole ?? "(system)"] ?? 0) + 1;
      const m = r.entity.table === "schoolMemberships" ? await ctx.db.get(r.entity.id as Id<"schoolMemberships">) : null;
      if (!m || m.schoolId !== school._id) { problems.push({ loginId: null, problem: "target_membership_missing" }); continue; }
      byTargetRole[m.role] = (byTargetRole[m.role] ?? 0) + 1;
      const loginId = m.loginId ?? null;
      if (m.studentId) {
        if (m.role !== "student") problems.push({ loginId, problem: `student_link_on_${m.role}_membership` });
        const s = await ctx.db.get(m.studentId);
        if (!s || s.schoolId !== school._id) problems.push({ loginId, problem: "student_link_invalid" });
      } else if (m.role === "student" && !m.guardianId) {
        problems.push({ loginId, problem: "student_membership_without_student_link" });
      }
      const recorded = (r.metadata as { targetRole?: string } | undefined)?.targetRole;
      if (recorded && recorded !== m.role) problems.push({ loginId, problem: `audit_target_role_${recorded}_but_membership_${m.role}` });
    }
    return { found: true as const, accountCreatedEvents: rows.length, byActorRole, byTargetRole, problems: problems.slice(0, 200) };
  },
});
