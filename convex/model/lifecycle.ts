/**
 * Read-side facts the Promotions & TC workspace shows next to each student:
 * the latest published result of a year (with an eligibility standing), the
 * year's fee balance and the year's attendance totals. Pure reads over
 * existing records — nothing here is stored separately.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { computeLedger, effectivePayments, standingOf } from "./feeMath";
import { schoolYearFees } from "./feeData";

/**
 * Academic standing from the latest published result of the year:
 *  - eligible     every subject passed
 *  - compartment  one or two subjects not passed
 *  - detained     three or more subjects not passed
 *  - no_result    nothing published for the student this year
 * A suggestion for the office — promotion itself is the administrator's decision.
 */
export type Standing = "eligible" | "compartment" | "detained" | "no_result";

export type LatestResult = { examName: string; percentage: number; grade: string | null; failedSubjects: number; standing: Standing };

export function standingFrom(failedSubjects: number): Exclude<Standing, "no_result"> {
  return failedSubjects === 0 ? "eligible" : failedSubjects <= 2 ? "compartment" : "detained";
}

/** Latest published result per student, limited to exams of `academicYearId`. */
export async function latestResults(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">, studentIds: Id<"students">[]) {
  const exams = await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId)).collect();
  const examById = new Map(exams.map((e) => [e._id, e]));
  const out = new Map<Id<"students">, LatestResult>();
  for (const studentId of studentIds) {
    const rows = await ctx.db.query("results").withIndex("by_student_exam", (q) => q.eq("studentId", studentId)).collect();
    const mine = rows.filter((r) => r.schoolId === schoolId && examById.has(r.examId)).sort((a, b) => b.publishedAt - a.publishedAt);
    const r = mine[0];
    if (!r) continue;
    const failed = r.subjects.filter((s) => !s.passed).length;
    out.set(studentId, { examName: examById.get(r.examId)!.name, percentage: r.percentage, grade: r.grade ?? null, failedSubjects: failed, standing: standingFrom(failed) });
  }
  return out;
}

export type FeeBalance = { outstandingMinor: number; overdueMinor: number; assigned: boolean };

/** Fee balance per student for one year (the same ledger arithmetic as the student's fee page). */
export async function feeBalances(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">, studentIds: Id<"students">[], today: string) {
  const fees = await schoolYearFees(ctx, schoolId, academicYearId);
  const out = new Map<Id<"students">, FeeBalance>();
  for (const id of studentIds) {
    const ledger = computeLedger(fees.obligations.get(id) ?? [], fees.concessions.get(id) ?? [], fees.payments.get(id) ?? []);
    out.set(id, { outstandingMinor: ledger.totals.outstandingMinor, overdueMinor: standingOf(ledger.rows, today).overdueMinor, assigned: ledger.rows.length > 0 });
  }
  return out;
}

/** One student's fee balance for one year. */
export async function feeBalanceOf(ctx: QueryCtx, student: Doc<"students">, academicYearId: Id<"academicYears">, today: string): Promise<FeeBalance> {
  const [obligations, concessions, payments] = await Promise.all([
    ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", academicYearId)).collect(),
    ctx.db.query("feeConcessions").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", academicYearId)).collect(),
    ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", student._id)).collect(),
  ]);
  const ledger = computeLedger(obligations, concessions, effectivePayments(payments.filter((p) => p.academicYearId === academicYearId && p.schoolId === student.schoolId)));
  return { outstandingMinor: ledger.totals.outstandingMinor, overdueMinor: standingOf(ledger.rows, today).overdueMinor, assigned: ledger.rows.length > 0 };
}

/**
 * Working days and days attended in one academic year: every register the
 * student was on counts as a working day; present (and late, when the school
 * counts late as present) count as attended.
 */
export async function attendanceTotals(ctx: QueryCtx, studentId: Id<"students">, year: Pick<Doc<"academicYears">, "startDate" | "endDate">, upTo: string, lateCounts: boolean) {
  const end = upTo < year.endDate ? upTo : year.endDate;
  const records = await ctx.db.query("attendanceRecords").withIndex("by_student_date", (q) => q.eq("studentId", studentId).gte("date", year.startDate).lte("date", end)).collect();
  const attended = records.filter((r) => r.status === "present" || (lateCounts && r.status === "late")).length;
  return { workingDays: records.length, attendedDays: attended };
}
