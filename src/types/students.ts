/**
 * Students domain types.
 * Split from src/types/domain.ts (which keeps the demo data model).
 * IDs are plain strings so they can map to Convex `Id<"table">`.
 */
import type { Gender, ID, ISODate } from "./core";

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

/** Admin dashboard "Student Achievements & Honors" showcase (demo data only; not a stored record yet). */
export type AchievementCategory = "sports" | "academic" | "special";

export interface StudentAchievement {
  id: ID;
  studentName: string;
  /** e.g. "10-A" */
  classLabel: string;
  category: AchievementCategory;
  title: string;
  highlight: string;
  date: ISODate;
}

/** An admitted student's editable record (demo editor; live edits use convex/students.ts). */
export interface StudentEditInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: string;
  bloodGroup: string;
  email: string;
  phone: string;
  address: string;
  admissionDate: string;
  sectionId: ID;
  status: StudentStatus;
  guardian: { name: string; relation: GuardianLink["relation"]; phone: string; email: string; occupation: string };
  assignFees?: boolean;
}
