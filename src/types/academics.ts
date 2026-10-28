/**
 * Academics domain types (subjects, assignments, timetable, homework).
 * Split from src/types/domain.ts (which keeps the demo data model).
 * IDs are plain strings so they can map to Convex `Id<"table">`.
 */
import type { ID, ISODate, ISODateTime } from "./core";

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
