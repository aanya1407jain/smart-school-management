import type { LeaveType, NoticeAudienceScope, NoticePriority, NoticeType, PaymentMethod, NotificationCategory } from "@/types/domain";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", cheque: "Cheque",
};
export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = { notice: "Notice", event: "Event", holiday: "Holiday" };
export const PRIORITY_LABELS: Record<NoticePriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const AUDIENCE_LABELS: Record<NoticeAudienceScope, string> = {
  school: "Whole school", teachers: "Teachers only", students: "Students & guardians", classes: "Specific classes", sections: "Specific sections",
};
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = { casual: "Casual", sick: "Sick", earned: "Earned", duty: "On duty" };
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  attendance: "Attendance", fees: "Fees", homework: "Homework", examination: "Examination", notice: "Notice", general: "General",
};
export const EXAM_TYPE_LABELS = { unit_test: "Unit test", half_yearly: "Half-yearly", annual: "Annual", practical: "Practical" } as const;
