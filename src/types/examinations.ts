/**
 * Examinations domain types.
 * Split from src/types/domain.ts (which keeps the demo data model).
 * IDs are plain strings so they can map to Convex `Id<"table">`.
 */
import type { ID, ISODate, ISODateTime } from "./core";

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
