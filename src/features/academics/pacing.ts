/**
 * Syllabus pacing rule. A subject is expected to progress in a straight line
 * from its start date to its target date; it is "behind" when its chapter
 * completion trails today's expected point by more than PACING_TOLERANCE.
 */
import { todayISO } from "@/lib/utils/dates";

type Paced = { totalChapters: number; completedChapters: number; startDate: string; targetDate: string };

/** Points a subject may trail the expected line before it counts as behind. */
export const PACING_TOLERANCE = 10;

const day = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

/** Expected completion (0–100) by `today` on a straight line from start to target. */
export function expectedPct(s: Pick<Paced, "startDate" | "targetDate">, today = todayISO()) {
  const span = day(s.targetDate) - day(s.startDate);
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, ((day(today) - day(s.startDate)) / span) * 100));
}

export type PacingStatus = "completed" | "on_schedule" | "behind";

export function pacingOf(s: Paced, today = todayISO()): { pct: number; expected: number; status: PacingStatus } {
  const pct = s.totalChapters > 0 ? (s.completedChapters / s.totalChapters) * 100 : 0;
  const expected = expectedPct(s, today);
  const status: PacingStatus = s.totalChapters > 0 && s.completedChapters >= s.totalChapters ? "completed" : pct < expected - PACING_TOLERANCE ? "behind" : "on_schedule";
  return { pct, expected, status };
}

