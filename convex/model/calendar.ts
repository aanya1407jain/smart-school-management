/**
 * School calendar rules: "today" in the school's timezone and school days.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { dayOfWeek } from "../core/validators";

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(timezone: string, now = Date.now()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Longest date range a single attendance/history query may cover. */
export const MAX_RANGE_DAYS = 366;

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A school day is a configured working weekday that is not covered by a
 * "holiday" event. Holidays are looked up within a bounded window.
 */
export async function isSchoolDay(ctx: QueryCtx, school: Doc<"schools">, settings: Doc<"schoolSettings">, date: string): Promise<boolean> {
  if (!settings.workingDays.includes(dayOfWeek(date))) return false;
  const holidays = await ctx.db
    .query("events")
    .withIndex("by_school_start", (q) => q.eq("schoolId", school._id).gte("startDate", addDays(date, -60)).lte("startDate", date))
    .collect();
  return !holidays.some((e) => e.kind === "holiday" && e.startDate <= date && e.endDate >= date);
}
