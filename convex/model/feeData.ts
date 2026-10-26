/**
 * Bounded, index-backed loads of a whole school's fee data for one academic
 * year (three range reads instead of a ledger query per student). Combine with
 * model/feeMath.ts — the same arithmetic one student's ledger uses.
 */
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { conflict } from "../core/errors";
import { byStudent, effectivePayments } from "./feeMath";

/** Largest number of rows one school-wide fee read loads from a single table. */
export const MAX_AGGREGATE_ROWS = 20000;

/** Active enrollments of a year, one per student (a stray duplicate must not double-count). */
export async function activeEnrollments(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">) {
  const rows = await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId)).take(MAX_AGGREGATE_ROWS + 1);
  if (rows.length > MAX_AGGREGATE_ROWS) throw conflict("Too many enrollments to summarise in one request.");
  const seen = new Set<Id<"students">>();
  return rows.filter((e) => e.status === "active" && !seen.has(e.studentId) && (seen.add(e.studentId), true));
}

/** Every fee row of the school for one year, grouped by student. */
export async function schoolYearFees(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">) {
  const check = <T,>(r: T[], what: string) => {
    if (r.length > MAX_AGGREGATE_ROWS) throw conflict(`Too many ${what} to summarise in one request; filter by class or section.`);
    return r;
  };
  const obligations = check(await ctx.db.query("studentFees").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId)).take(MAX_AGGREGATE_ROWS + 1), "fee rows");
  const concessions = check(await ctx.db.query("feeConcessions").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId)).take(MAX_AGGREGATE_ROWS + 1), "concessions");
  const allPayments = check(await ctx.db.query("feePayments").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId)).take(MAX_AGGREGATE_ROWS + 1), "payments");
  const effective = effectivePayments(allPayments);
  return { obligations: byStudent(obligations), concessions: byStudent(concessions), payments: byStudent(effective), allPayments, effective };
}
