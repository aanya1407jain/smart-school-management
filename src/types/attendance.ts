/**
 * Attendance domain types (student registers, staff attendance, leave).
 * Split from src/types/domain.ts (which keeps the demo data model).
 * IDs are plain strings so they can map to Convex `Id<"table">`.
 */
import type { ID, ISODate, ISODateTime } from "./core";

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

export type AttendanceStatus = "present" | "absent" | "late";

export interface AttendanceSession {
  id: ID;
  sectionId: ID;
  date: ISODate;
  entries: Record<ID, AttendanceStatus>; // studentId -> status
  markedById: ID; // user id
  markedAt: ISODateTime;
}
