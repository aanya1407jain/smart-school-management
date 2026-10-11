"use client";
import { useState } from "react";
import { Coffee, Plus } from "lucide-react";
import type { Period, Weekday } from "@/types/domain";
import type { TimetableCell } from "@/lib/services/timetable.service";
import { formatClock, dayOfWeek, todayISO, WEEKDAY_NAMES } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { Segmented } from "@/components/ui/segmented";

const DAYS: Weekday[] = [1, 2, 3, 4, 5];

/** Subject → soft tint, so a week reads at a glance (always paired with text). */
const SUBJECT_TINT: Record<string, string> = {
  sub_math: "bg-teal-soft border-teal/25",
  sub_sci: "bg-sapphire/[0.06] border-sapphire/15",
  sub_eng: "bg-lavender/20 border-mauve/25",
  sub_cs: "bg-heather/25 border-heather/50",
  sub_sst: "bg-blush/40 border-blush",
  sub_hin: "bg-alabaster border-line",
};

export function WeekGrid({
  periods, entries, mode, onCellClick, highlightToday = true,
}: {
  periods: Period[];
  entries: TimetableCell[];
  mode: "section" | "teacher";
  onCellClick?: (day: Weekday, period: Period, entry: TimetableCell | undefined) => void;
  highlightToday?: boolean;
}) {
  const today = dayOfWeek(todayISO());
  const [mobileDay, setMobileDay] = useState<Weekday>((today >= 1 && today <= 5 ? today : 1) as Weekday);
  const cell = (day: Weekday, p: Period) => entries.find((e) => e.day === day && e.period === p.index);

  const Cell = ({ day, p }: { day: Weekday; p: Period }) => {
    const e = cell(day, p);
    const content = e ? (
      <>
        <p className="truncate text-[13px] font-semibold text-ink">{e.subject}</p>
        <p className="truncate text-[11.5px] text-ink-muted">{mode === "section" ? e.teacher : `Class ${e.sectionLabel}`}</p>
        <p className="truncate text-[11px] text-ink-muted/80">{e.room}</p>
      </>
    ) : (
      <p className="flex items-center gap-1 text-[12px] text-ink-muted">{onCellClick ? <><Plus className="h-3.5 w-3.5" /> Add</> : "Free"}</p>
    );
    const cls = cn("h-full min-h-[68px] w-full rounded-xl border px-2.5 py-2 text-left transition-all", e ? SUBJECT_TINT[e.subjectId] ?? "bg-white border-line" : "border-dashed border-line/80 bg-white/40");
    return onCellClick ? (
      <button onClick={() => onCellClick(day, p, e)} className={cn(cls, "hover:-translate-y-0.5 hover:shadow-soft")} aria-label={`${WEEKDAY_NAMES[day]} ${p.label}: ${e ? e.subject : "empty"}. Edit`}>{content}</button>
    ) : <div className={cls}>{content}</div>;
  };

  return (
    <>
      {/* Desktop grid */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-separate border-spacing-1.5">
          <caption className="sr-only">Weekly timetable</caption>
          <thead>
            <tr>
              <th scope="col" className="w-28 text-left text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Period</th>
              {DAYS.map((d) => (
                <th key={d} scope="col" className={cn("rounded-lg py-1.5 text-center text-[12.5px] font-semibold", highlightToday && d === today ? "bg-sapphire text-white" : "text-ink-soft")}>
                  {WEEKDAY_NAMES[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => p.isBreak ? (
              <tr key={p.label}>
                <th scope="row" className="text-left text-[11.5px] font-medium text-ink-muted">{formatClock(p.startTime)}</th>
                <td colSpan={5} className="rounded-lg bg-alabaster/80 py-1 text-center text-[12px] text-ink-muted"><Coffee className="mr-1 inline h-3.5 w-3.5" aria-hidden />{p.label} · {formatClock(p.startTime)} – {formatClock(p.endTime)}</td>
              </tr>
            ) : (
              <tr key={p.index}>
                <th scope="row" className="pr-2 text-left align-top">
                  <p className="text-[12.5px] font-semibold text-ink">{p.label}</p>
                  <p className="text-[11px] text-ink-muted">{formatClock(p.startTime)} – {formatClock(p.endTime)}</p>
                </th>
                {DAYS.map((d) => <td key={d} className={cn("align-top", highlightToday && d === today && "rounded-xl bg-teal-soft/30")}><Cell day={d} p={p} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: one day at a time */}
      <div className="md:hidden">
        <Segmented<string>
          label="Day"
          size="sm"
          className="mb-3 w-full justify-between"
          value={String(mobileDay)}
          onChange={(v) => setMobileDay(Number(v) as Weekday)}
          options={DAYS.map((d) => ({ value: String(d), label: WEEKDAY_NAMES[d].slice(0, 3) }))}
        />
        <ul className="space-y-2">
          {periods.map((p) => p.isBreak ? (
            <li key={p.label} className="rounded-lg bg-alabaster py-1.5 text-center text-[12px] text-ink-muted">{p.label} · {formatClock(p.startTime)}</li>
          ) : (
            <li key={p.index} className="grid grid-cols-[72px_1fr] items-stretch gap-2">
              <div className="pt-2"><p className="text-[12px] font-semibold text-ink">{formatClock(p.startTime)}</p><p className="text-[11px] text-ink-muted">{p.label}</p></div>
              <Cell day={mobileDay} p={p} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
