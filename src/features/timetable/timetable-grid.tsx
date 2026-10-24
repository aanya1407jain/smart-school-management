"use client";
/**
 * The one weekly timetable grid, shared by every timetable view (admin builder,
 * teacher and student pages, demo and live). Callers adapt their data to
 * periods + a `lessonAt` lookup; this component owns layout, spacing,
 * typography and colour so all views read the same.
 *
 * - md and up: periods as rows, days as columns, sticky day header and period
 *   column inside a scroll container; fixed column widths so free cells never
 *   shift the grid.
 * - below md: one day at a time (day picker + list).
 * - breaks / recess / assembly span the whole row with a muted hatch.
 */
import { useState, type ReactNode } from "react";
import { Coffee, Megaphone, Plus } from "lucide-react";
import { dayOfWeek, todayISO, WEEKDAY_NAMES } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { Segmented } from "@/components/ui/segmented";

export interface GridPeriod {
  key: string;
  label: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
}

export interface GridLesson {
  subject: string;
  /** Secondary line, e.g. "Room 204 · Mr. Sharma" or "Class 10-A · Room 204". */
  detail?: string;
  /** Keeps a subject's colour stable across views; defaults to the subject name. */
  colorKey?: string;
}

/** Soft tint + left stripe per subject (always paired with the subject name, never colour alone). */
const TINTS = [
  "bg-teal-soft/60 border-l-teal",
  "bg-sapphire/[0.05] border-l-sapphire/60",
  "bg-lavender/35 border-l-purple/70",
  "bg-blush/35 border-l-plum/40",
  "bg-heather/20 border-l-heather",
  "bg-alabaster border-l-lagoon/60",
];

/** Subject → tint for one grid: subjects in sorted order take distinct tints (no clashes up to six subjects). */
function tintMap(keys: Iterable<string>) {
  return new Map([...new Set(keys)].sort().map((k, i) => [k, TINTS[i % TINTS.length]]));
}

const HATCH = "bg-[repeating-linear-gradient(135deg,rgb(var(--c-heather)/0.16)_0_6px,transparent_6px_12px)]";

export const DEFAULT_DAYS = [1, 2, 3, 4, 5];

/** Monday–Friday plus any other day that actually has lessons, in week order. */
export function daysWithLessons(lessonDays: number[]) {
  return [...new Set([...DEFAULT_DAYS, ...lessonDays])].sort((a, b) => a - b);
}

function TimeBadge({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <span className={cn("inline-flex w-fit items-center whitespace-nowrap rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[10.5px] leading-none tabular-nums text-ink-muted ring-1 ring-inset ring-line/60", className)}>
      {start} – {end}
    </span>
  );
}

function BreakBand({ period, compact }: { period: GridPeriod; compact?: boolean }) {
  const Icon = /assembly/i.test(period.label) ? Megaphone : Coffee;
  return (
    <div className={cn("flex items-center justify-center gap-2 rounded-lg border border-line/60 px-3 text-[12px] font-medium text-ink-muted", HATCH, compact ? "py-2" : "py-2.5")}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{period.label}</span>
      <TimeBadge start={period.startTime} end={period.endTime} className="bg-white/80" />
    </div>
  );
}

export function TimetableGrid({
  periods, days = DEFAULT_DAYS, lessonAt, caption = "Weekly timetable", onSlotClick, slotLabel, highlightToday = true, freeLabel = "Free",
}: {
  periods: GridPeriod[];
  days?: number[];
  lessonAt: (day: number, period: GridPeriod) => GridLesson | undefined;
  caption?: string;
  /** Makes every lesson slot a button (the timetable builders). */
  onSlotClick?: (day: number, period: GridPeriod) => void;
  /** Accessible name for a clickable slot; defaults to "<Day> <Period>: <subject|empty>". */
  slotLabel?: (day: number, period: GridPeriod, lesson: GridLesson | undefined) => string;
  highlightToday?: boolean;
  freeLabel?: string;
}) {
  const today = dayOfWeek(todayISO());
  const [mobileDay, setMobileDay] = useState<number>(days.includes(today) ? today : days[0] ?? 1);
  const isToday = (d: number) => highlightToday && d === today;
  const tints = tintMap(days.flatMap((d) => periods.flatMap((p) => {
    const l = p.isBreak ? undefined : lessonAt(d, p);
    return l ? [l.colorKey ?? l.subject] : [];
  })));

  const slot = (day: number, p: GridPeriod) => {
    const l = lessonAt(day, p);
    const body: ReactNode = l ? (
      <>
        <p className="line-clamp-2 break-normal text-[13px] font-semibold leading-5 text-ink" title={l.subject}>{l.subject}</p>
        {l.detail && <p className="line-clamp-2 break-normal text-[11.5px] leading-4 text-ink-muted" title={l.detail}>{l.detail}</p>}
        <TimeBadge start={p.startTime} end={p.endTime} className="mt-auto" />
      </>
    ) : (
      <span className="m-auto flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted/80">
        {onSlotClick ? <><Plus className="h-3.5 w-3.5" aria-hidden /> Add</> : freeLabel}
      </span>
    );
    const cls = cn(
      "flex h-full min-h-[88px] w-full min-w-0 flex-col gap-1 rounded-lg p-3 text-left",
      l ? cn("border border-line/60 border-l-[3px]", tints.get(l.colorKey ?? l.subject)) : cn("border border-dashed border-line/70", HATCH),
    );
    return onSlotClick ? (
      <button type="button" onClick={() => onSlotClick(day, p)} aria-label={slotLabel?.(day, p, l) ?? `${WEEKDAY_NAMES[day]} ${p.label}: ${l ? l.subject : "empty"}`}
        className={cn(cls, "transition-all hover:-translate-y-0.5 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-teal", !l && "hover:border-teal hover:bg-teal-soft/40")}>
        {body}
      </button>
    ) : <div className={cls}>{body}</div>;
  };

  return (
    <>
      {/* md and up: full week */}
      <div className="scrollbar-thin hidden max-h-[72vh] overflow-auto rounded-xl md:block">
        <table className="w-full table-fixed border-separate border-spacing-0" style={{ minWidth: 120 + days.length * 150 }}>
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className="w-[120px]" />
            {days.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 bg-surface px-2 pb-2 pt-1 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Period</th>
              {days.map((d) => (
                <th key={d} scope="col" className="sticky top-0 z-20 bg-surface px-1 pb-2 pt-1">
                  <span className={cn("block rounded-lg py-1.5 text-center text-[12.5px] font-semibold", isToday(d) ? "bg-sapphire text-white" : "bg-alabaster/70 text-ink-soft")}>
                    {WEEKDAY_NAMES[d]}{isToday(d) && <span className="sr-only"> (today)</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.key}>
                <th scope="row" className="sticky left-0 z-10 bg-surface p-1 pr-2 text-left align-top">
                  <div className="flex flex-col gap-1 pt-2">
                    <span className="truncate text-[12.5px] font-semibold leading-5 text-ink" title={p.label}>{p.label}</span>
                    <span className="whitespace-nowrap font-mono text-[10.5px] leading-none tabular-nums text-ink-muted">{p.startTime} – {p.endTime}</span>
                  </div>
                </th>
                {p.isBreak ? (
                  <td colSpan={days.length} className="p-1 align-middle"><BreakBand period={p} /></td>
                ) : days.map((d) => (
                  <td key={d} className={cn("p-1 align-top", isToday(d) && "bg-teal-soft/25")}>{slot(d, p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Below md: one day at a time */}
      <div className="md:hidden">
        <Segmented<string>
          label="Day"
          size="sm"
          className="mb-3 flex w-full justify-between overflow-x-auto"
          value={String(mobileDay)}
          onChange={(v) => setMobileDay(Number(v))}
          options={days.map((d) => ({ value: String(d), label: WEEKDAY_NAMES[d].slice(0, 3) }))}
        />
        <ul className="space-y-2" aria-label={`${caption} · ${WEEKDAY_NAMES[mobileDay]}`}>
          {periods.map((p) => p.isBreak ? (
            <li key={p.key}><BreakBand period={p} compact /></li>
          ) : (
            <li key={p.key} className="grid grid-cols-[72px_minmax(0,1fr)] items-stretch gap-2">
              <div className="flex flex-col gap-1 pt-3">
                <span className="truncate text-[12px] font-semibold leading-4 text-ink">{p.label}</span>
                <span className="whitespace-nowrap font-mono text-[10.5px] leading-none tabular-nums text-ink-muted">{p.startTime}</span>
              </div>
              {slot(mobileDay, p)}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
