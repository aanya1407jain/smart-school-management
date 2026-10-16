/**
 * Attendance arithmetic for the student "My Attendance" page — the same product
 * rules as the backend (`convex/attendance.ts` studentHistory):
 *   - excused days are not counted (neither attended nor missed);
 *   - present always counts as attended;
 *   - late counts as attended only when the school setting
 *     `lateCountsAsPresent` is on;
 *   - no countable days → percentage is null ("no data"), never 0 or 100.
 * Pure functions, independent of record order.
 */
export type AttendanceStatusValue = "present" | "absent" | "late" | "excused";
export type AttendanceRecord = { date: string; status: AttendanceStatusValue };

export type AttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** All recorded days, excused included. */
  recorded: number;
  /** Days that count towards the percentage (excused excluded). */
  counted: number;
  attended: number;
  /** One decimal, or null when there is nothing to count. */
  percentage: number | null;
};

export function summarizeAttendance(records: readonly AttendanceRecord[], { lateCountsAsPresent }: { lateCountsAsPresent: boolean }): AttendanceSummary {
  const s = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const r of records) s[r.status] += 1;
  const counted = s.present + s.late + s.absent;
  const attended = s.present + (lateCountsAsPresent ? s.late : 0);
  return {
    ...s,
    recorded: records.length,
    counted,
    attended,
    percentage: counted ? Math.round((attended / counted) * 1000) / 10 : null,
  };
}

/** Per-month percentages, oldest month first; months with no countable day are omitted. */
export function monthlyAttendance(records: readonly AttendanceRecord[], opts: { lateCountsAsPresent: boolean }) {
  const byMonth = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    const m = r.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), r]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, rs]) => ({ month, percentage: summarizeAttendance(rs, opts).percentage }))
    .filter((m): m is { month: string; percentage: number } => m.percentage !== null);
}

/** Latest recorded date (ISO), whatever the order of `records`; null when empty. */
export function latestRecordDate(records: readonly AttendanceRecord[]): string | null {
  let latest: string | null = null;
  for (const r of records) if (latest === null || r.date > latest) latest = r.date;
  return latest;
}
