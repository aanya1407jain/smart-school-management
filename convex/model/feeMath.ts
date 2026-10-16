/**
 * Pure fee arithmetic shared by every fee read (one student's ledger, the
 * school-wide balances list, the fee overview and the reports), so a total
 * shown on one screen always equals the sum of the ledgers behind it.
 *
 * Rules (all amounts integer minor units):
 *  - only `active` obligations count; only payments that are `completed`,
 *    are not themselves reversals, and have not been reversed count;
 *  - concessions: a per-obligation concession applies to that obligation; a
 *    year-wide PERCENT concession (basis points) applies to every obligation;
 *    a year-wide FIXED concession is spread over obligations in due-date
 *    order. A concession never takes an obligation below zero;
 *  - an obligation's status: paid (nothing outstanding), overdue (due date
 *    passed), partial (something paid), due (due within DUE_SOON_DAYS) or
 *    upcoming;
 *  - a student's standing: not_assigned (no obligations), paid, overdue,
 *    due_soon (something due soon or part-paid) or clear.
 */
import type { Doc, Id } from "../_generated/dataModel";
import { daysBetween } from "./calendar";

export const DUE_SOON_DAYS = 30;

export type ObligationStatus = "paid" | "overdue" | "partial" | "due" | "upcoming";
export type FeeStanding = "paid" | "clear" | "due_soon" | "overdue" | "not_assigned";

export type LedgerRow = {
  obligationId: Id<"studentFees">;
  feeStructureId: Id<"feeStructures">;
  label: string;
  dueDate: string;
  amountMinor: number;
  concessionMinor: number;
  netMinor: number;
  paidMinor: number;
  outstandingMinor: number;
};

/** Payments that count toward balances: completed originals that have not been reversed. */
export function effectivePayments(all: Doc<"feePayments">[]): Doc<"feePayments">[] {
  const reversed = new Set(all.map((p) => p.reversalOfPaymentId).filter((x): x is Id<"feePayments"> => !!x));
  return all.filter((p) => p.status === "completed" && !p.reversalOfPaymentId && !reversed.has(p._id));
}

/**
 * One student's obligations with concession, paid and outstanding amounts.
 * Inputs must already be limited to that student and year (any order).
 */
export function computeLedger(
  obligationsIn: Doc<"studentFees">[],
  concessionsIn: Doc<"feeConcessions">[],
  payments: Doc<"feePayments">[],
): { rows: LedgerRow[]; totals: { grossMinor: number; concessionMinor: number; paidMinor: number; outstandingMinor: number } } {
  const obligations = obligationsIn.filter((o) => o.status === "active").sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a._creationTime - b._creationTime);
  const concessions = concessionsIn.filter((c) => c.status === "active");
  const concessionBy = new Map<Id<"studentFees">, number>();
  for (const o of obligations) {
    let c = 0;
    for (const k of concessions) {
      if (k.studentFeeId && k.studentFeeId !== o._id) continue;
      if (k.kind === "percent") c += Math.round((o.amountMinor * k.value) / 10000);
      else if (k.studentFeeId) c += k.value;
    }
    concessionBy.set(o._id, Math.min(c, o.amountMinor));
  }
  for (const k of concessions.filter((x) => x.kind === "fixed" && !x.studentFeeId)) {
    let left = k.value;
    for (const o of obligations) {
      if (left <= 0) break;
      const room = o.amountMinor - (concessionBy.get(o._id) ?? 0);
      const take = Math.min(room, left);
      concessionBy.set(o._id, (concessionBy.get(o._id) ?? 0) + take);
      left -= take;
    }
  }
  const paidBy = new Map<Id<"studentFees">, number>();
  for (const p of payments) for (const a of p.allocations) paidBy.set(a.studentFeeId, (paidBy.get(a.studentFeeId) ?? 0) + a.amountMinor);
  const rows = obligations.map((o) => {
    const concession = concessionBy.get(o._id) ?? 0;
    const paid = paidBy.get(o._id) ?? 0;
    const net = o.amountMinor - concession;
    return { obligationId: o._id, feeStructureId: o.feeStructureId, label: o.label, dueDate: o.dueDate, amountMinor: o.amountMinor, concessionMinor: concession, netMinor: net, paidMinor: paid, outstandingMinor: Math.max(0, net - paid) };
  });
  const sum = (f: (r: LedgerRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return { rows, totals: { grossMinor: sum((r) => r.amountMinor), concessionMinor: sum((r) => r.concessionMinor), paidMinor: sum((r) => r.paidMinor), outstandingMinor: sum((r) => r.outstandingMinor) } };
}

export function obligationStatus(r: Pick<LedgerRow, "dueDate" | "paidMinor" | "outstandingMinor">, today: string): ObligationStatus {
  if (r.outstandingMinor <= 0) return "paid";
  if (r.dueDate < today) return "overdue";
  if (r.paidMinor > 0) return "partial";
  if (daysBetween(today, r.dueDate) <= DUE_SOON_DAYS) return "due";
  return "upcoming";
}

/** Standing plus the overdue / due-soon amounts and the next unpaid installment. */
export function standingOf(rows: Pick<LedgerRow, "obligationId" | "label" | "dueDate" | "paidMinor" | "outstandingMinor">[], today: string) {
  let overdueMinor = 0;
  let dueSoonMinor = 0;
  let nextDue: { obligationId: Id<"studentFees">; label: string; dueDate: string; outstandingMinor: number } | null = null;
  for (const r of rows) {
    const s = obligationStatus(r, today);
    if (s === "overdue") overdueMinor += r.outstandingMinor;
    if (s === "due" || s === "partial") dueSoonMinor += r.outstandingMinor;
    if (r.outstandingMinor > 0 && !nextDue) nextDue = { obligationId: r.obligationId, label: r.label, dueDate: r.dueDate, outstandingMinor: r.outstandingMinor };
  }
  const outstanding = rows.reduce((a, r) => a + r.outstandingMinor, 0);
  let standing: FeeStanding;
  if (rows.length === 0) standing = "not_assigned";
  else if (outstanding <= 0) standing = "paid";
  else if (overdueMinor > 0) standing = "overdue";
  else if (dueSoonMinor > 0) standing = "due_soon";
  else standing = "clear";
  return { standing, overdueMinor, dueSoonMinor, nextDue };
}

/** Group documents by student id. */
export function byStudent<T extends { studentId: Id<"students"> }>(rows: T[]): Map<Id<"students">, T[]> {
  const m = new Map<Id<"students">, T[]>();
  for (const r of rows) {
    const list = m.get(r.studentId);
    if (list) list.push(r);
    else m.set(r.studentId, [r]);
  }
  return m;
}
