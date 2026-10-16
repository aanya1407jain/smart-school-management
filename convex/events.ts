/**
 * School calendar events (A-05): events, holidays, exam days and meetings.
 *
 * `notices:manage` (admin) creates, edits and deletes events. Every member of
 * the school can list events addressed to them (same audience rules as
 * notices). Holidays matter beyond display: attendance treats a holiday as a
 * non-school day (model/calendar.ts isSchoolDay), so a holiday cannot be
 * created on a date that already has a marked attendance register.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, hasPermission, requirePermission } from "./core/authorization";
import { conflict, invalid } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vAudience, vEventKind } from "./core/validators";
import { daysBetween } from "./model/calendar";
import { writeAudit } from "./model/audit";
import { inAudience, validateAudience } from "./notices";

const MAX_EVENT_DAYS = 60;
const MAX_LIST_DAYS = 400;

function validateRange(startDate: string, endDate: string) {
  assertIsoDate(startDate, "startDate");
  assertIsoDate(endDate, "endDate");
  if (endDate < startDate) throw invalid("An event cannot end before it starts.", { endDate: "Before start" });
  if (daysBetween(startDate, endDate) + 1 > MAX_EVENT_DAYS) throw invalid(`An event can span at most ${MAX_EVENT_DAYS} days.`, { endDate: "Too long" });
}

function view(e: Doc<"events">) {
  return { eventId: e._id, title: e.title, description: e.description ?? null, kind: e.kind, startDate: e.startDate, endDate: e.endDate, audience: e.audience };
}

async function assertNoRegisters(ctx: Parameters<typeof getInSchool>[0], startDate: string, endDate: string) {
  const marked = await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", ctx.actor.schoolId).gte("date", startDate).lte("date", endDate)).first();
  if (marked) throw conflict(`Attendance is already marked on ${marked.date}; a holiday cannot cover that date.`);
}

export const create = schoolMutation({
  args: { title: v.string(), description: v.optional(v.string()), kind: vEventKind, startDate: v.string(), endDate: v.string(), audience: vAudience },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "notices:manage");
    validateRange(a.startDate, a.endDate);
    const audience = await validateAudience(ctx, a.audience);
    if (a.kind === "holiday") {
      if (audience.kind !== "all") throw invalid("A holiday applies to the whole school.", { audience: "Must be all" });
      await assertNoRegisters(ctx, a.startDate, a.endDate);
    }
    const eventId = await ctx.db.insert("events", {
      schoolId: ctx.actor.schoolId, title: assertNonEmpty(a.title, "title", 150), ...(a.description?.trim() ? { description: assertNonEmpty(a.description, "description", 2000) } : {}),
      kind: a.kind, startDate: a.startDate, endDate: a.endDate, audience, createdByUserId: ctx.actor.userId,
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "event.created", entity: { table: "events", id: eventId }, summary: `Added ${a.kind} "${a.title.trim()}" (${a.startDate}–${a.endDate})` });
    return { eventId };
  },
});

export const update = schoolMutation({
  args: { eventId: v.id("events"), title: v.optional(v.string()), description: v.optional(v.string()), startDate: v.optional(v.string()), endDate: v.optional(v.string()), audience: v.optional(vAudience) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "notices:manage");
    const e = await getInSchool(ctx, "events", a.eventId, "Event");
    const startDate = a.startDate ?? e.startDate;
    const endDate = a.endDate ?? e.endDate;
    validateRange(startDate, endDate);
    const audience = a.audience ? await validateAudience(ctx, a.audience) : e.audience;
    if (e.kind === "holiday") {
      if (audience.kind !== "all") throw invalid("A holiday applies to the whole school.", { audience: "Must be all" });
      if (startDate < e.startDate || endDate > e.endDate) await assertNoRegisters(ctx, startDate, endDate);
    }
    const patch: Partial<Doc<"events">> = { startDate, endDate, audience };
    if (a.title !== undefined) patch.title = assertNonEmpty(a.title, "title", 150);
    if (a.description !== undefined) patch.description = a.description.trim() ? assertNonEmpty(a.description, "description", 2000) : undefined;
    await ctx.db.patch(e._id, patch);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "event.updated", entity: { table: "events", id: e._id }, summary: `Updated ${e.kind} "${patch.title ?? e.title}"` });
    return { ok: true };
  },
});

export const remove = schoolMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    requirePermission(ctx.actor, "notices:manage");
    const e = await getInSchool(ctx, "events", eventId, "Event");
    await ctx.db.delete(e._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "event.deleted", entity: { table: "events", id: e._id }, summary: `Deleted ${e.kind} "${e.title}"` });
    return { ok: true };
  },
});

/** Events overlapping [from, to] (≤ 400 days) that are addressed to the caller. */
export const list = schoolQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    if (from > to) throw invalid("`from` must not be after `to`.");
    if (daysBetween(from, to) + 1 > MAX_LIST_DAYS) throw invalid(`Ranges are limited to ${MAX_LIST_DAYS} days.`);
    // Events start at most MAX_EVENT_DAYS before they end, so this window catches every overlap.
    const earliest = new Date(Date.parse(`${from}T00:00:00Z`) - MAX_EVENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const rows = await ctx.db.query("events").withIndex("by_school_start", (q) => q.eq("schoolId", ctx.actor.schoolId).gte("startDate", earliest).lte("startDate", to)).collect();
    const out = [];
    for (const e of rows) {
      if (e.endDate < from) continue;
      if (hasPermission(ctx.actor, "notices:manage") || (await inAudience(ctx, ctx.actor, e.audience))) out.push(view(e));
    }
    return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
  },
});
