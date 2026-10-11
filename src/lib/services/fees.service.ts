import type { Database, FeeStructure, ID, PaymentMethod } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { todayISO, addDays } from "@/lib/utils/dates";
import { formatCurrency } from "@/lib/utils/format";
import { handle, invalid, notFound, requireActor, requireAny, requirePermission, assertStudentInScope, ServiceError } from "./core";
import { academicYearCode, accountsForStudent, currentEnrollment, schoolCode, feeLedger, fullName, sectionInfo, type FeeStanding } from "./derive";
import { notify } from "./notify";

// ------------------------------------------------------------------ helpers shared with other services

export function feeStructureTotal(fs: FeeStructure) {
  return fs.components.reduce((a, c) => a + c.amount, 0);
}

/** Assigns a structure to a student and generates one obligation per installment. */
export function assignStructure(db: Database, structureId: ID, studentId: ID): boolean {
  const fs = db.feeStructures.find((f) => f.id === structureId);
  if (!fs) throw notFound("Fee structure");
  if (db.feeAssignments.some((a) => a.studentId === studentId && a.feeStructureId === structureId)) return false;
  const assignment = { id: newId("fa"), studentId, feeStructureId: fs.id, academicYearId: fs.academicYearId, assignedAt: new Date().toISOString() };
  db.feeAssignments.push(assignment);
  const total = feeStructureTotal(fs);
  let allocated = 0;
  fs.installments.forEach((ins, i) => {
    const amount = i === fs.installments.length - 1 ? total - allocated : Math.round(total * ins.share);
    allocated += amount;
    db.feeObligations.push({ id: newId("fo"), assignmentId: assignment.id, studentId, label: ins.label, amount, dueDate: ins.dueDate });
  });
  return true;
}

function nextReceiptNo(db: Database) {
  const max = db.receipts.reduce((m, r) => Math.max(m, Number(r.receiptNo.split("/").pop()) || 0), 0);
  return `${schoolCode(db.school)}/${academicYearCode(db)}/${String(max + 1).padStart(4, "0")}`;
}

// ------------------------------------------------------------------ service

export interface FeeBalanceFilters {
  search?: string;
  classId?: string;
  sectionId?: string;
  standing?: FeeStanding | "all";
}

export interface StructureInput {
  name: string;
  classIds: ID[];
  components: { label: string; amount: number }[];
  installments: { label: string; dueDate: string; share: number }[];
}

export interface PaymentInput {
  studentId: ID;
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  note?: string;
}

export const mockFeeService = {
  async listStructures() {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      const db = readDb();
      return db.feeStructures.map((fs) => ({
        ...fs,
        total: feeStructureTotal(fs),
        classNames: fs.classIds.map((id) => db.classes.find((c) => c.id === id)?.name ?? id),
        assignedCount: db.feeAssignments.filter((a) => a.feeStructureId === fs.id).length,
        eligibleCount: db.enrollments.filter((e) => fs.classIds.includes(db.sections.find((s) => s.id === e.sectionId)?.classId ?? "")).length,
      }));
    });
  },

  async createStructure(input: StructureInput) {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      if (!input.name.trim()) throw invalid("Name is required.", { name: "Name is required" });
      if (!input.classIds.length) throw invalid("Select at least one class.");
      if (!input.components.length) throw invalid("Add at least one fee component.");
      const shares = input.installments.reduce((a, i) => a + i.share, 0);
      if (Math.abs(shares - 1) > 0.001) throw invalid("Installment shares must add up to 100%.");
      return writeDb((db) => {
        const fs: FeeStructure = {
          id: newId("fs"),
          academicYearId: db.school.currentAcademicYearId,
          name: input.name.trim(),
          classIds: input.classIds,
          components: input.components.map((c) => ({ id: newId("fc"), label: c.label, amount: Math.round(c.amount) })),
          installments: input.installments.map((i) => ({ id: newId("fi"), label: i.label, dueDate: i.dueDate, share: i.share })),
          createdAt: new Date().toISOString(),
        };
        db.feeStructures.push(fs);
        return { id: fs.id };
      });
    });
  },

  /** Assign a structure to every active student in its classes (or the given students). */
  async assignStructure(structureId: ID, studentIds?: ID[]) {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      return writeDb((db) => {
        const fs = db.feeStructures.find((f) => f.id === structureId);
        if (!fs) throw notFound("Fee structure");
        const targets = studentIds ?? db.enrollments
          .filter((e) => e.academicYearId === fs.academicYearId && e.status === "active" && fs.classIds.includes(db.sections.find((s) => s.id === e.sectionId)?.classId ?? ""))
          .map((e) => e.studentId);
        let assigned = 0;
        for (const sid of targets) {
          if (assignStructure(db, structureId, sid)) {
            assigned += 1;
            notify(db, accountsForStudent(db, sid).map((u) => u.id), {
              category: "fees", title: "New fee assigned", message: `${fs.name} — ${formatCurrency(feeStructureTotal(fs))}`, href: "/student/fees",
            });
          }
        }
        return { assigned, skipped: targets.length - assigned };
      });
    });
  },

  async listBalances(filters: FeeBalanceFilters = {}) {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      const db = readDb();
      const q = filters.search?.trim().toLowerCase();
      const rows = db.students
        .filter((s) => s.status === "active")
        .map((s) => {
          const enr = currentEnrollment(db, s.id);
          const info = sectionInfo(db, enr?.sectionId);
          const ledger = feeLedger(db, s.id);
          return {
            studentId: s.id,
            name: fullName(s),
            admissionNo: s.admissionNo,
            classId: info.cls?.id ?? "",
            sectionId: enr?.sectionId ?? "",
            classLabel: info.label,
            grade: info.cls?.grade ?? 0,
            ...ledger.totals,
            standing: ledger.standing,
            nextDue: ledger.nextDue ? { label: ledger.nextDue.label, dueDate: ledger.nextDue.dueDate, outstanding: ledger.nextDue.outstanding } : null,
            lastPayment: ledger.payments.at(-1)?.paidOn ?? null,
          };
        })
        .filter((r) => !filters.classId || r.classId === filters.classId)
        .filter((r) => !filters.sectionId || r.sectionId === filters.sectionId)
        .filter((r) => !filters.standing || filters.standing === "all" || r.standing === filters.standing)
        .filter((r) => !q || r.name.toLowerCase().includes(q) || r.admissionNo.toLowerCase().includes(q));
      rows.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding || a.name.localeCompare(b.name));
      return rows;
    });
  },

  async getSummary() {
    return handle(() => {
      requireAny(requireActor(), ["fees:manage", "reports:read", "reports:finance"]);
      const db = readDb();
      const today = todayISO();
      let gross = 0, concession = 0, paid = 0, outstanding = 0, overdue = 0, dueSoon = 0;
      const standing: Record<FeeStanding, number> = { paid: 0, clear: 0, due_soon: 0, overdue: 0, not_assigned: 0 };
      const byClass: Record<string, { name: string; collected: number; outstanding: number }> = {};
      for (const s of db.students.filter((x) => x.status === "active")) {
        const l = feeLedger(db, s.id, today);
        gross += l.totals.gross; concession += l.totals.concession; paid += l.totals.paid;
        outstanding += l.totals.outstanding; overdue += l.totals.overdue; dueSoon += l.totals.dueSoon;
        standing[l.standing] += 1;
        const info = sectionInfo(db, currentEnrollment(db, s.id)?.sectionId);
        const key = info.cls?.name ?? "Unassigned";
        byClass[key] ??= { name: key, collected: 0, outstanding: 0 };
        byClass[key].collected += l.totals.paid;
        byClass[key].outstanding += l.totals.outstanding;
      }
      // Monthly collections for the current academic year
      const months: { key: string; label: string; amount: number }[] = [];
      for (let m = 0; m < 12; m++) {
        const d = new Date(2026, 3 + m, 1);
        if (d > new Date()) break;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        months.push({ key, label: d.toLocaleString("en-IN", { month: "short" }), amount: 0 });
      }
      db.payments.forEach((p) => {
        const m = months.find((x) => p.paidOn.startsWith(x.key));
        if (m) m.amount += p.amount;
      });
      const recentPayments = [...db.payments]
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.id.localeCompare(a.id))
        .slice(0, 6)
        .map((p) => {
          const s = db.students.find((x) => x.id === p.studentId)!;
          return { ...p, studentName: fullName(s), receiptNo: db.receipts.find((r) => r.id === p.receiptId)?.receiptNo ?? "" };
        });
      const collectionRate = gross - concession > 0 ? (paid / (gross - concession)) * 100 : 0;
      return {
        totals: { gross, concession, net: gross - concession, paid, outstanding, overdue, dueSoon, collectionRate },
        standing,
        byClass: Object.values(byClass).sort((a, b) => Number(a.name.split(" ")[1]) - Number(b.name.split(" ")[1])),
        monthly: months,
        recentPayments,
      };
    });
  },

  /** Ledger for one student. Admin sees anyone; student-portal accounts only their linked students. */
  async getStudentLedger(studentId: ID) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["fees:manage", "fees:read:own"]);
      if (actor.role !== "admin") assertStudentInScope(actor, studentId);
      const db = readDb();
      const s = db.students.find((x) => x.id === studentId);
      if (!s) throw notFound("Student");
      const enr = currentEnrollment(db, studentId);
      const ledger = feeLedger(db, studentId);
      return {
        student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo, classLabel: sectionInfo(db, enr?.sectionId).longLabel },
        ...ledger,
        payments: ledger.payments.map((p) => ({ ...p, receiptNo: db.receipts.find((r) => r.id === p.receiptId)?.receiptNo ?? "" })),
        availableStructures: db.feeStructures
          .filter((fs) => !ledger.assignments.some((a) => a.feeStructureId === fs.id))
          .map((fs) => ({ id: fs.id, name: fs.name, total: feeStructureTotal(fs) })),
      };
    });
  },

  async recordPayment(input: PaymentInput) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "fees:manage");
      const errors: Record<string, string> = {};
      if (!(input.amount > 0)) errors.amount = "Enter an amount greater than zero";
      if (!input.paidOn) errors.paidOn = "Payment date is required";
      if (input.method !== "cash" && !input.reference.trim()) errors.reference = "Reference is required for non-cash payments";
      if (Object.keys(errors).length) throw invalid("Please fix the highlighted fields.", errors);
      return writeDb((db) => {
        const ledger = feeLedger(db, input.studentId);
        if (!ledger.assignments.length) throw new ServiceError("CONFLICT", "Assign a fee structure to this student before recording a payment.");
        if (input.amount > ledger.totals.outstanding) {
          throw invalid(`Amount exceeds the outstanding balance of ${formatCurrency(ledger.totals.outstanding)}.`, { amount: `Maximum ${formatCurrency(ledger.totals.outstanding)}` });
        }
        const paymentId = newId("pay");
        const receiptId = newId("rcpt");
        const receiptNo = nextReceiptNo(db);
        db.payments.push({ id: paymentId, studentId: input.studentId, amount: Math.round(input.amount), method: input.method, reference: input.reference.trim() || "CASH", paidOn: input.paidOn, recordedBy: actor.id, receiptId, note: input.note });
        db.receipts.push({ id: receiptId, receiptNo, paymentId, studentId: input.studentId, amount: Math.round(input.amount), issuedAt: new Date().toISOString() });
        const s = db.students.find((x) => x.id === input.studentId)!;
        notify(db, accountsForStudent(db, input.studentId).map((u) => u.id), {
          category: "fees", title: `Payment received — ${formatCurrency(input.amount)}`, message: `Receipt ${receiptNo} issued for ${fullName(s)}.`, href: "/student/fees",
        });
        return { paymentId, receiptId, receiptNo };
      });
    });
  },

  async addConcession(studentId: ID, amount: number, reason: string) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "fees:manage");
      if (!(amount > 0)) throw invalid("Enter a concession amount.", { amount: "Required" });
      if (!reason.trim()) throw invalid("Reason is required.", { reason: "Required" });
      return writeDb((db) => {
        const ledger = feeLedger(db, studentId);
        const asg = ledger.assignments[0];
        if (!asg) throw new ServiceError("CONFLICT", "Assign a fee structure first.");
        if (amount > ledger.totals.outstanding) throw invalid("Concession cannot exceed the outstanding balance.", { amount: `Maximum ${formatCurrency(ledger.totals.outstanding)}` });
        db.concessions.push({ id: newId("con"), studentId, assignmentId: asg.id, amount: Math.round(amount), reason: reason.trim(), approvedBy: actor.id, createdAt: new Date().toISOString() });
        notify(db, accountsForStudent(db, studentId).map((u) => u.id), { category: "fees", title: "Fee concession applied", message: `${formatCurrency(amount)} — ${reason.trim()}`, href: "/student/fees" });
        return { ok: true };
      });
    });
  },

  async getReceipt(receiptId: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const r = db.receipts.find((x) => x.id === receiptId);
      if (!r) throw notFound("Receipt");
      requireAny(actor, ["fees:manage", "fees:read:own"]);
      if (actor.role !== "admin") assertStudentInScope(actor, r.studentId);
      const p = db.payments.find((x) => x.id === r.paymentId)!;
      const s = db.students.find((x) => x.id === r.studentId)!;
      const enr = currentEnrollment(db, s.id);
      const recordedBy = db.users.find((u) => u.id === p.recordedBy)?.displayName ?? "School office";
      const ledgerAfter = feeLedger(db, s.id);
      return {
        receipt: r, payment: p, recordedBy,
        student: { name: fullName(s), admissionNo: s.admissionNo, classLabel: sectionInfo(db, enr?.sectionId).longLabel },
        school: db.school,
        balanceNow: ledgerAfter.totals.outstanding,
      };
    });
  },

  async listPayments(filters: { from?: string; to?: string; search?: string; classId?: string; method?: string } = {}) {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      const db = readDb();
      const q = filters.search?.trim().toLowerCase();
      return db.payments
        .filter((p) => (!filters.from || p.paidOn >= filters.from) && (!filters.to || p.paidOn <= filters.to))
        .filter((p) => !filters.method || p.method === filters.method)
        .map((p) => {
          const s = db.students.find((x) => x.id === p.studentId)!;
          const info = sectionInfo(db, currentEnrollment(db, s.id)?.sectionId);
          return { ...p, studentName: fullName(s), admissionNo: s.admissionNo, classId: info.cls?.id ?? "", classLabel: info.label, receiptNo: db.receipts.find((r) => r.id === p.receiptId)?.receiptNo ?? "" };
        })
        .filter((p) => !filters.classId || p.classId === filters.classId)
        .filter((p) => !q || p.studentName.toLowerCase().includes(q) || p.receiptNo.toLowerCase().includes(q) || p.admissionNo.toLowerCase().includes(q))
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.receiptNo.localeCompare(a.receiptNo));
    });
  },

  /** Lightweight student picker for "Collect fee". */
  async searchStudents(term: string) {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      const db = readDb();
      const q = term.trim().toLowerCase();
      if (q.length < 2) return [];
      return db.students
        .filter((s) => s.status === "active" && (fullName(s).toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q)))
        .slice(0, 8)
        .map((s) => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo, classLabel: sectionInfo(db, currentEnrollment(db, s.id)?.sectionId).label, outstanding: feeLedger(db, s.id).totals.outstanding }));
    });
  },

  /** Students whose next installment falls due within `days` (for dashboards). */
  async getUpcomingDues(days = 15) {
    return handle(() => {
      requirePermission(requireActor(), "fees:manage");
      const db = readDb();
      const today = todayISO();
      const limit = addDays(today, days);
      return db.students
        .map((s) => ({ s, l: feeLedger(db, s.id, today) }))
        .filter(({ l }) => l.nextDue && l.nextDue.dueDate <= limit)
        .map(({ s, l }) => ({ studentId: s.id, name: fullName(s), dueDate: l.nextDue!.dueDate, amount: l.nextDue!.outstanding, overdue: l.nextDue!.status === "overdue" }));
    });
  },
};

export type FeeService = typeof mockFeeService;
