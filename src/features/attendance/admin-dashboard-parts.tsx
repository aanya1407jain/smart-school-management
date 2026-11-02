"use client";
/** Attendance's parts of the admin dashboard (contributed, see src/modules/attendance/contributions.tsx). */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarCheck2 } from "lucide-react";
import type { AdminAttentionItem, AdminDashboardPartProps, AdminDashboardVM } from "@/lib/contributions/types";
import { MetricCard, Panel, PanelEmpty, PanelLink } from "@/features/dashboard/principal-ui";
import { PD_CHART } from "@/lib/constants/theme";
import { formatPercent, pluralize } from "@/lib/utils/format";
import { formatShortDate, isSchoolDay, todayISO } from "@/lib/utils/dates";

/**
 * The attendance figure always names the day it describes: today (complete or
 * partial) or, when nothing is marked today, the last day that was recorded.
 */
export function AttendanceMetric({ d }: AdminDashboardPartProps) {
  const att = d.stats.attendance;
  const partial = att.isToday && att.marked < att.totalSections;
  // On a non-school day an older figure is simply the last school day, not a missed register.
  // The server applies the school's working days and holidays: it reports 0 unmarked sections on
  // a non-school day (and every section on a school day with nothing marked yet).
  const schoolDay = att.isToday || (d.tasks.unmarkedToday !== null ? d.tasks.unmarkedToday > 0 : isSchoolDay(todayISO()));
  if (att.percentage === null) {
    return <MetricCard label="Attendance" value="Not marked" support={att.isToday ? "No register marked today yet" : "No attendance recorded yet"} tone={schoolDay ? "warning" : "neutral"} icon={CalendarCheck2} href="/admin/attendance" />;
  }
  return (
    <MetricCard
      label="Attendance"
      value={formatPercent(att.percentage, 1)}
      support={
        !att.isToday ? (schoolDay ? `Last recorded ${formatShortDate(att.date)} · today not marked yet` : `Last recorded ${formatShortDate(att.date)} · no school today`)
        : partial ? `Today so far · ${att.marked} of ${pluralize(att.totalSections, "section")} marked`
        : `Today · ${att.absent} absent`
      }
      tone={(!att.isToday && schoolDay) || partial ? "warning" : "neutral"}
      icon={CalendarCheck2}
      href="/admin/attendance"
    />
  );
}

export function attendanceAttention(d: AdminDashboardVM): AdminAttentionItem[] {
  const items: AdminAttentionItem[] = [];
  const unmarked = d.tasks.unmarkedToday ?? 0;
  const leave = d.tasks.pendingLeave ?? 0;
  if (unmarked > 0) {
    items.push({
      key: "attendance-unmarked", tone: "danger",
      title: `${unmarked} of ${pluralize(d.stats.sections, "section")} haven't marked attendance today`,
      detail: "Class teachers mark registers; you can follow up from Attendance.",
      href: "/admin/attendance", action: "Review registers",
    });
  }
  if (leave > 0) {
    items.push({
      key: "leave-pending", tone: "warning",
      title: `${pluralize(leave, "staff leave request")} awaiting approval`,
      href: "/admin/teachers?tab=leave", action: "Review requests",
    });
  }
  return items;
}

/** Compact daily trend; the summary line gives the key numbers without hovering. */
export function AttendanceTrendOverview({ d }: AdminDashboardPartProps) {
  const rows = d.attendanceTrend.map((p) => ({ ...p, label: formatShortDate(p.date) }));
  const first = rows[0];
  const last = rows[rows.length - 1];
  const avg = rows.length ? rows.reduce((s, r) => s + r.percentage, 0) / rows.length : null;
  const low = rows.reduce<(typeof rows)[number] | null>((m, r) => (!m || r.percentage < m.percentage ? r : m), null);
  const minY = low ? Math.max(0, Math.floor((low.percentage - 5) / 10) * 10) : 0;
  return (
    <Panel
      title="Attendance trend"
      description={first && last ? `Daily, school-wide · ${pluralize(rows.length, "school day")} (${first.label} – ${last.label})` : "Daily, school-wide"}
      action={<PanelLink href="/admin/reports?tab=attendance">Report</PanelLink>}
      testId="dash-attendance-trend"
    >
      {rows.length === 0 ? <PanelEmpty>No attendance recorded this year yet.</PanelEmpty> : (
        <>
          <p className="text-[13px] text-pd-muted">
            Average <span className="font-semibold text-pd-ink tabular-nums">{formatPercent(avg, 1)}</span>
            {low && <> · lowest <span className="font-semibold text-pd-ink tabular-nums">{formatPercent(low.percentage, 1)}</span> on {low.label}</>}
          </p>
          <div className="mt-2 h-40" role="img" aria-label={`Daily attendance from ${first.label} to ${last.label}: average ${formatPercent(avg, 1)}, latest ${formatPercent(last.percentage, 1)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={PD_CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: PD_CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis domain={[minY, 100]} allowDataOverflow tick={{ fill: PD_CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={40} tickCount={3} />
                <Tooltip
                  cursor={{ fill: PD_CHART.grid, opacity: 0.5 }}
                  content={({ active, payload }) => {
                    const r = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                    if (!r) return null;
                    return (
                      <div className="rounded-lg border border-pd-line bg-white px-2.5 py-1.5 text-[12px] text-pd-ink shadow-sm">
                        <p className="font-semibold">{r.label} · {formatPercent(r.percentage, 1)}</p>
                        {typeof r.counted === "number" && <p className="text-pd-muted">{r.present} of {r.counted} students present</p>}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="percentage" name="Attendance" fill={PD_CHART.accent} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}
