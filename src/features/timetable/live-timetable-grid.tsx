"use client";
/**
 * The weekly timetable of a REAL (Convex) student's section (student portal, My Timetable).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Card, EmptyState } from "@/components/ui";
import { TimetableGrid, daysWithLessons } from "@/features/timetable/timetable-grid";

type Ok<T> = Extract<T, { state: "ok" }>;
export type LiveTimetable = Omit<Ok<FunctionReturnType<typeof api.timetable.myStudentTimetable>>, "state" | "section">;

export function LiveTimetableGrid({ timetable }: { timetable: LiveTimetable }) {
  const periods = [...timetable.periods].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.index - b.index);
  if (timetable.lessons.length === 0) return <Card><EmptyState title="No timetable yet" description="The school has not published a timetable for this class." /></Card>;
  return (
    <Card className="p-4 sm:p-5" data-testid="live-timetable">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Weekly timetable</p>
      <TimetableGrid
        days={daysWithLessons(timetable.lessons.map((l) => l.dayOfWeek))}
        periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
        lessonAt={(d, gp) => {
          const l = timetable.lessons.find((x) => x.dayOfWeek === d && x.periodId === gp.key);
          return l ? { subject: l.subject, detail: [l.room, l.teacher].filter(Boolean).join(" · ") } : undefined;
        }}
      />
    </Card>
  );
}
