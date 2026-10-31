"use client";
/** Examinations' parts of the admin dashboard (contributed, see src/modules/examinations/contributions.tsx). */
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock } from "lucide-react";
import type { AdminDashboardPartProps } from "@/lib/contributions/types";
import { CardHeader, EmptyState, GlassCard, ProgressBar, StatusBadge } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { formatDate } from "@/lib/utils/dates";

export function UpcomingExamsPanel({ d }: AdminDashboardPartProps) {
  return (
    <GlassCard className="h-full">
      <CardHeader title="Examinations" description="Upcoming and in progress" icon={<CalendarClock className="h-4 w-4" />} action={<Link href="/admin/examinations" className="text-[13px] font-medium text-lagoon hover:underline">View all</Link>} />
      <ul className="space-y-2.5 p-5">
        {d.upcomingExams.length === 0 && <EmptyState title="No upcoming examinations" className="py-6" />}
        {d.upcomingExams.map((e) => (
          <li key={e.id}>
            <Link href={`/admin/examinations/${e.id}`} className="block rounded-xl border border-white/60 bg-white/60 p-3.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-ambient-lg">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{e.name}</p>
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-1 text-[12.5px] text-ink-muted">{formatDate(e.startDate)} – {formatDate(e.endDate)} · {e.classCount} classes · {e.paperCount} papers</p>
              {e.marksProgress !== null && (
                <div className="mt-2.5 flex items-center gap-2">
                  <ProgressBar value={e.marksProgress} label="Marks entry progress" />
                  <span className="figures text-[12px] font-medium text-ink-soft">{Math.round(e.marksProgress)}%</span>
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

export function PerformancePanel({ d }: AdminDashboardPartProps) {
  return (
    <ChartCard title="Academic performance" description={d.performance.examName ? `Average score by class — ${d.performance.examName}` : "No published results yet"} action={<Link href="/admin/reports?tab=exams" className="text-[13px] font-medium text-lagoon hover:underline">Details</Link>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.performance.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
          <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
          <Bar dataKey="average" name="Class average" {...barProps("secondary")} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
