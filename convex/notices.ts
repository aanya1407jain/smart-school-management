/**
 * Notices and school events backend API.
 *
 * Implements audience targeting (school-wide, role-specific, class-specific,
 * and section-specific) ensuring notices only reach intended recipients.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, requirePermission, teacherSectionIds } from "./core/authorization";
import { invalid, notFound } from "./core/errors";
import {
  assertIsoDate,
  assertNonEmpty,
  vAudience,
  vEventKind,
  vNoticeStatus,
  vNoticeType,
  vPriority,
} from "./core/validators";
import { writeAudit } from "./model/audit";
import { notifyUsers, userIdsForStudent } from "./model/notifications";
import { currentYear } from "./model/studentRecords";

// ------------------------------------------------------------------ helpers

type Scope =
  | { isAdmin: true }
  | { isAdmin: false; role: "teacher"; sectionIds: Set<Id<"sections">>; classIds: Set<Id<"classes">> }
  | { isAdmin: false; role: "student"; sectionIds: Set<Id<"sections">>; classIds: Set<Id<"classes">> };

async function getCallerScope(ctx: any): Promise<Scope> {
  const actor = ctx.actor;
  if (actor.role === "admin") {
    return { isAdmin: true };
  }

  const year = await currentYear(ctx, actor.schoolId);

  if (actor.role === "teacher" && actor.teacherId) {
    const secIds = year ? await teacherSectionIds(ctx, actor.teacherId, year._id) : new Set<Id<"sections">>();
    const classIds = new Set<Id<"classes">>();
    for (const sid of secIds) {
      const s = await ctx.db.get(sid);
      if (s) classIds.add(s.classId);
    }
    return {
      isAdmin: false,
      role: "teacher",
      sectionIds: secIds,
      classIds,
    };
  }

  // Student or guardian
  const studentIds: Id<"students">[] = [];
  if (actor.studentId) studentIds.push(actor.studentId);
  if (actor.guardianId) {
    const links = await ctx.db
      .query("guardianLinks")
      .withIndex("by_guardian", (q: any) => q.eq("guardianId", actor.guardianId))
      .collect();
    for (const l of links) {
      if (l.schoolId === actor.schoolId) studentIds.push(l.studentId);
    }
  }

  const studentClassIds = new Set<Id<"classes">>();
  const studentSectionIds = new Set<Id<"sections">>();
  if (year) {
    for (const sid of studentIds) {
      const enr = await ctx.db
        .query("enrollments")
        .withIndex("by_student_year", (q: any) => q.eq("studentId", sid).eq("academicYearId", year._id))
        .first();
      if (enr && enr.status === "active") {
        studentClassIds.add(enr.classId);
        studentSectionIds.add(enr.sectionId);
      }
    }
  }

  return {
    isAdmin: false,
    role: "student",
    classIds: studentClassIds,
    sectionIds: studentSectionIds,
  };
}

function noticeMatchesAudience(notice: Doc<"notices">, scope: Scope): boolean {
  if (scope.isAdmin) return true;

  const a = notice.audience;
  if (a.kind === "all") return true;

  if (a.kind === "roles") {
    return a.roles.includes(scope.role);
  }

  if (a.kind === "classes") {
    return a.classIds.some((cid) => scope.classIds.has(cid));
  }

  if (a.kind === "sections") {
    return a.sectionIds.some((sid) => scope.sectionIds.has(sid));
  }

  return false;
}

// ------------------------------------------------------------------ notices queries & mutations

export const list = schoolQuery({
  args: {
    status: v.optional(vNoticeStatus),
    type: v.optional(vNoticeType),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scope = await getCallerScope(ctx);
    const take = Math.min(Math.max(args.limit ?? 50, 1), 100);

    let rows: Doc<"notices">[];
    if (scope.isAdmin) {
      const status = args.status ?? "published";
      rows = await ctx.db
        .query("notices")
        .withIndex("by_school_status_publish", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", status))
        .order("desc")
        .take(take);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      rows = await ctx.db
        .query("notices")
        .withIndex("by_school_status_publish", (q) =>
          q.eq("schoolId", ctx.actor.schoolId).eq("status", "published").lte("publishDate", today),
        )
        .order("desc")
        .take(take);

      rows = rows.filter((n) => !n.expiresOn || n.expiresOn >= today);
    }

    if (args.type) {
      rows = rows.filter((n) => n.type === args.type);
    }

    return rows.filter((n) => noticeMatchesAudience(n, scope));
  },
});

export const get = schoolQuery({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    const notice = await getInSchool(ctx, "notices", noticeId, "Notice");
    const scope = await getCallerScope(ctx);

    if (!noticeMatchesAudience(notice, scope)) {
      throw notFound("Notice");
    }

    if (!scope.isAdmin && notice.status !== "published") {
      throw notFound("Notice");
    }

    return notice;
  },
});

export const create = schoolMutation({
  args: {
    title: v.string(),
    body: v.string(),
    type: vNoticeType,
    priority: vPriority,
    audience: vAudience,
    status: vNoticeStatus,
    publishDate: v.string(),
    expiresOn: v.optional(v.string()),
    eventDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "notices:manage");
    const title = assertNonEmpty(args.title, "title", 200);
    const body = assertNonEmpty(args.body, "body", 5000);
    assertIsoDate(args.publishDate, "publishDate");
    if (args.expiresOn) assertIsoDate(args.expiresOn, "expiresOn");
    if (args.eventDate) assertIsoDate(args.eventDate, "eventDate");

    const noticeId = await ctx.db.insert("notices", {
      schoolId: ctx.actor.schoolId,
      title,
      body,
      type: args.type,
      priority: args.priority,
      audience: args.audience,
      status: args.status,
      publishDate: args.publishDate,
      expiresOn: args.expiresOn,
      eventDate: args.eventDate,
      createdByUserId: ctx.actor.userId,
    });

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "notice.created",
      entity: { table: "notices", id: noticeId },
      summary: `Created notice "${title}" (${args.status}, priority ${args.priority})`,
      metadata: { audience: args.audience, type: args.type },
    });

    if (args.status === "published" && (args.priority === "urgent" || args.priority === "high")) {
      await dispatchNoticeNotifications(ctx, noticeId, title, body, args.audience);
    }

    return { noticeId };
  },
});

export const update = schoolMutation({
  args: {
    noticeId: v.id("notices"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    type: v.optional(vNoticeType),
    priority: v.optional(vPriority),
    audience: v.optional(vAudience),
    status: v.optional(vNoticeStatus),
    publishDate: v.optional(v.string()),
    expiresOn: v.optional(v.string()),
    eventDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "notices:manage");
    const notice = await getInSchool(ctx, "notices", args.noticeId, "Notice");

    const patch: Partial<Doc<"notices">> = {};
    if (args.title !== undefined) patch.title = assertNonEmpty(args.title, "title", 200);
    if (args.body !== undefined) patch.body = assertNonEmpty(args.body, "body", 5000);
    if (args.type !== undefined) patch.type = args.type;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.audience !== undefined) patch.audience = args.audience;
    if (args.status !== undefined) patch.status = args.status;
    if (args.publishDate !== undefined) patch.publishDate = assertIsoDate(args.publishDate, "publishDate");
    if (args.expiresOn !== undefined) patch.expiresOn = args.expiresOn ? assertIsoDate(args.expiresOn, "expiresOn") : undefined;
    if (args.eventDate !== undefined) patch.eventDate = args.eventDate ? assertIsoDate(args.eventDate, "eventDate") : undefined;

    await ctx.db.patch(notice._id, patch);

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "notice.updated",
      entity: { table: "notices", id: notice._id },
      summary: `Updated notice "${patch.title ?? notice.title}"`,
      metadata: { fields: Object.keys(patch) },
    });

    return { ok: true };
  },
});

export const archive = schoolMutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    requirePermission(ctx.actor, "notices:manage");
    const notice = await getInSchool(ctx, "notices", noticeId, "Notice");
    await ctx.db.patch(notice._id, { status: "archived" });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "notice.archived",
      entity: { table: "notices", id: notice._id },
      summary: `Archived notice "${notice.title}"`,
    });
    return { ok: true };
  },
});

export const restore = schoolMutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    requirePermission(ctx.actor, "notices:manage");
    const notice = await getInSchool(ctx, "notices", noticeId, "Notice");
    await ctx.db.patch(notice._id, { status: "published" });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "notice.restored",
      entity: { table: "notices", id: notice._id },
      summary: `Restored notice "${notice.title}" to published`,
    });
    return { ok: true };
  },
});

export const remove = schoolMutation({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, { noticeId }) => {
    requirePermission(ctx.actor, "notices:manage");
    const notice = await getInSchool(ctx, "notices", noticeId, "Notice");
    await ctx.db.delete(notice._id);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "notice.deleted",
      entity: { table: "notices", id: notice._id },
      summary: `Deleted notice "${notice.title}"`,
    });
    return { ok: true };
  },
});

// ------------------------------------------------------------------ events

export const listEvents = schoolQuery({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await getCallerScope(ctx);
    let events = await ctx.db
      .query("events")
      .withIndex("by_school_start", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();

    if (args.startDate) {
      events = events.filter((e) => e.endDate >= args.startDate!);
    }
    if (args.endDate) {
      events = events.filter((e) => e.startDate <= args.endDate!);
    }

    if (scope.isAdmin) return events;
    return events.filter((e) => {
      const a = e.audience;
      if (a.kind === "all") return true;
      if (a.kind === "roles") return a.roles.includes(scope.role);
      if (a.kind === "classes") return a.classIds.some((cid) => scope.classIds.has(cid));
      if (a.kind === "sections") return a.sectionIds.some((sid) => scope.sectionIds.has(sid));
      return false;
    });
  },
});

export const createEvent = schoolMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    kind: vEventKind,
    startDate: v.string(),
    endDate: v.string(),
    audience: vAudience,
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "notices:manage");
    const title = assertNonEmpty(args.title, "title", 200);
    assertIsoDate(args.startDate, "startDate");
    assertIsoDate(args.endDate, "endDate");
    if (args.endDate < args.startDate) {
      throw invalid("End date must be on or after start date");
    }

    const eventId = await ctx.db.insert("events", {
      schoolId: ctx.actor.schoolId,
      title,
      description: args.description,
      kind: args.kind,
      startDate: args.startDate,
      endDate: args.endDate,
      audience: args.audience,
      createdByUserId: ctx.actor.userId,
    });

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "event.created",
      entity: { table: "events", id: eventId },
      summary: `Created ${args.kind} event "${title}" (${args.startDate} – ${args.endDate})`,
    });

    return { eventId };
  },
});

// ------------------------------------------------------------------ notification dispatcher helper

async function dispatchNoticeNotifications(
  ctx: any,
  noticeId: Id<"notices">,
  title: string,
  body: string,
  audience: Doc<"notices">["audience"],
) {
  const schoolId = ctx.actor.schoolId;
  const userIds = new Set<Id<"users">>();

  if (audience.kind === "all") {
    for (const r of ["admin", "teacher", "student"] as const) {
      const ms = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_role", (q: any) => q.eq("schoolId", schoolId).eq("role", r))
        .collect();
      for (const m of ms) {
        if (m.status === "active" && m.userId) userIds.add(m.userId);
      }
    }
  } else if (audience.kind === "roles") {
    for (const r of audience.roles) {
      const ms = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_role", (q: any) => q.eq("schoolId", schoolId).eq("role", r))
        .collect();
      for (const m of ms) {
        if (m.status === "active" && m.userId) userIds.add(m.userId);
      }
    }
  } else if (audience.kind === "classes" || audience.kind === "sections") {
    const year = await currentYear(ctx, schoolId);
    if (year) {
      const enrollments = (
        await ctx.db
          .query("enrollments")
          .withIndex("by_school_year", (q: any) => q.eq("schoolId", schoolId).eq("academicYearId", year._id))
          .collect()
      ).filter((e: any) => e.status === "active");

      const matchedEnrollments =
        audience.kind === "classes"
          ? enrollments.filter((e: any) => audience.classIds.includes(e.classId))
          : enrollments.filter((e: any) => audience.sectionIds.includes(e.sectionId));

      for (const e of matchedEnrollments) {
        const studentAndGuardianUserIds = await userIdsForStudent(ctx, schoolId, e.studentId);
        for (const uid of studentAndGuardianUserIds) {
          userIds.add(uid);
        }
      }
    }
  }

  if (userIds.size > 0) {
    await notifyUsers(ctx, schoolId, userIds, {
      type: "notice",
      title: `Notice: ${title}`,
      message: body.slice(0, 140),
      href: "/student/notices",
      entity: { table: "notices", id: noticeId },
    });
  }
}
