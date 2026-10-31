"use client";
/** Examinations' parts of the teacher landing page: marks still to enter (contributed, see src/modules/examinations/contributions.tsx). */
import Link from "next/link";
import { Save } from "lucide-react";
import type { TeacherDayData } from "@/lib/contributions/types";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui";

export function MarksStat({ d }: { d: TeacherDayData }) {
  const left = d.marksTasks.reduce((a, t) => a + (t.total - t.entered), 0);
  return <StatCard label="Marks to enter" value={left} hint={`${d.marksTasks.length} paper${d.marksTasks.length === 1 ? "" : "s"} open`} icon={<Save className="h-5 w-5" />} tone="lavender" href="/teacher/examinations/marks" />;
}

export function MarksPanel({ d }: { d: TeacherDayData }) {
  return (
    <Card>
      <CardHeader title="Marks to enter" description="Papers you are assigned to, in exams open for marks entry." />
      <div className="p-5 pt-2">
        {d.marksTasks.length === 0 ? <EmptyState title="No marks pending" /> : (
          <ul className="divide-y divide-line/60">
            {d.marksTasks.map((t) => (
              <li key={`${t.examSubjectId}:${t.sectionId}`} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/teacher/examinations/marks?examId=${t.examId}`} className="min-w-0"><span className="block font-medium text-ink hover:text-lagoon">{t.label}</span><span className="text-[12px] text-ink-muted">{t.examName}</span></Link>
                <span className="text-[12.5px] text-ink-soft">{t.entered}/{t.total} entered</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
