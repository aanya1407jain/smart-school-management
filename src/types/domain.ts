/**
 * The in-browser DEMO data model (D4: internal only, never shipped to
 * customers): the mock database the demo services read and write. The domain
 * types themselves live per owner (core, students, attendance, academics, fees,
 * examinations) and are re-exported here for the demo layer.
 */
export * from "./core";
export * from "./students";
export * from "./attendance";
export * from "./academics";
export * from "./fees";
export * from "./examinations";
import type { AcademicYear, AppNotification, ISODateTime, Notice, School, SchoolClass, Section, Teacher, UserAccount } from "./core";
import type { Enrollment, Guardian, GuardianLink, Student } from "./students";
import type { AttendanceSession, LeaveRequest, StaffAttendance } from "./attendance";
import type { Homework, HomeworkSubmission, Period, Subject, TeacherAssignment, TimetableEntry } from "./academics";
import type { Concession, FeeAssignment, FeeObligation, FeeStructure, Payment, Receipt } from "./fees";
import type { Exam, ExamPaper, Mark } from "./examinations";

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
