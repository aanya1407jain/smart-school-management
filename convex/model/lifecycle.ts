/**
 * What the Promotions & TC workspace shows next to each student, gathered
 * from the OWNING modules through providers (contracts/providers.ts,
 * core/registry.ts) — Students reads no examination, fee or attendance table.
 *
 * A module that is not shipped in this build is reported as such, never as
 * empty data: fees come back as `null` ("not checked", never ₹0), standing as
 * "no_result", attendance totals as `null`.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { FeeDues, LatestResult } from "../contracts/providers";
import { maybeProvider } from "../core/registry";

export type Standing = LatestResult["standing"] | "no_result";
export type { FeeDues, LatestResult };

/** Latest published result per student (empty when Examinations is not shipped). */
export async function latestResults(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">, studentIds: Id<"students">[]): Promise<Map<string, LatestResult>> {
  const p = maybeProvider("examinations.studentStanding");
  return p ? await p.latestResults(ctx, schoolId, academicYearId, studentIds) : new Map();
}

/** Fee balances per student, or null when Fees is not shipped (dues cannot be checked). */
export async function feeBalances(ctx: QueryCtx, schoolId: Id<"schools">, academicYearId: Id<"academicYears">, studentIds: Id<"students">[], today: string): Promise<Map<string, FeeDues> | null> {
  const p = maybeProvider("fees.studentDues");
  return p ? await p.duesMany(ctx, schoolId, academicYearId, studentIds, today) : null;
}

/** One student's fee balance, or null when Fees is not shipped. */
export async function feeBalanceOf(ctx: QueryCtx, student: Doc<"students">, academicYearId: Id<"academicYears">, today: string): Promise<FeeDues | null> {
  const p = maybeProvider("fees.studentDues");
  return p ? await p.dues(ctx, student, academicYearId, today) : null;
}

/** Working / attended days in a year, or null when Attendance is not shipped. */
export async function attendanceTotals(ctx: QueryCtx, studentId: Id<"students">, year: Pick<Doc<"academicYears">, "startDate" | "endDate">, upTo: string, lateCounts: boolean) {
  const p = maybeProvider("attendance.studentRecords");
  return p ? await p.totals(ctx, studentId, year, upTo, lateCounts) : null;
}

/**
 * Why the student's new-year records make a promotion permanent, or null. Each
 * shipped module answers for its own records (attendance, fees, results).
 */
export async function newYearRecordsProblem(ctx: QueryCtx, studentId: Id<"students">, name: string, year: Doc<"academicYears">): Promise<string | null> {
  const attendance = maybeProvider("attendance.studentRecords");
  if (attendance && (await attendance.hasRecordsBetween(ctx, studentId, year.startDate, year.endDate))) return `Attendance is already recorded for ${name} in ${year.name}.`;
  const fees = maybeProvider("fees.studentDues");
  if (fees && (await fees.hasFeesInYear(ctx, studentId, year._id))) return `Fees are already assigned to ${name} for the new year.`;
  const results = maybeProvider("examinations.studentStanding");
  if (results && (await results.hasResultsInYear(ctx, studentId, year._id))) return `Results are already published for ${name} in the new year.`;
  return null;
}
