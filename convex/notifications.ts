/**
 * In-app notifications for the signed-in member (always scoped to self + school).
 * Producers write via `notifyUsers` in convex/model/notifications.ts.
 */
import { v } from "convex/values";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, requirePermission } from "./core/authorization";
import { notFound } from "./core/errors";

export const list = schoolQuery({
  args: { limit: v.optional(v.number()), unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, { limit, unreadOnly }) => {
    requirePermission(ctx.actor, "notifications:read");
    const take = Math.min(Math.max(limit ?? 30, 1), 100);
    const q = unreadOnly
      ? ctx.db.query("notifications").withIndex("by_user_school_read", (q) => q.eq("userId", ctx.actor.userId).eq("schoolId", ctx.actor.schoolId).eq("isRead", false))
      : ctx.db.query("notifications").withIndex("by_user_school", (q) => q.eq("userId", ctx.actor.userId).eq("schoolId", ctx.actor.schoolId));
    return await q.order("desc").take(take);
  },
});

export const unreadCount = schoolQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_school_read", (q) => q.eq("userId", ctx.actor.userId).eq("schoolId", ctx.actor.schoolId).eq("isRead", false))
      .take(100);
    return rows.length; // UI shows "99+" beyond this
  },
});

export const markRead = schoolMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const n = await getInSchool(ctx, "notifications", notificationId, "Notification");
    if (n.userId !== ctx.actor.userId) throw notFound("Notification");
    if (!n.isRead) await ctx.db.patch(n._id, { isRead: true, readAt: Date.now() });
    return { ok: true };
  },
});

const CLEAR_BATCH = 500;

export const markAllRead = schoolMutation({
  args: {},
  handler: async (ctx) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_school_read", (q) => q.eq("userId", ctx.actor.userId).eq("schoolId", ctx.actor.schoolId).eq("isRead", false))
      .take(500);
    const now = Date.now();
    for (const n of unread) await ctx.db.patch(n._id, { isRead: true, readAt: now });
    return { updated: unread.length };
  },
});

/**
 * Remove one of the caller's OWN notifications from their inbox. Notifications
 * are personal copies (the notice, payment or result they point at is not
 * touched), so removing one only affects the caller's list.
 */
export const remove = schoolMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    requirePermission(ctx.actor, "notifications:read");
    const n = await getInSchool(ctx, "notifications", notificationId, "Notification");
    if (n.userId !== ctx.actor.userId) throw notFound("Notification");
    await ctx.db.delete(n._id);
    return { ok: true };
  },
});

/**
 * Remove ALL of the caller's own notifications in this school (bounded batch;
 * `remaining: true` means call again). Other users' inboxes are never touched.
 */
export const clearAll = schoolMutation({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "notifications:read");
    const batch = await ctx.db
      .query("notifications")
      .withIndex("by_user_school", (q) => q.eq("userId", ctx.actor.userId).eq("schoolId", ctx.actor.schoolId))
      .take(CLEAR_BATCH + 1);
    const rows = batch.slice(0, CLEAR_BATCH);
    for (const n of rows) await ctx.db.delete(n._id);
    return { ok: true, deleted: rows.length, remaining: batch.length > CLEAR_BATCH };
  },
});
