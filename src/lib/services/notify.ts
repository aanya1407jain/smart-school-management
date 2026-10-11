import type { AppNotification, Database, ID, NotificationCategory } from "@/types/domain";
import { newId } from "@/lib/utils/ids";

const SETTING_FOR: Partial<Record<NotificationCategory, keyof Database["school"]["settings"]["notifications"]>> = {
  attendance: "attendanceAlerts",
  fees: "feeReminders",
  homework: "homeworkAlerts",
  examination: "examAlerts",
  notice: "noticeAlerts",
};

/**
 * Fan-out helper used inside mutations (the future backend would do this in
 * the same transaction or via a scheduled job).
 */
export function notify(
  db: Database,
  userIds: ID[],
  n: { category: NotificationCategory; title: string; message: string; href: string | null },
) {
  const settingKey = SETTING_FOR[n.category];
  if (settingKey && !db.school.settings.notifications[settingKey]) return;
  const createdAt = new Date().toISOString();
  const unique = Array.from(new Set(userIds));
  const items: AppNotification[] = unique.map((userId) => ({ id: newId("nf"), userId, read: false, createdAt, ...n }));
  db.notifications.unshift(...items);
}
