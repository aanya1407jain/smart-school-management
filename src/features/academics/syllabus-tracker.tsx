"use client";
/**
 * Syllabus progress & course pacing.
 *
 * Status is derived, never stored, so it can't drift out of sync with the counts:
 *  - "completed" when every chapter is done;
 *  - otherwise coverage is compared with where the class should be today, on a
 *    straight line from the subject's start date to its target date. Falling more
 *    than PACE_TOLERANCE short of that line is "behind"; more than SEVERE_GAP short
 *    is shown as a red alert instead of amber.
 *
 * Without `subjects` the tracker shows clearly labelled sample data and keeps
 * changes in local state. Pass `subjects` (e.g. from a Convex query) and
 * `onChapterComplete` (e.g. a Convex mutation) to wire it to real records;
 * the +1 update is optimistic and rolled back if the save fails.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Clock, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatDate, todayISO } from "@/lib/utils/dates";

export type SyllabusStatus = "on-track" | "behind" | "completed";

export interface SyllabusSubject {
  id: string;
  subjectName: string;
  className: string;
  teacherName: string;
  totalChapters: number;
  completedChapters: number;
  /** ISO date (YYYY-MM-DD) teaching started; pacing is measured from here. */
  startDate: string;
  /** ISO date (YYYY-MM-DD) the syllabus should be finished by. */
  targetDate: string;
}

export interface SyllabusPacing {
  status: SyllabusStatus;
  /** Actual coverage, 0–1. */
  coverage: number;
  /** Coverage the class should have reached by today, 0–1. */
  expected: number;
  /** Behind by more than SEVERE_GAP. */
  severe: boolean;
  /** Days until the target date (negative when overdue). */
  daysLeft: number;
}

interface SyllabusProgressTrackerProps {
  /** Real records. Omit to show labelled sample data. */
  subjects?: SyllabusSubject[];
  /** Persist a +1. Throw to roll the optimistic update back (report the error in the caller). */
  onChapterComplete?: (subjectId: string, completedChapters: number) => Promise<void> | void;
  /** ISO date to measure pacing against. Defaults to today. */
  today?: string;
  className?: string;
}

const PACE_TOLERANCE = 0.1; // up to 10 percentage points behind still counts as on track
const SEVERE_GAP = 0.25; // more than 25 points behind is a red alert
const DAY_MS = 86_400_000;

const SAMPLE_SUBJECTS: SyllabusSubject[] = [
  {
    id: "sample-math-10a",
    subjectName: "Mathematics",
    className: "Class 10-A",
    teacherName: "Mr. R. K. Sharma",
    totalChapters: 15,
    completedChapters: 10,
    startDate: "2026-04-01",
    targetDate: "2026-12-15",
  },
  {
    id: "sample-sci-10a",
    subjectName: "Science",
    className: "Class 10-A",
    teacherName: "Mrs. Sneha Verma",
    totalChapters: 16,
    completedChapters: 6,
    startDate: "2026-04-01",
    targetDate: "2026-12-10",
  },
  {
    id: "sample-eng-10a",
    subjectName: "English Literature",
    className: "Class 10-A",
    teacherName: "Ms. Ananya Roy",
    totalChapters: 12,
    completedChapters: 10,
    startDate: "2026-04-01",
    targetDate: "2026-11-20",
  },
];

/** Midnight UTC for an ISO date, so day arithmetic is unaffected by time zones and DST. */
function isoToUTC(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function getPacing(subject: SyllabusSubject, today: string): SyllabusPacing {
  const total = Math.max(0, subject.totalChapters);
  const done = Math.min(Math.max(0, subject.completedChapters), total);
  const coverage = total > 0 ? done / total : 0;

  const start = isoToUTC(subject.startDate);
  const target = isoToUTC(subject.targetDate);
  const now = isoToUTC(today);
  const expected = target <= start
    ? (now >= target ? 1 : 0)
    : Math.min(1, Math.max(0, (now - start) / (target - start)));
  const daysLeft = Math.round((target - now) / DAY_MS);

  if (total > 0 && done >= total) return { status: "completed", coverage: 1, expected, severe: false, daysLeft };

  const gap = expected - coverage;
  return { status: gap > PACE_TOLERANCE ? "behind" : "on-track", coverage, expected, severe: gap > SEVERE_GAP, daysLeft };
}

interface StatusStyle {
  label: string;
  Icon: LucideIcon;
  pill: string;
  bar: string;
}

function statusStyle(p: SyllabusPacing): StatusStyle {
  if (p.status === "completed") {
    return { label: "Completed", Icon: CheckCircle, pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", bar: "bg-emerald-500" };
  }
  if (p.status === "on-track") {
    return { label: "On track", Icon: CheckCircle, pill: "bg-teal-50 text-teal-700 ring-teal-600/20", bar: "bg-teal-500" };
  }
  return p.severe
    ? { label: "Far behind", Icon: AlertTriangle, pill: "bg-red-50 text-red-700 ring-red-600/20", bar: "bg-red-500" }
    : { label: "Behind", Icon: AlertTriangle, pill: "bg-amber-50 text-amber-800 ring-amber-600/25", bar: "bg-amber-500" };
}

function deadlineLabel(p: SyllabusPacing): string {
  if (p.status === "completed") return "done";
  if (p.daysLeft === 0) return "due today";
  const n = Math.abs(p.daysLeft);
  const days = `${n} day${n === 1 ? "" : "s"}`;
  return p.daysLeft > 0 ? `${days} left` : `${days} overdue`;
}

export function SyllabusProgressTracker({ subjects, onChapterComplete, today, className }: SyllabusProgressTrackerProps) {
  const isSample = subjects === undefined;
  const source = subjects ?? SAMPLE_SUBJECTS;
  const [items, setItems] = useState<SyllabusSubject[]>(source);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [fallbackDay] = useState(todayISO);
  const day = today ?? fallbackDay;

  // Re-sync when the parent supplies fresh records (e.g. a Convex query update after a save).
  useEffect(() => {
    setItems(source);
  }, [source]);

  const rows = useMemo(() => items.map((subject) => ({ subject, pacing: getPacing(subject, day) })), [items, day]);

  const counts = useMemo(() => {
    const c: Record<SyllabusStatus, number> = { "on-track": 0, behind: 0, completed: 0 };
    for (const r of rows) c[r.pacing.status] += 1;
    return c;
  }, [rows]);

  const setCompleted = (id: string, completedChapters: number) =>
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, completedChapters } : s)));

  const addChapter = async (subject: SyllabusSubject) => {
    if (pending.has(subject.id) || subject.completedChapters >= subject.totalChapters) return;
    const next = subject.completedChapters + 1;
    setCompleted(subject.id, next);
    if (!onChapterComplete) return;

    setPending((p) => new Set(p).add(subject.id));
    try {
      await onChapterComplete(subject.id, next);
    } catch {
      setCompleted(subject.id, subject.completedChapters);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(subject.id);
        return n;
      });
    }
  };

  return (
    <Card className={className}>
      <CardHeader
        title="Syllabus progress"
        description="Chapters covered against each subject's target date. The marker on each bar shows where the class should be today."
        icon={<Clock className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
            {isSample && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Sample data</span>}
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">
              <CheckCircle className="h-3.5 w-3.5" aria-hidden /> {counts["on-track"] + counts.completed} on track
            </span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", counts.behind ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600")}>
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {counts.behind} behind
            </span>
          </div>
        }
      />

      <div className="p-5">
        {rows.length === 0 ? (
          <EmptyState title="No subjects to track yet" description="Assign subject teachers in Teacher assignments to start tracking syllabus coverage." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ subject: s, pacing: p }) => {
              const style = statusStyle(p);
              const pct = Math.round(p.coverage * 100);
              const expectedPct = Math.round(p.expected * 100);
              const finished = p.status === "completed";

              return (
                <li key={s.id} className="flex flex-col justify-between rounded-xl border border-line/70 bg-white/70 p-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{s.className}</span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", style.pill)}>
                        <style.Icon className="h-3 w-3" aria-hidden />
                        {style.label}
                      </span>
                    </div>

                    <h4 className="mt-2 text-sm font-semibold text-ink">{s.subjectName}</h4>
                    <p className="text-xs text-ink-muted">Teacher: {s.teacherName}</p>

                    <div className="mt-4 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="text-ink-muted">Coverage</span>
                        <span className="tabular-nums text-ink">
                          {s.completedChapters} of {s.totalChapters} chapters ({pct}%)
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${s.subjectName}, ${s.className} syllabus coverage`}
                        aria-valuemin={0}
                        aria-valuemax={s.totalChapters}
                        aria-valuenow={s.completedChapters}
                        aria-valuetext={`${s.completedChapters} of ${s.totalChapters} chapters, ${pct}%. Expected ${expectedPct}% by today.`}
                        className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100"
                      >
                        <div className={cn("h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none", style.bar)} style={{ width: `${pct}%` }} />
                        {!finished && (
                          <div aria-hidden className="absolute inset-y-0 w-0.5 bg-slate-500/70" style={{ left: `calc(${expectedPct}% - 1px)` }} />
                        )}
                      </div>
                      {!finished && <p className="text-[11px] text-ink-muted">Expected by today: {expectedPct}%</p>}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-line/50 pt-3">
                    <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                      <Clock className="h-3 w-3 shrink-0" aria-hidden />
                      Target {formatDate(s.targetDate)}, {deadlineLabel(p)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={pending.has(s.id)}
                      disabled={finished}
                      onClick={() => addChapter(s)}
                      aria-label={`Mark one more ${s.subjectName} chapter complete for ${s.className}`}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> 1 chapter
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
