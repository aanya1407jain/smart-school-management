"use client";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, PenLine } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Card, CardHeader, EmptyState, PageHeader, ProgressBar, QueryView, StatusBadge, FilterBar, FilterSelect } from "@/components/ui";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { formatDate, formatShortDate } from "@/lib/utils/dates";
import { useState } from "react";

export function TeacherExams() {
  const opts = useAcademicOptions();
  const [classId, setClassId] = useState("");
  const tasks = useQuery(() => services.exams.getMarkEntryTasks(), []);
  const exams = useQuery(() => services.exams.list({ classId }), [classId]);
  return (
    <div>
      <PageHeader title="Examinations" description="Date sheets for your classes and marks entry for the subjects you teach." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card className="p-4"><FilterBar><FilterSelect label="Class" value={classId} onChange={setClassId} allLabel="All my classes" options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} /></FilterBar></Card>
          <QueryView query={exams} loading="cards">
            {(rows) => rows.length === 0 ? <Card><EmptyState title="No upcoming examinations" /></Card> : (
              <ul className="space-y-3">
                {rows.map((e) => (
                  <li key={e.id}>
                    <Link href={`/teacher/examinations/${e.id}`} className="glass flex items-center gap-4 rounded-2xl p-4 transition-all hover:shadow-lift">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-soft text-lagoon"><BookOpenCheck className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-sapphire">{e.name}</p><StatusBadge status={e.status} /></div>
                        <p className="text-[13px] text-ink-muted">{formatDate(e.startDate)} – {formatDate(e.endDate)} · {e.paperCount} papers for your classes</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </div>
        <Card className="h-fit">
          <CardHeader title="Marks to enter" description="Sheets for your subject–section pairs" icon={<PenLine className="h-4 w-4" />} />
          <div className="p-5">
            <QueryView query={tasks} loading="inline">
              {(t) => t.length === 0 ? <EmptyState title="You're up to date" description="No pending marks entry." className="py-4" /> : (
                <ul className="space-y-2">
                  {t.map((x) => (
                    <li key={`${x.paperId}-${x.sectionId}`}>
                      <Link href={`/teacher/examinations/marks?paper=${x.paperId}&section=${x.sectionId}`} className="block rounded-xl border border-line/70 p-3.5 hover:bg-alabaster">
                        <p className="text-sm font-semibold text-ink">{x.subject} · Class {x.label}</p>
                        <p className="text-[12px] text-ink-muted">{x.examName} · paper on {formatShortDate(x.date)}</p>
                        <div className="mt-2 flex items-center gap-2"><ProgressBar value={(x.entered / Math.max(1, x.total)) * 100} label="Entered" /><span className="text-[12px] text-ink-soft">{x.entered}/{x.total}</span></div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </QueryView>
          </div>
        </Card>
      </div>
    </div>
  );
}
