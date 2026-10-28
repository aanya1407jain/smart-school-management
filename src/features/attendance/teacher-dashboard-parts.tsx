"use client";
/** Attendance's parts of the teacher landing page: today's registers (contributed, see src/modules/attendance/contributions.tsx). */
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { TeacherDayData } from "@/lib/contributions/types";
import { Badge, Card, CardHeader, EmptyState, LinkButton, StatCard } from "@/components/ui";

const pendingOf = (d: TeacherDayData) => (d.isWorkingDay ? d.classTeacherOf.filter((s) => s.registerMarked === false) : []);

export function RegistersAction({ d }: { d: TeacherDayData }) {
  return <LinkButton href="/teacher/attendance"><CalendarDays className="h-4 w-4" /> {d.classTeacherOf.length ? "Mark attendance" : "View attendance"}</LinkButton>;
}

export function RegistersStat({ d }: { d: TeacherDayData }) {
  const pending = pendingOf(d);
  return <StatCard label="Registers to mark today" value={pending.length} hint={d.isWorkingDay ? (d.classTeacherOf.length ? `${d.classTeacherOf.length - pending.length}/${d.classTeacherOf.length} marked` : "You are not a class teacher") : "Not a school day"} icon={<CalendarDays className="h-5 w-5" />} tone="sapphire" href="/teacher/attendance" />;
}

export function RegistersPanel({ d }: { d: TeacherDayData }) {
  return (
    <Card>
      <CardHeader title="Attendance registers" description="Sections you own as class teacher." />
      <div className="p-5 pt-2">
        {d.classTeacherOf.length === 0 ? <EmptyState title="You are not a class teacher" description="Only a section's class teacher marks its register." /> : (
          <ul className="divide-y divide-line/60">
            {d.classTeacherOf.map((s) => (
              <li key={s.sectionId} className="flex items-center justify-between gap-3 py-2.5">
                <span><span className="font-medium text-ink">Class {s.displayName}</span> <span className="text-[12.5px] text-ink-muted">· {s.students} students</span></span>
                {s.registerMarked ? <Badge tone="teal">Marked today</Badge> : d.isWorkingDay ? <Link href={`/teacher/attendance?section=${s.sectionId}`} className="text-[13px] font-medium text-lagoon hover:underline">Mark now</Link> : <Badge tone="neutral">No school today</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
