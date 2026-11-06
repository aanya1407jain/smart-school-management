/**
 * Audit-log categories and outcomes, derived from the action name
 * ("<entity>.<verb>"). Pure (no database), shared by the server
 * (model/audit.ts writeAudit stores `category`) and the admin UI (filters,
 * colours). Adding an action never needs a code change here unless it should
 * land in a category other than its prefix's.
 */
import { v } from "convex/values";

export const AUDIT_CATEGORIES = ["AUTHENTICATION", "ACADEMICS", "FEES", "STUDENTS", "STAFF", "SETTINGS"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export const vAuditCategory = v.union(
  v.literal("AUTHENTICATION"), v.literal("ACADEMICS"), v.literal("FEES"),
  v.literal("STUDENTS"), v.literal("STAFF"), v.literal("SETTINGS"),
);

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  AUTHENTICATION: "Authentication",
  ACADEMICS: "Academics",
  FEES: "Fees",
  STUDENTS: "Students",
  STAFF: "Staff",
  SETTINGS: "Settings",
};

/** Exact actions whose category differs from their prefix's. */
const BY_ACTION: Record<string, AuditCategory> = {
  PASSWORD_OVERWRITE: "AUTHENTICATION",
  "account.password_changed": "AUTHENTICATION",
  "account.credentials_issued": "AUTHENTICATION",
  "account.login_id_changed": "AUTHENTICATION",
  "import.students": "STUDENTS",
  "import.teachers": "STAFF",
};

const BY_PREFIX: Record<string, AuditCategory> = {
  auth: "AUTHENTICATION",
  credential: "AUTHENTICATION",
  fees: "FEES",
  student: "STUDENTS",
  students: "STUDENTS",
  enrollment: "STUDENTS",
  admission_register: "STUDENTS",
  guardian: "STUDENTS",
  teacher: "STAFF",
  staff_attendance: "STAFF",
  leave: "STAFF",
  membership: "STAFF",
  account: "STAFF",
  accounts: "STAFF",
  attendance: "ACADEMICS",
  exam: "ACADEMICS",
  marks: "ACADEMICS",
  homework: "ACADEMICS",
  timetable: "ACADEMICS",
  curriculum: "ACADEMICS",
  subject: "ACADEMICS",
  class: "ACADEMICS",
  section: "ACADEMICS",
  teacher_assignment: "ACADEMICS",
  academic_year: "ACADEMICS",
};

/** The category of an audit action; anything unknown (school, notices, files, exports…) is SETTINGS. */
export function auditCategoryOf(action: string): AuditCategory {
  return BY_ACTION[action] ?? BY_PREFIX[action.split(".")[0]] ?? "SETTINGS";
}

export type AuditOutcome = "success" | "failed" | "blocked";

/** Whether the recorded event was a refusal: "*_failed" → failed, "*_locked" / "*_blocked" → blocked. */
export function auditOutcomeOf(action: string): AuditOutcome {
  if (/_(locked|blocked)$/.test(action)) return "blocked";
  if (/_failed$/.test(action)) return "failed";
  return "success";
}
