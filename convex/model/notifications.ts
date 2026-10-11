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
};

export async function notifyUsers(ctx: MutationCtx, schoolId: Id<"schools">, userIds: Iterable<Id<"users">>, n: NotificationInput) {
  const unique = new Set(userIds);
  for (const userId of unique) {
    await ctx.db.insert("notifications", { schoolId, userId, isRead: false, ...n });
  }
  return unique.size;
}

/** Active user accounts that represent a student: the student's own login and linked guardians' logins. */
export async function userIdsForStudent(ctx: QueryCtx, schoolId: Id<"schools">, studentId: Id<"students">): Promise<Id<"users">[]> {
  const ids: Id<"users">[] = [];
  const own = await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
  own.forEach((m) => m.schoolId === schoolId && m.status === "active" && m.userId && ids.push(m.userId));
  const links = await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
  for (const link of links) {
    if (link.schoolId !== schoolId) continue;
    const gm = await ctx.db.query("schoolMemberships").withIndex("by_guardian", (q) => q.eq("guardianId", link.guardianId)).collect();
    gm.forEach((m) => m.schoolId === schoolId && m.status === "active" && m.userId && ids.push(m.userId));
  }
  return ids;
}
