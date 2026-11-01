"use client";
import type { Period, Weekday } from "@/types/academics";
import type { TimetableCell } from "@/lib/services/timetable.service";
import { WEEKDAY_NAMES } from "@/lib/utils/dates";
import { TimetableGrid, type GridPeriod } from "./timetable-grid";

/** Demo-data adapter for the shared TimetableGrid (section or teacher view). */
export function WeekGrid({
  periods, entries, mode, onCellClick, highlightToday = true,
}: {
  periods: Period[];
  entries: TimetableCell[];
  mode: "section" | "teacher";
  onCellClick?: (day: Weekday, period: Period, entry: TimetableCell | undefined) => void;
  highlightToday?: boolean;
}) {
  const byKey = new Map(periods.map((p) => [`${p.index}-${p.label}`, p]));
  const gridPeriods: GridPeriod[] = periods.map((p) => ({ key: `${p.index}-${p.label}`, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }));
  const entryAt = (day: number, gp: GridPeriod) => {
    const p = byKey.get(gp.key)!;
    return entries.find((e) => e.day === day && e.period === p.index);
  };
  return (
    <TimetableGrid
      periods={gridPeriods}
      highlightToday={highlightToday}
      lessonAt={(day, gp) => {
        const e = entryAt(day, gp);
        if (!e) return undefined;
        const detail = mode === "section" ? [e.room, e.teacher] : [`Class ${e.sectionLabel}`, e.room];
        return { subject: e.subject, detail: detail.filter(Boolean).join(" · "), colorKey: e.subjectId };
      }}
      onSlotClick={onCellClick ? (day, gp) => onCellClick(day as Weekday, byKey.get(gp.key)!, entryAt(day, gp)) : undefined}
      slotLabel={(day, gp, l) => `${WEEKDAY_NAMES[day]} ${gp.label}: ${l ? l.subject : "empty"}. Edit`}
    />
  );
}
