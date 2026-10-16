/**
 * Shared Convex validators and value-level validation helpers.
 *
 * Convention: every enum-like field is declared ONCE here and reused by the
 * schema and by function `args`, so the database and the API can never drift.
 */
import { v, type Infer } from "convex/values";
import { ROLES, PERMISSION_SET_NAMES } from "./permissions";
import { invalid } from "./errors";
import { canonicalLoginId, LOGIN_ID_RULES_TEXT } from "../model/loginIds";

// ---------------------------------------------------------------- enums
export const vRole = v.union(v.literal("admin"), v.literal("teacher"), v.literal("student"));
export type RoleValue = Infer<typeof vRole>;
// Compile-time guard: vRole must match the permission catalogue.
const _rolesMatch: readonly RoleValue[] = ROLES;
void _rolesMatch;

export const vPermissionSet = v.literal("accountant");
const _setsMatch: readonly Infer<typeof vPermissionSet>[] = PERMISSION_SET_NAMES;
void _setsMatch;

export const vMembershipStatus = v.union(v.literal("invited"), v.literal("active"), v.literal("suspended"));
export const vSchoolStatus = v.union(v.literal("active"), v.literal("suspended"), v.literal("archived"));
export const vAcademicYearStatus = v.union(v.literal("planned"), v.literal("active"), v.literal("closed"));
export const vGender = v.union(v.literal("male"), v.literal("female"), v.literal("other"));
export const vPersonStatus = v.union(v.literal("active"), v.literal("inactive"), v.literal("alumni"), v.literal("transferred"));
export const vStaffStatus = v.union(v.literal("active"), v.literal("on_leave"), v.literal("inactive"));
/** Daily staff (teacher) attendance — matches the Teachers & Staff UI. */
export const vStaffAttendanceStatus = v.union(v.literal("present"), v.literal("absent"), v.literal("on_leave"));
export const vLeaveType = v.union(v.literal("casual"), v.literal("sick"), v.literal("earned"), v.literal("duty"));
export const vLeaveStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));
export const vEnrollmentStatus = v.union(
  v.literal("active"), v.literal("promoted"), v.literal("transferred"), v.literal("withdrawn"), v.literal("completed"),
);
export const vAttendanceStatus = v.union(v.literal("present"), v.literal("absent"), v.literal("late"), v.literal("excused"));
export type AttendanceStatusValue = Infer<typeof vAttendanceStatus>;

export const vPaymentMethod = v.union(
  v.literal("cash"), v.literal("upi"), v.literal("card"), v.literal("bank_transfer"), v.literal("cheque"), v.literal("online"),
);
export const vPaymentStatus = v.union(v.literal("completed"), v.literal("reversed"));
export const vConcessionKind = v.union(v.literal("percent"), v.literal("fixed"));
/**
 * Exam lifecycle (same order as the UI's EXAM_STATUS_FLOW):
 *   draft → scheduled → in_progress → marks_entry → published
 * Marks can be entered in `in_progress` and `marks_entry`; publishing requires
 * one of those two states and no pending paper–section sheets.
 */
export const EXAM_STATUSES = ["draft", "scheduled", "in_progress", "marks_entry", "published"] as const;
export const vExamStatus = v.union(
  v.literal("draft"), v.literal("scheduled"), v.literal("in_progress"), v.literal("marks_entry"), v.literal("published"),
);
export type ExamStatusValue = Infer<typeof vExamStatus>;
const _examStatusesMatch: readonly ExamStatusValue[] = EXAM_STATUSES;
void _examStatusesMatch;

/** Homework is either open for submission (`active`) or `closed`. There are no drafts in the product. */
export const vHomeworkStatus = v.union(v.literal("active"), v.literal("closed"));
export const vSubmissionStatus = v.union(v.literal("submitted"), v.literal("late"), v.literal("reviewed"));
export const vNoticeStatus = v.union(v.literal("draft"), v.literal("published"), v.literal("archived"));
export const vNoticeType = v.union(v.literal("notice"), v.literal("event"), v.literal("holiday"));
export const vPriority = v.union(v.literal("normal"), v.literal("high"), v.literal("urgent"));
export const vEventKind = v.union(v.literal("event"), v.literal("holiday"), v.literal("exam"), v.literal("meeting"));
export const vNotificationType = v.union(
  v.literal("general"), v.literal("attendance"), v.literal("fees"), v.literal("homework"),
  v.literal("examination"), v.literal("notice"), v.literal("account"),
);
export const vFileKind = v.union(
  v.literal("student_document"), v.literal("profile_photo"), v.literal("receipt"), v.literal("report_card"), v.literal("school_document"),
  v.literal("homework_attachment"), v.literal("submission_attachment"),
);
export const vFileOwnerType = v.union(
  v.literal("student"), v.literal("teacher"), v.literal("school"), v.literal("receipt"), v.literal("result"),
  v.literal("homework"), v.literal("submission"),
);

/** Who a notice / event is addressed to. Resolved server-side, never trusted from the client for visibility. */
export const vAudience = v.union(
  v.object({ kind: v.literal("all") }),
  v.object({ kind: v.literal("roles"), roles: v.array(vRole) }),
  v.object({ kind: v.literal("classes"), classIds: v.array(v.id("classes")) }),
  v.object({ kind: v.literal("sections"), sectionIds: v.array(v.id("sections")) }),
);

/** Polymorphic pointer used by notifications and audit logs. */
export const vEntityRef = v.object({ table: v.string(), id: v.string() });

// ---------------------------------------------------------------- value checks
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate a calendar date string "YYYY-MM-DD" (rejects 2026-02-30). */
export function assertIsoDate(value: string, field = "date"): string {
  if (!ISO_DATE.test(value)) throw invalid(`${field} must be a date in YYYY-MM-DD format`, { [field]: "Invalid date" });
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw invalid(`${field} is not a real calendar date`, { [field]: "Invalid date" });
  }
  return value;
}

export function assertTime(value: string, field = "time"): string {
  if (!HH_MM.test(value)) throw invalid(`${field} must be HH:MM (24-hour)`, { [field]: "Invalid time" });
  return value;
}

/** Money is stored as integer minor units (paise). Never floats. */
export function assertAmountMinor(value: number, field = "amount", { allowZero = false } = {}): number {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw invalid(`${field} must be a ${allowZero ? "non-negative" : "positive"} whole number of minor units (e.g. paise)`, { [field]: "Invalid amount" });
  }
  return value;
}

export function assertNonEmpty(value: string, field: string, max = 200): string {
  const t = value.trim();
  if (!t) throw invalid(`${field} is required`, { [field]: "Required" });
  if (t.length > max) throw invalid(`${field} is too long (max ${max} characters)`, { [field]: "Too long" });
  return t;
}

/** Normalise an email for identity matching (trim, lowercase, NFKC). */
export function normalizeEmail(value: string): string {
  const e = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw invalid("Enter a valid email address", { email: "Invalid email" });
  return e;
}

/** Canonical Login ID (see convex/model/loginIds.ts) or INVALID_ARGUMENT. */
export function normalizeLoginId(value: string, field = "loginId"): string {
  const id = canonicalLoginId(value);
  if (!id) throw invalid(`Login ID must be ${LOGIN_ID_RULES_TEXT}`, { [field]: "Invalid Login ID" });
  return id;
}

/** Day of week for an ISO date: 0 = Sunday … 6 = Saturday (UTC calendar). */
export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}
