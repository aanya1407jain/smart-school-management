/**
 * Fees read models used by other modules through providers
 * (contracts/providers.ts): one student's ledger, dues for the TC gate and
 * promotions, and the "fees exist in a year" guard. Also the receipt file
 * owner (who may read a receipt PDF). Moved here from model/studentRecords.ts
 * and model/lifecycle.ts so that no other module reads fee tables.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { FeeDues, FeeLedgerView, FileOwnerProvider, ProviderContracts, StudentDuesProvider, StudentLedgerProvider } from "../contracts/providers";
import type { Actor } from "../core/actor";
import { getInSchool, requireStudentAccess } from "../core/authorization";
import { notFound } from "../core/errors";
import { computeLedger, effectivePayments, standingOf } from "./feeMath";
import { schoolYearFees } from "./feeData";
import type { FeeOverviewProvider } from "../contracts/providers";
import { conflict } from "../core/errors";

/**
 * Fee ledger for one academic year: obligations with concession, paid and
 * outstanding amounts, effective payments with receipt numbers, and totals.
 * A payment counts when it is `completed` and not reversed (a reversal is a
 * separate row pointing at the original).
 */
export async function feeLedger(ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">, year: Pick<Doc<"academicYears">, "_id" | "name">) {
  const obligations = (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect())
    .filter((o) => o.schoolId === student.schoolId);
  const concessions = (await ctx.db.query("feeConcessions").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect())
    .filter((c) => c.schoolId === student.schoolId);
  const allPayments = (await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", student._id)).collect())
    .filter((p) => p.schoolId === student.schoolId && p.academicYearId === year._id);
  const payments = effectivePayments(allPayments);
  // Shared with the school-wide fee reads (model/feeMath.ts), so totals always reconcile.
  const { rows, totals } = computeLedger(obligations, concessions, payments);
  const paymentRows = [];
  for (const p of payments.sort((a, b) => b.paidOn.localeCompare(a.paidOn))) {
    const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", p._id)).first();
    const ok = receipt && receipt.schoolId === student.schoolId;
    paymentRows.push({ paymentId: p._id, paidOn: p.paidOn, amountMinor: p.amountMinor, method: p.method, receiptNo: ok ? receipt.receiptNo : null, receiptId: ok ? receipt._id : null, reference: p.reference ?? null });
  }
  return {
    academicYear: year.name,
    obligations: rows.map(({ feeStructureId: _structure, ...r }) => r),
    payments: paymentRows,
    totals,
  };
}

/** Fee balance per student for one year (the same ledger arithmetic as the student's fee page). */
export async function feeBalances(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">, studentIds: Id<"students">[], today: string) {
  const fees = await schoolYearFees(ctx, schoolId, academicYearId);
  const out = new Map<string, FeeDues>();
  for (const id of studentIds) {
    const ledger = computeLedger(fees.obligations.get(id) ?? [], fees.concessions.get(id) ?? [], fees.payments.get(id) ?? []);
    out.set(id, { outstandingMinor: ledger.totals.outstandingMinor, overdueMinor: standingOf(ledger.rows, today).overdueMinor, assigned: ledger.rows.length > 0 });
  }
  return out;
}

/** One student's fee balance for one year. */
export async function feeBalanceOf(ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">, academicYearId: Id<"academicYears">, today: string): Promise<FeeDues> {
  const [obligations, concessions, payments] = await Promise.all([
    ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", academicYearId)).collect(),
    ctx.db.query("feeConcessions").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", academicYearId)).collect(),
    ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", student._id)).collect(),
  ]);
  const ledger = computeLedger(obligations, concessions, effectivePayments(payments.filter((p) => p.academicYearId === academicYearId && p.schoolId === student.schoolId)));
  return { outstandingMinor: ledger.totals.outstandingMinor, overdueMinor: standingOf(ledger.rows, today).overdueMinor, assigned: ledger.rows.length > 0 };
}

const dues: StudentDuesProvider = {
  dues: (ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">, yearId: Id<"academicYears">, today: string) => feeBalanceOf(ctx, student, yearId, today),
  duesMany: (ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, studentIds: Id<"students">[], today: string) => feeBalances(ctx, schoolId, yearId, studentIds, today),
  async hasFeesInYear(ctx: QueryCtx, studentId: Id<"students">, yearId: Id<"academicYears">) {
    return !!(await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", studentId).eq("academicYearId", yearId)).first());
  },
};

const ledger: StudentLedgerProvider = {
  ledger: (ctx: QueryCtx, student: Pick<Doc<"students">, "_id" | "schoolId">, year: Pick<Doc<"academicYears">, "_id" | "name">): Promise<FeeLedgerView> => feeLedger(ctx, student, year),
};

type FileCtx = QueryCtx & { actor: Actor };

/** Receipt PDFs: fee staff, or the student the receipt belongs to. */
const receiptFiles: FileOwnerProvider = {
  ownerTypes: ["receipt"],
  async loadOwner(ctx: FileCtx, _ownerType: string, ownerId: string) {
    const id = ctx.db.normalizeId("receipts", ownerId);
    if (!id) throw notFound("Owner");
    await getInSchool(ctx, "receipts", id, "Owner");
  },
  async requireRead(ctx: FileCtx, _ownerType: string, ownerId: string) {
    const receipt = await getInSchool(ctx, "receipts", ownerId as Id<"receipts">, "File");
    await requireStudentAccess(ctx, receipt.studentId, { all: "fees:manage", own: "fees:read:own" });
  },
  async writableRecord() {
    return null; // receipts do not list attachments
  },
};

export const feesProviders = {
  "fees.studentDues": dues,
  "fees.studentLedger": ledger,
  "fees.receiptFiles": receiptFiles,
} satisfies Pick<ProviderContracts, "fees.studentDues" | "fees.studentLedger" | "fees.receiptFiles">;

const MAX_STUDENTS = 5000;

/**
 * Billed / concession / collected / outstanding / overdue per class for a year,
 * from the bulk fee loads (model/feeData.ts) and the shared ledger arithmetic,
 * so it reconciles with every student's ledger. A student counts in the class
 * of their active (else latest) enrollment of the year.
 */
export async function feeByClass(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, today: string) {
  const enrollments = await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).take(MAX_STUDENTS * 2 + 1);
  if (enrollments.length > MAX_STUDENTS * 2) throw conflict("Too many enrollments for one report.");
  const classOf = new Map<Id<"students">, Id<"classes">>();
  for (const e of enrollments) if (!classOf.has(e.studentId) || e.status === "active") classOf.set(e.studentId, e.classId);
  const data = await schoolYearFees(ctx, schoolId, yearId);
  type Row = { students: number; grossMinor: number; concessionMinor: number; paidMinor: number; outstandingMinor: number; overdueMinor: number };
  const perClass = new Map<Id<"classes"> | "none", Row>();
  for (const [studentId, obligations] of data.obligations) {
    const l = computeLedger(obligations, data.concessions.get(studentId) ?? [], data.payments.get(studentId) ?? []);
    if (l.rows.length === 0) continue;
    const key = classOf.get(studentId) ?? "none";
    const row = perClass.get(key) ?? { students: 0, grossMinor: 0, concessionMinor: 0, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0 };
    row.students++;
    row.grossMinor += l.totals.grossMinor;
    row.concessionMinor += l.totals.concessionMinor;
    row.paidMinor += l.totals.paidMinor;
    row.outstandingMinor += l.totals.outstandingMinor;
    row.overdueMinor += standingOf(l.rows, today).overdueMinor;
    perClass.set(key, row);
  }
  type ClassRow = Row & { classId: Id<"classes"> | null; className: string; level: number };
  const classes: ClassRow[] = [];
  for (const [classId, row] of perClass) {
    const c = classId === "none" ? null : await ctx.db.get(classId);
    classes.push({ classId: classId === "none" ? null : classId, className: c?.name ?? "No enrollment", level: c?.level ?? 99, ...row });
  }
  classes.sort((a, b) => a.level - b.level);
  const sum = (k: keyof Row) => classes.reduce((a, c) => a + c[k], 0);
  return { classes, totals: { grossMinor: sum("grossMinor"), concessionMinor: sum("concessionMinor"), paidMinor: sum("paidMinor"), outstandingMinor: sum("outstandingMinor"), overdueMinor: sum("overdueMinor") } };
}

/** The admin dashboard's fee cards (moved from reports.adminDashboard). */
const overview: FeeOverviewProvider = {
  async dashboard(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">, today: string) {
    const byClass = await feeByClass(ctx, schoolId, yearId, today);
    const data = await schoolYearFees(ctx, schoolId, yearId);
    let overdueStudents = 0;
    for (const [studentId, obligations] of data.obligations) {
      const l = computeLedger(obligations, data.concessions.get(studentId) ?? [], data.payments.get(studentId) ?? []);
      if (standingOf(l.rows, today).overdueMinor > 0) overdueStudents++;
    }
    const net = byClass.totals.grossMinor - byClass.totals.concessionMinor;
    return {
      outstandingMinor: byClass.totals.outstandingMinor, overdueMinor: byClass.totals.overdueMinor, overdueStudents, collectedMinor: byClass.totals.paidMinor, netMinor: net,
      collectionRate: net > 0 ? Math.round((byClass.totals.paidMinor / net) * 1000) / 10 : 0,
      byClass: byClass.classes.map((c) => ({ name: c.className, collectedMinor: c.paidMinor, outstandingMinor: c.outstandingMinor })),
    };
  },
};
export const feesOverviewProviders = { "fees.overview": overview } satisfies Pick<ProviderContracts, "fees.overview">;
