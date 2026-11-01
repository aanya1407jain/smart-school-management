/**
 * Notice board (A-05): draft → published → archived.
 *
 * Who may write:
 *  - `notices:manage` (admin): any audience (whole school, roles, classes, sections).
 *  - a teacher: CLASS-SPECIFIC notices only — audience `sections` limited to
 *    sections in their own scope (subject assignments ∪ class-teacher
 *    sections). Teachers edit / publish / archive only notices they created.
 * Who may read:
 *  - drafts and archived notices: their author and `notices:manage` only;
 *  - published notices: members in the audience, from `publishDate` until
 *    `expiresOn` (students: studentPortal.myNotices; staff: `feed`).
 * Publishing notifies the audience ONCE (in-app; dedupe key per notice), at
 * publish time when the notice is already visible (publishDate ≤ today in the
 * school's timezone), otherwise by a scheduled job on its publish date.
 *
 * Lifecycle: draft → published → archived, and archived → restored to DRAFT
 * (republishing is required to show it again).
 * Notices are never hard-deleted (no retention rule permits it yet).
 */
import { grantsAccess } from "./model/memberships";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { moduleQuery, moduleMutation } from "./core/functions";
import type { Actor } from "./core/actor";
import { enrollmentFor, getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, linkedStudentIds, requireAnyPermission, teacherSectionIds } from "./core/authorization";
import { conflict, forbidden, invalid, notFound } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vAudience, vNoticeType, vPriority } from "./core/validators";
import { todayIn } from "./model/calendar";
import { writeAudit } from "./model/audit";
import { notifyUsers, userIdsForSection } from "./model/notifications";
import { isModuleEnabled } from "./model/modules";

const administrationQuery = moduleQuery("administration");
const administrationMutation = moduleMutation("administration");

type Ctx = QueryCtx & { actor: Actor };
export type Audience = Infer<typeof vAudience>;
const MAX_LIST = 200;
const MAX_RECIPIENTS = 5000;

async function today(ctx: Ctx) {
  return todayIn((await ctx.db.get(ctx.actor.schoolId))!.timezone);
}

/** Validate an audience against the school and (for teachers) their own sections. */
export async function validateAudience(ctx: Ctx, audience: Audience): Promise<Audience> {
  const manager = hasPermission(ctx.actor, "notices:manage");
  if (audience.kind === "all" || audience.kind === "roles") {
    if (!manager) throw forbidden("Teachers can only address notices to their own sections.");
    if (audience.kind === "roles" && audience.roles.length === 0) throw invalid("Choose at least one role.", { audience: "Empty" });
    return audience;
  }
  if (audience.kind === "classes") {
    if (!manager) throw forbidden("Teachers can only address notices to their own sections.");
    if (audience.classIds.length === 0) throw invalid("Choose at least one class.", { audience: "Empty" });
    for (const id of audience.classIds) await getInSchool(ctx, "classes", id, "Class");
    return { kind: "classes", classIds: [...new Set(audience.classIds)] };
  }
  if (audience.sectionIds.length === 0) throw invalid("Choose at least one section.", { audience: "Empty" });
  const scope = !manager && ctx.actor.teacherId ? await teacherSectionIds(ctx, ctx.actor.teacherId, await getCurrentAcademicYearId(ctx, ctx.actor.schoolId)) : null;
  for (const id of audience.sectionIds) {
    await getInSchool(ctx, "sections", id, "Section");
    if (!manager && !scope?.has(id)) throw forbidden("You can only address notices to sections you teach.");
  }
  return { kind: "sections", sectionIds: [...new Set(audience.sectionIds)] };
}

/** May this member see a published notice with this audience? */
export async function inAudience(ctx: QueryCtx, actor: Actor, audience: Audience): Promise<boolean> {
  if (audience.kind === "all") return true;
  if (audience.kind === "roles") return audience.roles.includes(actor.role);
  const yearId = await getCurrentAcademicYearId(ctx, actor.schoolId);
  const sectionIds = new Set<Id<"sections">>();
  if (actor.teacherId) (await teacherSectionIds(ctx, actor.teacherId, yearId)).forEach((s) => sectionIds.add(s));
  for (const studentId of await linkedStudentIds(ctx, actor)) {
    const e = await enrollmentFor(ctx, studentId, yearId);
    if (e && e.status === "active") sectionIds.add(e.sectionId);
  }
  if (audience.kind === "sections") return audience.sectionIds.some((s) => sectionIds.has(s));
  for (const id of sectionIds) {
    const s = await ctx.db.get(id);
    if (s && audience.classIds.includes(s.classId)) return true;
  }
  return false;
}

/** Active user ids of the audience (bounded). */
async function recipients(ctx: MutationCtx, schoolId: Id<"schools">, audience: Audience): Promise<Id<"users">[]> {
  const members = await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", schoolId)).take(MAX_RECIPIENTS);
  const active = members.filter((m) => grantsAccess(m) && m.userId); // legacy guardian sign-ins never receive anything
  if (audience.kind === "all") return active.map((m) => m.userId!);
  if (audience.kind === "roles") return active.filter((m) => audience.roles.includes(m.role)).map((m) => m.userId!);
  const yearId = await getCurrentAcademicYearId(ctx, schoolId);
  let sectionIds: Id<"sections">[] = [];
  if (audience.kind === "sections") sectionIds = audience.sectionIds;
  else {
    for (const classId of audience.classIds) {
      const rows = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", classId).eq("academicYearId", yearId)).collect();
      sectionIds.push(...rows.filter((s) => s.schoolId === schoolId).map((s) => s._id));
    }
  }
  const ids: Id<"users">[] = [];
  for (const id of sectionIds) ids.push(...(await userIdsForSection(ctx, schoolId, id)));
  // Teachers of those sections.
  for (const m of active.filter((x) => x.teacherId)) {
    const scope = await teacherSectionIds(ctx, m.teacherId!, yearId);
    if (sectionIds.some((s) => scope.has(s))) ids.push(m.userId!);
  }
  return ids;
}

function view(n: Doc<"notices">) {
  return { noticeId: n._id, title: n.title, body: n.body, type: n.type, priority: n.priority, audience: n.audience, status: n.status, publishDate: n.publishDate, expiresOn: n.expiresOn ?? null, eventDate: n.eventDate ?? null, endDate: n.endDate ?? null, createdByUserId: n.createdByUserId, publishedAt: n.publishedAt ?? null };
}

/** `view` plus who wrote it and a readable audience (class / section names resolved inside the school). */
async function richView(ctx: Ctx, n: Doc<"notices">) {
  const author = await ctx.db.get(n.createdByUserId);
  return { ...view(n), authorName: author?.name ?? null, audienceLabel: await audienceLabel(ctx, n.audience) };
}

export async function audienceLabel(ctx: Ctx, audience: Audience): Promise<string> {
  if (audience.kind === "all") return "Whole school";
  if (audience.kind === "roles") {
    const names: Record<string, string> = { admin: "Administrators", teacher: "Teachers", student: "Students" };
    return audience.roles.map((r) => names[r] ?? r).join(", ");
  }
  const names: string[] = [];
  if (audience.kind === "classes") {
    for (const id of audience.classIds) { const c = await ctx.db.get(id); if (c && c.schoolId === ctx.actor.schoolId) names.push(c.name); }
  } else {
    for (const id of audience.sectionIds) { const s = await ctx.db.get(id); if (s && s.schoolId === ctx.actor.schoolId) names.push(`Class ${s.displayName}`); }
  }
  return names.join(", ") || "—";
}

/** Epoch ms of 00:00 on `date` in `timezone` (to schedule the publish-date notification). */
export function startOfDayMs(date: string, timezone: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return utc - (wall - utc);
}

/** Notify a published notice's audience once (dedupe key per notice). */
async function notifyAudience(ctx: MutationCtx, n: Doc<"notices">, exceptUserId: Id<"users"> | null) {
  const settings = await getSchoolSettings(ctx, n.schoolId);
  if (!settings.notifications.noticeAlerts) return 0;
  const users = (await recipients(ctx, n.schoolId, n.audience)).filter((u) => u !== exceptUserId);
  return await notifyUsers(ctx, n.schoolId, users, {
    type: "notice", title: n.priority === "normal" ? "New notice" : "Important notice", message: n.title, entity: { table: "notices", id: n._id }, dedupeKey: `notice.published:${n._id}`,
  });
}

async function editable(ctx: Ctx, noticeId: Id<"notices">) {
  requireAnyPermission(ctx.actor, ["notices:manage", "area:teacher"]);
  const n = await getInSchool(ctx, "notices", noticeId, "Notice");
  if (!hasPermission(ctx.actor, "notices:manage") && n.createdByUserId !== ctx.actor.userId) throw forbidden("You can only change notices you wrote.");
  return n;
}

function validateDates(publishDate: string, expiresOn?: string, eventDate?: string, endDate?: string) {
  assertIsoDate(publishDate, "publishDate");
  if (expiresOn) {
    assertIsoDate(expiresOn, "expiresOn");
    if (expiresOn < publishDate) throw invalid("A notice cannot expire before it is published.", { expiresOn: "Before publish date" });
  }
  if (eventDate) assertIsoDate(eventDate, "eventDate");
  // A multi-day event or holiday: endDate is its last day.
  if (endDate) {
    assertIsoDate(endDate, "endDate");
    if (!eventDate) throw invalid("An end date needs a start date.", { endDate: "Set the start date first" });
    if (endDate < eventDate) throw invalid("The end date cannot be before the start date.", { endDate: "Before the start date" });
  }
}

// ================================================================ writes
export const createDraft = administrationMutation({
  args: {
    title: v.string(), body: v.string(), type: vNoticeType, priority: vPriority, audience: vAudience,
    publishDate: v.string(), expiresOn: v.optional(v.string()), eventDate: v.optional(v.string()), endDate: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requireAnyPermission(ctx.actor, ["notices:manage", "area:teacher"]);
    const audience = await validateAudience(ctx, a.audience);
    validateDates(a.publishDate, a.expiresOn, a.eventDate, a.endDate);
    const noticeId = await ctx.db.insert("notices", {
      schoolId: ctx.actor.schoolId, title: assertNonEmpty(a.title, "title", 150), body: assertNonEmpty(a.body, "body", 5000),
      type: a.type, priority: a.priority, audience, status: "draft", publishDate: a.publishDate,
      ...(a.expiresOn ? { expiresOn: a.expiresOn } : {}), ...(a.eventDate ? { eventDate: a.eventDate } : {}),
      ...(a.endDate && a.endDate !== a.eventDate ? { endDate: a.endDate } : {}), createdByUserId: ctx.actor.userId,
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "notice.created", entity: { table: "notices", id: noticeId }, summary: `Drafted notice "${a.title.trim()}"` });
    return { noticeId };
  },
});

/** Edit a draft (published notices are immutable; archive and re-issue instead). */
export const update = administrationMutation({
  args: {
    noticeId: v.id("notices"), title: v.optional(v.string()), body: v.optional(v.string()), type: v.optional(vNoticeType), priority: v.optional(vPriority),
    audience: v.optional(vAudience), publishDate: v.optional(v.string()), expiresOn: v.optional(v.string()), eventDate: v.optional(v.string()), endDate: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const n = await editable(ctx, a.noticeId);
    if (n.status !== "draft") throw conflict("Only drafts can be edited.");
    const patch: Partial<Doc<"notices">> = {};
    if (a.title !== undefined) patch.title = assertNonEmpty(a.title, "title", 150);
    if (a.body !== undefined) patch.body = assertNonEmpty(a.body, "body", 5000);
    if (a.type !== undefined) patch.type = a.type;
    if (a.priority !== undefined) patch.priority = a.priority;
    if (a.audience !== undefined) patch.audience = await validateAudience(ctx, a.audience);
    const publishDate = a.publishDate ?? n.publishDate;
    // "" clears an optional date.
    const expiresOn = a.expiresOn === "" ? undefined : (a.expiresOn ?? n.expiresOn);
    const eventDate = a.eventDate === "" ? undefined : (a.eventDate ?? n.eventDate);
    // A stored end date goes with a cleared start date; a newly sent one is validated.
    let endDate = a.endDate === "" ? undefined : (a.endDate ?? n.endDate);
    if (!eventDate && a.endDate === undefined) endDate = undefined;
    if (endDate && endDate === eventDate) endDate = undefined;
    validateDates(publishDate, expiresOn, eventDate, endDate);
    Object.assign(patch, { publishDate, expiresOn, eventDate, endDate });
    await ctx.db.patch(n._id, patch);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "notice.updated", entity: { table: "notices", id: n._id }, summary: `Updated notice "${patch.title ?? n.title}"` });
    return { ok: true };
  },
});

export const publish = administrationMutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    const n = await editable(ctx, noticeId);
    if (n.status === "published") return { ok: true, notified: 0, scheduled: false };
    if (n.status === "archived") throw conflict("Restore the notice to draft before publishing it again.");
    // Re-validate: the author's scope may have changed since the draft.
    await validateAudience(ctx, n.audience);
    const t = await today(ctx);
    if (n.expiresOn && n.expiresOn < t) throw invalid("This notice has already expired; change its dates first.", { expiresOn: "In the past" });
    await ctx.db.patch(n._id, { status: "published", publishedAt: n.publishedAt ?? Date.now() });
    let notified = 0;
    let scheduled = false;
    if (n.publishDate <= t) {
      notified = await notifyAudience(ctx, { ...n, status: "published" }, ctx.actor.userId);
    } else {
      const school = (await ctx.db.get(ctx.actor.schoolId))!;
      await ctx.scheduler.runAt(startOfDayMs(n.publishDate, school.timezone), internal.notices.notifyOnPublishDate, { noticeId: n._id, exceptUserId: ctx.actor.userId });
      scheduled = true;
    }
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "notice.published", entity: { table: "notices", id: n._id }, summary: `Published notice "${n.title}"`, metadata: { notified, scheduled } });
    return { ok: true, notified, scheduled };
  },
});

/**
 * Scheduled by `publish` for a future publish date: notifies the audience once
 * the date has arrived in the school's timezone (re-checks; re-schedules in an
 * hour if it fired early). Does nothing if the notice was archived meanwhile.
 */
export const notifyOnPublishDate = internalMutation({
  args: { noticeId: v.id("notices"), exceptUserId: v.union(v.id("users"), v.null()) },
  handler: async (ctx, { noticeId, exceptUserId }) => {
    const n = await ctx.db.get(noticeId);
    if (!n || n.status !== "published") return { notified: 0 };
    const school = await ctx.db.get(n.schoolId);
    if (!school) return { notified: 0 };
    // Module entitlement: no notice notifications while Administration & Insights is off (the notice is kept).
    if (!(await isModuleEnabled(ctx, n.schoolId, "administration"))) return { notified: 0, skipped: "module_disabled" as const };
    if (n.publishDate > todayIn(school.timezone)) {
      await ctx.scheduler.runAfter(60 * 60 * 1000, internal.notices.notifyOnPublishDate, { noticeId, exceptUserId });
      return { notified: 0 };
    }
    return { notified: await notifyAudience(ctx, n, exceptUserId) };
  },
});

export const archive = administrationMutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    const n = await editable(ctx, noticeId);
    if (n.status === "archived") return { ok: true };
    await ctx.db.patch(n._id, { status: "archived" });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "notice.archived", entity: { table: "notices", id: n._id }, summary: `Archived notice "${n.title}"` });
    return { ok: true };
  },
});

/**
 * Undo an archive: the notice always returns to DRAFT. It disappears from every
 * feed until someone publishes it again (re-validating its audience and dates);
 * a notice that was published before keeps its dedupe key, so republishing does
 * not notify the same people twice.
 */
export const restore = administrationMutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    const n = await editable(ctx, noticeId);
    if (n.status !== "archived") throw conflict("Only archived notices can be restored.");
    await ctx.db.patch(n._id, { status: "draft" });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "notice.restored", entity: { table: "notices", id: n._id }, summary: `Restored notice "${n.title}" to draft` });
    return { ok: true, status: "draft" as const };
  },
});

// ================================================================ reads
/** Management list: managers see every notice; teachers see the ones they wrote. */
export const listManaged = administrationQuery({
  args: { status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("archived"))) },
  handler: async (ctx, { status }) => {
    requireAnyPermission(ctx.actor, ["notices:manage", "area:teacher"]);
    const statuses = status ? [status] : (["draft", "published", "archived"] as const);
    const out: Doc<"notices">[] = [];
    for (const s of statuses) {
      out.push(...(await ctx.db.query("notices").withIndex("by_school_status_publish", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", s)).order("desc").take(MAX_LIST)));
    }
    const mine = hasPermission(ctx.actor, "notices:manage") ? out : out.filter((n) => n.createdByUserId === ctx.actor.userId);
    const out2 = [];
    for (const n of mine.sort((a, b) => b.publishDate.localeCompare(a.publishDate))) out2.push(await richView(ctx, n));
    return out2;
  },
});

/** Published notices addressed to the caller (any role), visible today. */
export const feed = administrationQuery({
  args: {},
  handler: async (ctx) => {
    requireAnyPermission(ctx.actor, ["notices:read", "notices:manage"]);
    const t = await today(ctx);
    const rows = await ctx.db.query("notices").withIndex("by_school_status_publish", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "published").lte("publishDate", t)).order("desc").take(MAX_LIST);
    const out = [];
    for (const n of rows) {
      if (n.expiresOn && n.expiresOn < t) continue;
      if (hasPermission(ctx.actor, "notices:manage") || (await inAudience(ctx, ctx.actor, n.audience))) out.push(await richView(ctx, n));
    }
    return out;
  },
});

export const get = administrationQuery({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    const n = await getInSchool(ctx, "notices", noticeId, "Notice");
    if (hasPermission(ctx.actor, "notices:manage") || n.createdByUserId === ctx.actor.userId) return await richView(ctx, n);
    const t = await today(ctx);
    if (n.status === "published" && n.publishDate <= t && (!n.expiresOn || n.expiresOn >= t) && (await inAudience(ctx, ctx.actor, n.audience))) return await richView(ctx, n);
    throw notFound("Notice");
  },
});
