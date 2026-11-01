/** Core labels. Module labels live with their module (features/<module>/labels.ts). */
import type { NoticeAudienceScope, NoticePriority, NoticeType, NotificationCategory } from "@/types/core";

export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = { notice: "Notice", event: "Event", holiday: "Holiday" };
export const PRIORITY_LABELS: Record<NoticePriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const AUDIENCE_LABELS: Record<NoticeAudienceScope, string> = {
  school: "Whole school", teachers: "Teachers only", students: "Students", classes: "Specific classes", sections: "Specific sections",
};
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  attendance: "Attendance", fees: "Fees", homework: "Homework", examination: "Examination", notice: "Notice", general: "General",
};
