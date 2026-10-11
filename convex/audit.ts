/**
 * Read access to the audit trail (admin: `audit:read`). Writing happens only
 * through `writeAudit` (convex/model/audit.ts) inside the mutation that made
 * the change; there are no public write/delete functions.
 */
import { v } from "convex/values";
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
