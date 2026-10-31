"use client";
/**
 * The LIVE teacher timetable (Academics).
 */
import { CalendarDays } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { Card, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { getAppError } from "@/lib/convex/errors";
import { TimetableGrid, daysWithLessons } from "@/features/timetable/timetable-grid";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function LiveTeacherTimetable() {
  const t = useSchoolQuery(api.timetable.myTimetable, {});
  if (t === undefined) return <LoadingState variant="table" label="Loading timetable" />;
  const periods = [...t.periods].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.index - b.index);
  return (
    <div>
      <PageHeader title="My Timetable" description={`${t.lessons.length} lesson${t.lessons.length === 1 ? "" : "s"} a week, from the school's published timetable.`} />
      {t.lessons.length === 0 ? <Card><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No lessons scheduled" description="The school has not placed any of your lessons in the timetable yet." /></Card> : (
        <Card className="p-4 sm:p-5" data-testid="live-teacher-timetable">
          <TimetableGrid
            caption="My weekly timetable"
            days={daysWithLessons(t.lessons.map((l) => l.dayOfWeek))}
            periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
            lessonAt={(d, gp) => {
              const l = t.lessons.find((x) => x.dayOfWeek === d && x.periodId === gp.key);
              return l ? { subject: l.subject, detail: [`Class ${l.section}`, l.room].filter(Boolean).join(" · ") } : undefined;
            }}
          />
        </Card>
      )}
    </div>
  );
}
