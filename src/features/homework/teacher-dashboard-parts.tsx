"use client";
/** Academics' parts of the teacher landing page: today's lessons and homework to review (contributed, see src/modules/academics/contributions.tsx). */
import Link from "next/link";
import { BookOpenCheck, CalendarDays, ClipboardList, Plus } from "lucide-react";
import type { TeacherDayData } from "@/lib/contributions/types";
import { Badge, Card, CardHeader, EmptyState, LinkButton, StatCard } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function HomeworkAction() {
  return <LinkButton href="/teacher/homework" variant="outline"><Plus className="h-4 w-4" /> Homework</LinkButton>;
}

export function TeachingStats({ d }: { d: TeacherDayData }) {
  const toReview = d.homeworkToReview.reduce((a, h) => a + h.pending, 0);
  return (
    <>
      <StatCard label="Lessons today" value={d.todayLessons.length} hint={d.todayLessons.length ? `First at ${clock(d.todayLessons[0].startTime)}` : "None scheduled"} icon={<BookOpenCheck className="h-5 w-5" />} tone="teal" href="/teacher/timetable" />
      <StatCard label="Submissions to review" value={toReview} hint={`${d.homeworkToReview.length} homework item${d.homeworkToReview.length === 1 ? "" : "s"}`} icon={<ClipboardList className="h-5 w-5" />} tone="purple" href="/teacher/homework" />
    </>
  );
}

export function TeachingPanels({ d }: { d: TeacherDayData }) {
  return (
    <>
      <Card>
        <CardHeader title="Today's lessons" description={d.isWorkingDay ? "From the school's published timetable." : "No lessons on non-working days."} />
        <div className="p-5 pt-2">
          {d.todayLessons.length === 0 ? <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No lessons scheduled today" description="Lessons appear here once the school places them in the timetable." /> : (
            <ul className="divide-y divide-line/60">
              {d.todayLessons.map((l) => (
                <li key={l.entryId} className="flex items-center gap-3 py-2.5">
                  <span className="w-28 shrink-0 text-[12.5px] text-ink-muted">{clock(l.startTime)}–{clock(l.endTime)}</span>
                  <span className="font-medium text-ink">{l.subject}</span>
                  <span className="text-[12.5px] text-ink-muted">Class {l.section}{l.room ? ` · ${l.room}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Homework to review" description="Your open homework with submissions waiting for feedback." />
        <div className="p-5 pt-2">
          {d.homeworkToReview.length === 0 ? <EmptyState title="Nothing waiting for review" /> : (
            <ul className="divide-y divide-line/60">
              {d.homeworkToReview.map((h) => (
                <li key={h.homeworkId} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/teacher/homework/${h.homeworkId}`} className="min-w-0"><span className="block truncate font-medium text-ink hover:text-lagoon">{h.title}</span><span className="text-[12px] text-ink-muted">Class {h.section} · {h.subject} · due {formatDate(h.dueDate)}</span></Link>
                  <Badge tone="lavender">{h.pending} to review</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
