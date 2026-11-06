/**
 * Read access to the audit trail (admin: `audit:read`, the Principal-only
 * grant). Writing happens only through `writeAudit` / `logAuditEvent`
 * (convex/model/audit.ts) inside the mutation that made the change; there are
 * no public write/update/delete functions, so the log is append-only.
 *
 *   getAuditLogs        — the /admin/audit viewer: paginated, newest first,
 *                         filtered by category, actor role, text and date range.
 *   exportAuditLogsCsv  — the same filters as a CSV download (capped at
 *                         EXPORT_MAX_ROWS); the export itself is audited.
 *   backfillCategories  — internal, one-off: derives `category` for rows
 *                         written before it existed.
 */
import { v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolAction, schoolQuery } from "./core/functions";
import { requireActor } from "./core/actor";
import { requirePermission } from "./core/authorization";
import { invalid } from "./core/errors";
import { isAccountantGrants } from "./core/grants";
import { AUDIT_CATEGORY_LABELS, auditCategoryOf, auditOutcomeOf, vAuditCategory } from "./core/auditCategories";
import { toCsv, writeAudit } from "./model/audit";

// ================================================================ viewer (getAuditLogs) + export

export const vAuditActorRole = v.union(v.literal("admin"), v.literal("teacher"), v.literal("student"), v.literal("system"));
const vAuditFilters = {
  category: v.optional(vAuditCategory),
  actorRole: v.optional(vAuditActorRole),
  /** Actor name or Login ID, scholar number / Login ID of the affected account, entity id, or summary text. */
  search: v.optional(v.string()),
  /** Inclusive range on the event time (epoch ms). */
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
};
const vAuditFiltersObject = v.object(vAuditFilters);
export type AuditFilters = Infer<typeof vAuditFiltersObject>;

/** Most rows one CSV export contains (the response says when it was cut). */
export const EXPORT_MAX_ROWS = 5000;
/** Most rows scanned for one export when a text search must be applied after reading. */
const EXPORT_MAX_SCAN = 8000;
/** Rows scanned per page while a text search is active (matches are filtered after reading). */
const SEARCH_SCAN_PAGE = 300;

function checkFilters(f: AuditFilters) {
  if (f.startDate !== undefined && f.endDate !== undefined && f.startDate > f.endDate) {
    throw invalid("The start date must be before the end date.", { startDate: "After end date" });
  }
  if (f.search !== undefined && f.search.length > 100) throw invalid("Search for at most 100 characters.", { search: "Too long" });
}

/** The indexed, ordered query for the filters (category → its index; time range on `_creationTime`). */
function auditQuery(ctx: QueryCtx, schoolId: Id<"schools">, f: AuditFilters) {
  const { startDate: from, endDate: to } = f;
  const q = f.category
    ? ctx.db.query("auditLogs").withIndex("by_school_category", (x) => {
        const r = x.eq("schoolId", schoolId).eq("category", f.category);
        return from !== undefined && to !== undefined ? r.gte("_creationTime", from).lte("_creationTime", to)
          : from !== undefined ? r.gte("_creationTime", from) : to !== undefined ? r.lte("_creationTime", to) : r;
      })
    : ctx.db.query("auditLogs").withIndex("by_school", (x) => {
        const r = x.eq("schoolId", schoolId);
        return from !== undefined && to !== undefined ? r.gte("_creationTime", from).lte("_creationTime", to)
          : from !== undefined ? r.gte("_creationTime", from) : to !== undefined ? r.lte("_creationTime", to) : r;
      });
  const ordered = q.order("desc");
  const role = f.actorRole;
  if (!role) return ordered;
  return ordered.filter((x) => (role === "system" ? x.eq(x.field("actorUserId"), undefined) : x.eq(x.field("actorRole"), role)));
}

type ActorInfo = { name: string; loginId: string | null; profile: string };

/** Display label of a member's access: Administrator / Accountant / Office staff / Teacher / Student. */
function profileOf(m: Doc<"schoolMemberships"> | undefined, role: string | undefined): string {
  if (m?.role === "admin" || (!m && role === "admin")) {
    if (!m || (m.grants === undefined && !m.permissionSets.includes("accountant"))) return "Administrator";
    return m.permissionSets.includes("accountant") || isAccountantGrants(m.grants) ? "Accountant" : "Office staff";
  }
  const r = m?.role ?? role;
  return r === "teacher" ? "Teacher" : r === "student" ? "Student" : "Member";
}

/** Rows as the viewer and the export show them (actor resolved once per user). */
async function shapeRows(ctx: QueryCtx, schoolId: Id<"schools">, rows: Doc<"auditLogs">[]) {
  const actors = new Map<string, ActorInfo>();
  const out = [];
  for (const r of rows) {
    let actor: ActorInfo | null = null;
    if (r.actorUserId) {
      const key = r.actorUserId as string;
      if (!actors.has(key)) {
        const m = (await ctx.db.query("schoolMemberships").withIndex("by_user", (x) => x.eq("userId", r.actorUserId!)).collect()).find((x) => x.schoolId === schoolId);
        actors.set(key, { name: m?.displayName ?? "Former member", loginId: m?.loginId ?? null, profile: profileOf(m, r.actorRole) });
      }
      const known = actors.get(key)!;
      actor = { ...known, name: r.actorName ?? known.name }; // the name recorded at the time wins
    }
    const meta = (r.metadata ?? null) as Record<string, unknown> | null;
    const target = typeof meta?.targetLoginId === "string" ? meta.targetLoginId : typeof meta?.scholarNo === "string" ? meta.scholarNo : null;
    out.push({
      _id: r._id,
      at: r._creationTime,
      action: r.action,
      category: r.category ?? auditCategoryOf(r.action),
      outcome: auditOutcomeOf(r.action),
      summary: r.summary,
      entity: r.entity,
      target,
      actorRole: r.actorRole ?? null,
      actor,
      metadata: meta,
    });
  }
  return out;
}
export type AuditRow = Awaited<ReturnType<typeof shapeRows>>[number];

/** Case-insensitive match on actor, affected account, entity id, action and summary. */
function matchesSearch(r: AuditRow, needle: string): boolean {
  const hay = [r.actor?.name, r.actor?.loginId, r.target, r.entity.id, r.action, r.summary].filter(Boolean).join("\n").toLowerCase();
  return hay.includes(needle);
}

/**
 * The audit-log viewer. Newest first; `category` and the date range use
 * indexes, `actorRole` is filtered while reading, and `search` is matched
 * after reading (so a page can hold fewer rows than asked for — keep loading
 * while `isDone` is false).
 */
export const getAuditLogs = schoolQuery({
  args: { ...vAuditFilters, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts, ...f }) => {
    requirePermission(ctx.actor, "audit:read");
    checkFilters(f);
    const needle = f.search?.trim().toLowerCase() ?? "";
    const numItems = needle ? SEARCH_SCAN_PAGE : Math.min(Math.max(paginationOpts.numItems, 1), 200);
    const result = await auditQuery(ctx, ctx.actor.schoolId, f).paginate({ ...paginationOpts, numItems });
    const rows = await shapeRows(ctx, ctx.actor.schoolId, result.page);
    return { ...result, page: needle ? rows.filter((r) => matchesSearch(r, needle)) : rows };
  },
});

/** Export step 1 (runs with the caller's identity): authorize and read the filtered rows. */
export const exportRows = internalQuery({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), filters: vAuditFiltersObject },
  handler: async (ctx, { callerMembershipId, filters }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requirePermission(actor, "audit:read");
    checkFilters(filters);
    const needle = filters.search?.trim().toLowerCase() ?? "";
    const read = await auditQuery(ctx, actor.schoolId, filters).take(needle ? EXPORT_MAX_SCAN : EXPORT_MAX_ROWS + 1);
    let rows = await shapeRows(ctx, actor.schoolId, read);
    if (needle) rows = rows.filter((r) => matchesSearch(r, needle));
    const truncated = rows.length > EXPORT_MAX_ROWS || (needle !== "" && read.length === EXPORT_MAX_SCAN);
    const school = (await ctx.db.get(actor.schoolId))!;
    return { rows: rows.slice(0, EXPORT_MAX_ROWS), truncated, schoolSlug: school.slug, timezone: school.timezone };
  },
});

/** Export step 2: the export itself is an audited event. */
export const recordExport = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), filters: vAuditFiltersObject, rowCount: v.number(), truncated: v.boolean() },
  handler: async (ctx, { callerMembershipId, filters, rowCount, truncated }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requirePermission(actor, "audit:read");
    await writeAudit(ctx, {
      schoolId: actor.schoolId, actor, action: "audit.exported", entity: { table: "schools", id: actor.schoolId },
      summary: `Exported ${rowCount} audit log entr${rowCount === 1 ? "y" : "ies"} as CSV${truncated ? " (limit reached)" : ""}`,
      metadata: { filters, rowCount, truncated },
    });
  },
});

/**
 * Download the filtered audit log as CSV (UTF-8, formula-safe cells). At most
 * EXPORT_MAX_ROWS rows, newest first; `truncated` says when the limit was hit.
 */
export const exportAuditLogsCsv = schoolAction({
  args: vAuditFilters,
  handler: async (ctx, filters): Promise<{ fileName: string; csv: string; rowCount: number; truncated: boolean }> => {
    const res: { rows: AuditRow[]; truncated: boolean; schoolSlug: string; timezone: string } =
      await ctx.runQuery(internal.audit.exportRows, { callerMembershipId: ctx.membershipId, filters });
    await ctx.runMutation(internal.audit.recordExport, { callerMembershipId: ctx.membershipId, filters, rowCount: res.rows.length, truncated: res.truncated });
    const header = ["Timestamp (UTC)", "Category", "Action", "Outcome", "Actor", "Actor Login ID", "Actor role", "Entity type", "Entity ID", "Affected account", "Summary", "Details (JSON)"];
    const body = res.rows.map((r) => [
      new Date(r.at).toISOString(), AUDIT_CATEGORY_LABELS[r.category], r.action, r.outcome,
      r.actor?.name ?? "System", r.actor?.loginId ?? "", r.actor?.profile ?? "System",
      r.entity.table, r.entity.id, r.target ?? "", r.summary, r.metadata ?? "",
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    // Byte-order mark so spreadsheet apps read UTF-8 (names with non-ASCII letters).
    return { fileName: `audit-log-${res.schoolSlug}-${stamp}.csv`, csv: `﻿${toCsv([header, ...body])}`, rowCount: res.rows.length, truncated: res.truncated };
  },
});

/**
 * One-off maintenance (internal: CLI/dashboard only): set the derived
 * `category` on rows written before it existed, in batches. Changes nothing
 * else on any row. Safe to re-run.
 *
 *   npx convex run audit:backfillCategories '{}'
 */
export const backfillCategories = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }): Promise<{ updated: number; done: boolean }> => {
    const page = await ctx.db.query("auditLogs").paginate({ numItems: 500, cursor: cursor ?? null });
    let updated = 0;
    for (const r of page.page) {
      if (r.category === undefined) {
        await ctx.db.patch(r._id, { category: auditCategoryOf(r.action) });
        updated++;
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.audit.backfillCategories, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

// ================================================================ earlier read APIs (kept for existing callers)

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

/**
 * The audit-log viewer (admin: audit:read): newest first, paginated, optionally
 * one action ("fees.payment_reversed"). Each row names the acting member as
 * they appear in THIS school (membership display name + Login ID), or
 * "System" for jobs. Metadata is returned as recorded — writeAudit never
 * stores passwords, tokens or other secrets.
 */
export const feed = schoolQuery({
  args: { action: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { action, paginationOpts }) => {
    requirePermission(ctx.actor, "audit:read");
    const schoolId = ctx.actor.schoolId;
    const q = action
      ? ctx.db.query("auditLogs").withIndex("by_school_action", (x) => x.eq("schoolId", schoolId).eq("action", action))
      : ctx.db.query("auditLogs").withIndex("by_school", (x) => x.eq("schoolId", schoolId));
    const result = await q.order("desc").paginate(paginationOpts);
    const names = new Map<string, { name: string; loginId: string | null }>();
    const page = [];
    for (const r of result.page) {
      let actor: { name: string; loginId: string | null } | null = null;
      if (r.actorUserId) {
        const key = r.actorUserId as string;
        if (!names.has(key)) {
          const m = (await ctx.db.query("schoolMemberships").withIndex("by_user", (x) => x.eq("userId", r.actorUserId!)).collect()).find((x) => x.schoolId === schoolId);
          names.set(key, { name: m?.displayName ?? "Former member", loginId: m?.loginId ?? null });
        }
        actor = names.get(key)!;
      }
      page.push({ _id: r._id, at: r._creationTime, action: r.action, summary: r.summary, entity: r.entity, actorRole: r.actorRole ?? null, actor, metadata: r.metadata ?? null });
    }
    return { ...result, page };
  },
});

/** Distinct action names seen recently (for the viewer's filter), bounded. */
export const actions = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "audit:read");
    const rows = await ctx.db.query("auditLogs").withIndex("by_school", (x) => x.eq("schoolId", ctx.actor.schoolId)).order("desc").take(2000);
    return [...new Set(rows.map((r) => r.action))].sort();
  },
});
