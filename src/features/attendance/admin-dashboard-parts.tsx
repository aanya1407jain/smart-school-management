"use client";
/** Attendance's parts of the admin dashboard (contributed, see src/modules/attendance/contributions.tsx). */
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, CalendarCheck2, ClipboardCheck } from "lucide-react";
import type { AdminDashboardPartProps } from "@/lib/contributions/types";
import { AlertPill, StatCard } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { formatPercent } from "@/lib/utils/format";
import { formatShortDate } from "@/lib/utils/dates";

export function AttendanceAlerts({ d }: AdminDashboardPartProps) {
  if (!((d.tasks.unmarkedToday ?? 0) > 0 || (d.tasks.pendingLeave ?? 0) > 0)) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {(d.tasks.unmarkedToday ?? 0) > 0 && (
        <AlertPill href="/admin/attendance" tone="plum" icon={<AlertCircle className="h-4 w-4" aria-hidden />} className="flex-1">
          <strong className="figures text-plum">{d.tasks.unmarkedToday} of {d.stats.sections} sections</strong> haven&apos;t marked attendance today.
        </AlertPill>
      )}
      {(d.tasks.pendingLeave ?? 0) > 0 && (
        <AlertPill href="/admin/teachers?tab=leave" tone="teal" icon={<ClipboardCheck className="h-4 w-4" aria-hidden />} className="flex-1">
          <strong className="figures text-ink">{d.tasks.pendingLeave} leave request{(d.tasks.pendingLeave ?? 0) > 1 ? "s" : ""}</strong> awaiting approval
        </AlertPill>
      )}
    </div>
  );
}

export function AttendanceStat({ d }: AdminDashboardPartProps) {
  const att = d.stats.attendance;
  return (
    <StatCard
      label={att.isToday ? "Today's attendance" : `Attendance · ${formatShortDate(att.date)}`}
      value={formatPercent(att.percentage, 1)}
      icon={<CalendarCheck2 className="h-5 w-5" />}
      tone="purple"
      delta={att.delta}
      hint={`${att.absent} absent · ${att.marked}/${att.totalSections} marked`}
      href="/admin/attendance"
    />
  );
}

export function AttendanceTrendPanel({ d }: AdminDashboardPartProps) {
  return (
    <ChartCard title="Attendance overview" description="School-wide daily attendance, last 15 school days" action={<Link href="/admin/reports?tab=attendance" className="text-[13px] font-medium text-lagoon hover:underline">Full report</Link>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.attendanceTrend.map((p) => ({ ...p, label: formatShortDate(p.date) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
          <YAxis domain={[70, 100]} ticks={[70, 80, 90, 100]} allowDataOverflow {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
          <Tooltip
            content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} extra={(r) => (typeof r.counted === "number" ? `${r.present} of ${r.counted} students present` : null)} />}
            cursor={barCursor}
          />
          <Bar dataKey="percentage" name="Attendance" {...barProps("single")} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
