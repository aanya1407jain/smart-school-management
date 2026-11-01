/**
 * Core domain types (school, structure, staff, notices, notifications, accounts). Shared by every build.
 * Split from src/types/domain.ts (which keeps the demo data model).
 * IDs are plain strings so they can map to Convex `Id<"table">`.
 */
import type { ModuleKey } from "@convex/core/modules";

export type ID = string;

export type ISODate = string; // "2026-10-09"

export type ISODateTime = string; // "2026-10-09T09:15:00.000Z"

export interface School {
  name: string;
  shortName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  affiliation: string;
  principalName: string;
  currentAcademicYearId: ID;
  settings: SchoolSettings;
}

export interface SchoolSettings {
  attendanceLateCountsAsPresent: boolean;
  lowAttendanceThreshold: number; // percent
  passPercentage: number;
  currency: "INR";
  weekStartsOn: 1;
  notifications: {
    attendanceAlerts: boolean;
    feeReminders: boolean;
    homeworkAlerts: boolean;
    examAlerts: boolean;
    noticeAlerts: boolean;
  };
}

export type AcademicYearStatus = "active" | "upcoming" | "archived";

export interface AcademicYear {
  id: ID;
  name: string; // "2026–27"
  startDate: ISODate;
  endDate: ISODate;
  status: AcademicYearStatus;
}

export interface SchoolClass {
  id: ID;
  academicYearId: ID;
  grade: number; // 8..12
  name: string; // "Class 10"
  subjectIds: ID[];
}

export interface Section {
  id: ID;
  classId: ID;
  name: string; // "A"
  room: string;
  capacity: number;
  classTeacherId: ID | null;
}

export type Gender = "male" | "female" | "other";

export type TeacherStatus = "active" | "on_leave" | "inactive";

export interface Teacher {
  id: ID;
  employeeId: string;
  title: "Mr." | "Ms." | "Mrs." | "Dr.";
  firstName: string;
  lastName: string;
  gender: Gender;
  email: string;
  phone: string;
  designation: string;
  qualification: string;
  specializationIds: ID[]; // subjects they can teach
  joiningDate: ISODate;
  status: TeacherStatus;
  address: string;
}

export type NoticeType = "notice" | "event" | "holiday";

export type NoticePriority = "low" | "normal" | "high" | "urgent";

export type NoticeAudienceScope = "school" | "teachers" | "students" | "classes" | "sections";

export interface NoticeAudience {
  scope: NoticeAudienceScope;
  classIds?: ID[];
  sectionIds?: ID[];
}

export interface Notice {
  id: ID;
  title: string;
  body: string;
  type: NoticeType;
  audience: NoticeAudience;
  publishDate: ISODate;
  eventDate: ISODate | null;
  /** Last day of a multi-day event or holiday (`eventDate` is the first). */
  endDate?: ISODate | null;
  priority: NoticePriority;
  status: "draft" | "published" | "archived";
  createdBy: ID;
}

export type NotificationCategory = "attendance" | "fees" | "homework" | "examination" | "notice" | "general";

export interface AppNotification {
  id: ID;
  userId: ID;
  category: NotificationCategory;
  title: string;
  message: string;
  createdAt: ISODateTime;
  read: boolean;
  href: string | null;
}

export type Role = "admin" | "teacher" | "student";

/**
 * Demo-data counterpart of a login account. Credentials are NOT here: sign-in
 * is handled by Convex Auth, which stores only password hashes server-side.
 */
export interface UserAccount {
  id: ID;
  /**
   * Login ID of the matching Convex account (demo personas only). The session
   * bridge binds the signed-in identity to this record by Login ID.
   */
  loginId?: string;
  email: string;
  role: Role;
  displayName: string;
  phone: string;
  /** For admins: their job title. */
  title?: string;
  /** For teacher accounts. */
  teacherId?: ID;
  /** For student-portal accounts: the student(s) this login can see. */
  studentIds?: ID[];
  /**
   * Extra permission sets layered on the base role (e.g. a future
   * "accountant" set for administrative staff).
   */
  permissionSets?: string[];
  /**
   * Modules the user's SCHOOL is entitled to (from the server session,
   * convex/core/modules.ts). Set for the signed-in user only; drives navigation.
   */
  modules?: ModuleKey[];
  /**
   * The member's EFFECTIVE permissions as the server computed them (role +
   * permission sets + the Principal's grants, convex/core/grants.ts). Set for
   * the signed-in user from the server session; when present the UI uses it
   * instead of recomputing from the role. UI only — the server re-checks.
   */
  permissions?: string[];
}
