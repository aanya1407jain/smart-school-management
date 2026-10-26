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
 * - `draggable` (the admin builder): lessons can be dragged to another slot;
 *   `onMoveLesson` receives source and target (the caller asks the server).
 */
import { useState, type ReactNode } from "react";
import { AlertCircle, Coffee, Megaphone, Plus } from "lucide-react";
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
  id?: string;
  subject: string;
  /** Secondary line, e.g. "Room 204 · Mr. Sharma" or "Class 10-A · Room 204". */
  detail?: string;
  /** Keeps a subject's colour stable across views; defaults to the subject name. */
  colorKey?: string;
  /** A planning hint shown under the lesson (e.g. "3× this subject today"). */
  hasConflict?: boolean;
  conflictReason?: string;
}

const TINTS = [
  "bg-teal-soft/60 border-l-teal",
  "bg-sapphire/[0.05] border-l-sapphire/60",
  "bg-lavender/35 border-l-purple/70",
  "bg-blush/35 border-l-plum/40",
  "bg-heather/20 border-l-heather",
  "bg-alabaster border-l-lagoon/60",
];

function tintMap(keys: Iterable<string>) {
  return new Map([...new Set(keys)].sort().map((k, i) => [k, TINTS[i % TINTS.length]]));
}

const HATCH = "bg-[repeating-linear-gradient(135deg,rgb(var(--c-heather)/0.16)_0_6px,transparent_6px_12px)]";

export const DEFAULT_DAYS = [1, 2, 3, 4, 5];

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
  periods,
  days = DEFAULT_DAYS,
  lessonAt,
  caption = "Weekly timetable",
  onSlotClick,
  slotLabel,
  highlightToday = true,
  freeLabel = "Free",
  draggable = false,
  onMoveLesson,
}: {
  periods: GridPeriod[];
  days?: number[];
  lessonAt: (day: number, period: GridPeriod) => GridLesson | undefined;
  caption?: string;
  onSlotClick?: (day: number, period: GridPeriod) => void;
  slotLabel?: (day: number, period: GridPeriod, lesson: GridLesson | undefined) => string;
  highlightToday?: boolean;
  freeLabel?: string;
  draggable?: boolean;
  onMoveLesson?: (source: { day: number; periodKey: string }, target: { day: number; periodKey: string }) => void;
}) {
  const today = dayOfWeek(todayISO());
  const [mobileDay, setMobileDay] = useState<number>(days.includes(today) ? today : days[0] ?? 1);
  const [dragSource, setDragSource] = useState<{ day: number; periodKey: string } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const isToday = (d: number) => highlightToday && d === today;
  const tints = tintMap(days.flatMap((d) => periods.flatMap((p) => {
    const l = p.isBreak ? undefined : lessonAt(d, p);
    return l ? [l.colorKey ?? l.subject] : [];
  })));

  const handleDragStart = (e: React.DragEvent, day: number, periodKey: string) => {
    if (!draggable) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ day, periodKey }));
    e.dataTransfer.effectAllowed = "move";
    setDragSource({ day, periodKey });
  };

  const handleDragOver = (e: React.DragEvent, cellKey: string, isBreak?: boolean) => {
    if (!draggable || isBreak) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCell(cellKey);
  };

  const handleDrop = (e: React.DragEvent, targetDay: number, targetPeriodKey: string, isBreak?: boolean) => {
    if (!draggable || isBreak) return;
    e.preventDefault();
    setDragOverCell(null);
    setDragSource(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain"));
      if (data && (data.day !== targetDay || data.periodKey !== targetPeriodKey)) {
        onMoveLesson?.(data, { day: targetDay, periodKey: targetPeriodKey });
      }
    } catch {
      // Ignored malformed drag payload
    }
  };

  const slot = (day: number, p: GridPeriod) => {
    const l = lessonAt(day, p);
    const cellKey = `${day}-${p.key}`;
    const isOver = dragOverCell === cellKey;
    const isSource = dragSource?.day === day && dragSource?.periodKey === p.key;

    const body: ReactNode = l ? (
      <>
        <p className="line-clamp-2 break-normal text-[13px] font-semibold leading-5 text-ink" title={l.subject}>{l.subject}</p>
        {l.detail && <p className="line-clamp-2 break-normal text-[11.5px] leading-4 text-ink-muted" title={l.detail}>{l.detail}</p>}
        {l.hasConflict && (
          <p className="flex items-center gap-1 text-[10.5px] font-medium leading-4 text-plum" title={l.conflictReason}>
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{l.conflictReason ?? "Check the plan"}</span>
          </p>
        )}
        <TimeBadge start={p.startTime} end={p.endTime} className="mt-auto" />
      </>
    ) : (
      <span className="m-auto flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted/80">
        {onSlotClick ? <><Plus className="h-3.5 w-3.5" aria-hidden /> Add</> : freeLabel}
      </span>
    );

    const cls = cn(
      "flex h-full min-h-[88px] w-full min-w-0 flex-col gap-1 rounded-lg p-3 text-left transition-all",
      l ? cn("border border-line/60 border-l-[3px]", tints.get(l.colorKey ?? l.subject)) : cn("border border-dashed border-line/70", HATCH),
      // Drag feedback only while dragging: the drop target lights up, the lesson being moved fades.
      isOver && "ring-2 ring-teal border-teal bg-teal-soft/60",
      isSource && "opacity-40",
    );

    return (
      <div
        className="h-full w-full"
        onDragOver={(e) => handleDragOver(e, cellKey, p.isBreak)}
        onDragLeave={() => setDragOverCell(null)}
        onDrop={(e) => handleDrop(e, day, p.key, p.isBreak)}
      >
        {onSlotClick ? (
          <button
            type="button"
            draggable={draggable && Boolean(l)}
            onDragStart={(e) => handleDragStart(e, day, p.key)}
            onDragEnd={() => { setDragSource(null); setDragOverCell(null); }}
            onClick={() => onSlotClick(day, p)}
            aria-label={slotLabel?.(day, p, l) ?? `${WEEKDAY_NAMES[day]} ${p.label}: ${l ? l.subject : "empty"}`}
            className={cn(cls, "hover:-translate-y-0.5 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-teal", !l && "hover:border-teal hover:bg-teal-soft/40")}
          >
            {body}
          </button>
        ) : (
          <div className={cls}>{body}</div>
        )}
      </div>
    );
  };

  return (
    <>
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