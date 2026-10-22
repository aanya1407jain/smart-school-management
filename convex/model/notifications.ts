/**
 * Notification foundation. Modules call `notifyUsers` inside their mutation so
 * the notification is written atomically with the change that caused it.
 * Delivery channels (push / email / SMS) are a later concern: they can be
 * added by scheduling an action from here without changing callers.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { Infer } from "convex/values";
import type { vNotificationType } from "../core/validators";

export type NotificationInput = {
  type: Infer<typeof vNotificationType>;
  title: string;
  message: string;
  href?: string;
  entity?: { table: string; id: string };
  /**
   * The event that caused this notification ("homework.created:<id>"). When
   * set, a user who already has a notification with this key is skipped, so a
   * repeated trigger (retry, re-publish) never notifies twice.
   */
  dedupeKey?: string;
};

/** In-app notifications only (no SMS / email / push provider is configured). Returns how many were written. */
export async function notifyUsers(ctx: MutationCtx, schoolId: Id<"schools">, userIds: Iterable<Id<"users">>, n: NotificationInput) {
  const unique = new Set(userIds);
  let written = 0;
  for (const userId of unique) {
    if (n.dedupeKey) {
      const dup = await ctx.db.query("notifications").withIndex("by_user_dedupe", (q) => q.eq("userId", userId).eq("dedupeKey", n.dedupeKey)).first();
      if (dup && dup.schoolId === schoolId) continue;
    }
    await ctx.db.insert("notifications", { schoolId, userId, isRead: false, ...n });
    written++;
  }
  return written;
}

/** Active user accounts of every student actively enrolled in a section. */
export async function userIdsForSection(ctx: QueryCtx, schoolId: Id<"schools">, sectionId: Id<"sections">): Promise<Id<"users">[]> {
  const enrollments = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).take(1001);
  const ids: Id<"users">[] = [];
  for (const e of enrollments) if (e.schoolId === schoolId) ids.push(...(await userIdsForStudent(ctx, schoolId, e.studentId)));
  return ids;
}

/**
 * Active user accounts that represent a student: the student's own login.
 * (Parent contacts have no accounts, so they get no in-app notifications.)
 */
export async function userIdsForStudent(ctx: QueryCtx, schoolId: Id<"schools">, studentId: Id<"students">): Promise<Id<"users">[]> {
  const ids: Id<"users">[] = [];
  const own = await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
  own.forEach((m) => m.schoolId === schoolId && m.role === "student" && m.status === "active" && !m.guardianId && m.userId && ids.push(m.userId));
  return ids;
}
