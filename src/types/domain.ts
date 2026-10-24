/**
 * Domain model for the Smart School Management System.
 * These types mirror the future database schema (e.g. Convex tables).
 * IDs are plain strings so they can later map to Convex `Id<"table">`.
 */

import type { ModuleKey } from "@convex/core/modules";

export type ID = string;
export type ISODate = string; // "2026-10-09"
export type ISODateTime = string; // "2026-10-09T09:15:00.000Z"

// ---------------------------------------------------------------- School
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

// ---------------------------------------------------------------- Academics
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

export interface Subject {
  id: ID;
  name: string;
  code: string;
  type: "core" | "language" | "elective";
}

export interface TeacherAssignment {
  id: ID;
  academicYearId: ID;
  teacherId: ID;
  sectionId: ID;
  subjectId: ID;
}

// ---------------------------------------------------------------- People
export type Gender = "male" | "female" | "other";
export type StudentStatus = "active" | "inactive" | "transferred" | "alumni";

export interface Student {
  id: ID;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: ISODate;
  bloodGroup: string;
  email: string;
  phone: string;
  address: string;
  admissionDate: ISODate;
  status: StudentStatus;
  documents: StudentDocument[];
}

export interface StudentDocument {
  id: ID;
  name: string;
  kind: "birth_certificate" | "transfer_certificate" | "report_card" | "id_proof" | "photo" | "other";
  uploadedAt: ISODate;
  sizeKb: number;
}

export interface Enrollment {
  id: ID;
  studentId: ID;
  academicYearId: ID;
  sectionId: ID;
  rollNo: number;
  status: "active" | "withdrawn";
}

export interface Guardian {
  id: ID;
  name: string;
  phone: string;
  email: string;
  occupation: string;
  address: string;
}

export interface GuardianLink {
  id: ID;
  guardianId: ID;
  studentId: ID;
  relation: "Mother" | "Father" | "Grandparent" | "Other";
  isPrimary: boolean;
}

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

export type StaffAttendanceStatus = "present" | "absent" | "on_leave";
export interface StaffAttendance {
  id: ID;
  teacherId: ID;
  date: ISODate;
  status: StaffAttendanceStatus;
}

export type LeaveType = "casual" | "sick" | "earned" | "duty";
export type LeaveStatus = "pending" | "approved" | "rejected";
export interface LeaveRequest {
  id: ID;
  teacherId: ID;
  type: LeaveType;
  fromDate: ISODate;
  toDate: ISODate;
  reason: string;
  status: LeaveStatus;
  appliedAt: ISODateTime;
}

// ---------------------------------------------------------------- Attendance
export type AttendanceStatus = "present" | "absent" | "late";
export interface AttendanceSession {
  id: ID;
  sectionId: ID;
  date: ISODate;
  entries: Record<ID, AttendanceStatus>; // studentId -> status
  markedById: ID; // user id
  markedAt: ISODateTime;
}

// ---------------------------------------------------------------- Fees
export interface FeeComponent {
  id: ID;
  label: string; // Tuition, Lab, Activity...
  amount: number;
}
export interface FeeInstallment {
  id: ID;
  label: string; // "Term 1"
  dueDate: ISODate;
  share: number; // fraction of total, all shares sum to 1
}
export interface FeeStructure {
  id: ID;
  academicYearId: ID;
  name: string;
  classIds: ID[];
  components: FeeComponent[];
  installments: FeeInstallment[];
  createdAt: ISODateTime;
}

/** A fee structure assigned to a specific student. Generates obligations. */
export interface FeeAssignment {
  id: ID;
  studentId: ID;
  feeStructureId: ID;
  academicYearId: ID;
  assignedAt: ISODateTime;
}

/** A single amount a student owes by a due date (one per installment). */
export interface FeeObligation {
  id: ID;
  assignmentId: ID;
  studentId: ID;
  label: string;
  amount: number;
  dueDate: ISODate;
}

export interface Concession {
  id: ID;
  studentId: ID;
  assignmentId: ID;
  amount: number;
  reason: string;
  approvedBy: ID;
  createdAt: ISODateTime;
}

export type PaymentMethod = "cash" | "upi" | "card" | "bank_transfer" | "cheque";
export interface Payment {
  id: ID;
  studentId: ID;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidOn: ISODate;
  recordedBy: ID;
  receiptId: ID;
  note?: string;
}

export interface Receipt {
  id: ID;
  receiptNo: string;
  paymentId: ID;
  studentId: ID;
  amount: number;
  issuedAt: ISODateTime;
}

// ---------------------------------------------------------------- Exams
export type ExamStatus = "draft" | "scheduled" | "in_progress" | "marks_entry" | "published";
export interface Exam {
  id: ID;
  academicYearId: ID;
  name: string;
  term: "Term 1" | "Term 2";
  type: "unit_test" | "half_yearly" | "annual" | "practical";
  classIds: ID[];
  startDate: ISODate;
  endDate: ISODate;
  status: ExamStatus;
  publishedAt: ISODateTime | null;
}

export interface ExamPaper {
  id: ID;
  examId: ID;
  classId: ID;
  subjectId: ID;
  date: ISODate;
  startTime: string; // "09:00"
  endTime: string;
  maxMarks: number;
  passMarks: number;
}

export interface Mark {
  id: ID;
  paperId: ID;
  studentId: ID;
  marks: number | null; // null = not entered
  absent: boolean;
  enteredBy: ID;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------- Timetable
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6; // Mon..Sat
export interface Period {
  index: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
}
export interface TimetableEntry {
  id: ID;
  academicYearId: ID;
  sectionId: ID;
  subjectId: ID;
  teacherId: ID;
  day: Weekday;
  period: number;
  startTime: string;
  endTime: string;
  room: string;
}

// ---------------------------------------------------------------- Homework
export interface Homework {
  id: ID;
  title: string;
  description: string;
  subjectId: ID;
  sectionId: ID;
  teacherId: ID;
  assignedOn: ISODate;
  dueDate: ISODate;
  attachmentName: string | null;
  status: "active" | "closed";
}

export type SubmissionStatus = "submitted" | "late" | "reviewed";
export interface HomeworkSubmission {
  id: ID;
  homeworkId: ID;
  studentId: ID;
  submittedAt: ISODateTime;
  content: string;
  attachmentName: string | null;
  status: SubmissionStatus;
  feedback: string | null;
}

// ---------------------------------------------------------------- Notices
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
  priority: NoticePriority;
  status: "draft" | "published" | "archived";
  createdBy: ID;
}

// ---------------------------------------------------------------- Notifications
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

// ---------------------------------------------------------------- Accounts
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

export interface Database {
  version: number;
  seededAt: ISODateTime;
  school: School;
  academicYears: AcademicYear[];
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  teacherAssignments: TeacherAssignment[];
  students: Student[];
  enrollments: Enrollment[];
  guardians: Guardian[];
  guardianLinks: GuardianLink[];
  teachers: Teacher[];
  staffAttendance: StaffAttendance[];
  leaveRequests: LeaveRequest[];
  attendance: AttendanceSession[];
  feeStructures: FeeStructure[];
  feeAssignments: FeeAssignment[];
  feeObligations: FeeObligation[];
  concessions: Concession[];
  payments: Payment[];
  receipts: Receipt[];
  exams: Exam[];
  examPapers: ExamPaper[];
  marks: Mark[];
  periods: Period[];
  timetable: TimetableEntry[];
  homework: Homework[];
  submissions: HomeworkSubmission[];
  notices: Notice[];
  notifications: AppNotification[];
  users: UserAccount[];
}
