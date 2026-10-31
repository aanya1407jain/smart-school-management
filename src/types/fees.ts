/**
 * Fees domain types.
 * Split from src/types/domain.ts (which keeps the demo data model).
 * IDs are plain strings so they can map to Convex `Id<"table">`.
 */
import type { ID, ISODate, ISODateTime } from "./core";

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

/** A student's fee position (balances filter). */
export type FeeStanding = "paid" | "clear" | "due_soon" | "overdue" | "not_assigned";

export type ObligationStatus = "paid" | "partial" | "overdue" | "due" | "upcoming";
/** An obligation with its concession, payments and status (fee tables). */
export interface ObligationView extends FeeObligation {
  concession: number;
  net: number;
  paid: number;
  outstanding: number;
  status: ObligationStatus;
}
