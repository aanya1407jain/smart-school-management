"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useActiveStudentId } from "@/features/auth/session-provider";
import { Button, Card, CardHeader, EmptyState, GlassCard, PageHeader, ProgressRing } from "@/components/ui";
import { ChartTooltip, axisProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
import { formatPercent } from "@/lib/utils/format";
import { toISODate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export function MyAttendance() {
  const studentId = useActiveStudentId();
  const isConvexId = Boolean(studentId && !studentId.startsWith("stu_") && studentId.length > 10);

  const data = useQuery(
    api.attendance.studentHistory,
    isConvexId ? { studentId: studentId as Id<"students"> } : "skip"
  );

  // Fallback demo records for mock users or when no database records exist
  const MOCK_RECORDS: { date: string; status: "present" | "absent" | "late" | "excused" }[] = useMemo(() => [
    { date: todayISO(), status: "present" },
    { date: "2026-10-14", status: "present" },
    { date: "2026-10-13", status: "late" },
    { date: "2026-10-12", status: "present" },
    { date: "2026-10-09", status: "absent" },
    { date: "2026-10-08", status: "present" },
    { date: "2026-10-07", status: "present" },
  ], []);

  const displayRecords = (data?.records && data.records.length > 0) ? data.records : MOCK_RECORDS;

  const monthly = useMemo(() => {
    if (!displayRecords || displayRecords.length === 0) return [];
    const map = new Map<string, { total: number; attended: number }>();
    for (const r of displayRecords) {
      const month = r.date.slice(0, 7);
      const curr = map.get(month) ?? { total: 0, attended: 0 };
      if (r.status !== "excused") {
        curr.total += 1;
        if (r.status === "present" || r.status === "late") {
          curr.attended += 1;
        }
      }
      map.set(month, curr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stats]) => ({
        month,
        percentage: stats.total > 0 ? (stats.attended / stats.total) * 100 : 0,
        label: new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }),
      }));
  }, [displayRecords]);

  // Only show loader if we are genuinely waiting for a real Convex query
  if (isConvexId && data === undefined) {
    return (
      <div>
        <PageHeader
          title="My Attendance"
          description="Your attendance for the 2026–27 academic year, updated as soon as your teacher saves the register."
        />
        <Card className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
        </Card>
      </div>
    );
  }

  const threshold = data?.lowAttendanceThreshold ?? 75;
  
  // Calculate stats from displayRecords if backend totals aren't present
  const totals = data?.totals ?? {
    presentCount: displayRecords.filter((r) => r.status === "present").length,
    absentCount: displayRecords.filter((r) => r.status === "absent").length,
    lateCount: displayRecords.filter((r) => r.status === "late").length,
    excusedCount: displayRecords.filter((r) => r.status === "excused").length,
  };

  const totalDays = totals.presentCount + totals.absentCount + totals.lateCount + totals.excusedCount;
  const attendedCount = totals.presentCount + totals.lateCount;
  const percentage = data?.percentage ?? (totalDays > 0 ? Math.round((attendedCount / totalDays) * 1000) / 10 : 0);
  const low = percentage < threshold;

  return (
    <div>
      <PageHeader
        title="My Attendance"
        description="Your attendance for the 2026–27 academic year, updated as soon as your teacher saves the register."
      />
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <GlassCard className="flex flex-col items-center p-6 text-center">
            <ProgressRing
              value={percentage}
              size={150}
              stroke={12}
              sublabel="overall"
              tone={low ? "plum" : "teal"}
            />
            <p className={cn("mt-4 text-sm font-medium", low ? "text-plum" : "text-lagoon")}>
              {low ? `Below the ${threshold}% requirement` : `Above the ${threshold}% requirement`}
            </p>
            <dl className="mt-4 grid w-full grid-cols-4 gap-2 text-sm">
              <div>
                <dt className="text-ink-muted">Days</dt>
                <dd className="font-semibold text-ink">{totalDays}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Present</dt>
                <dd className="font-semibold text-ink">{totals.presentCount}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Late</dt>
                <dd className="font-semibold text-ink">{totals.lateCount}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Absent</dt>
                <dd className="font-semibold text-ink">{totals.absentCount}</dd>
              </div>
            </dl>
          </GlassCard>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Month by month"
              description={`Dashed line marks the ${threshold}% requirement`}
            />
            <div className="h-64 px-3 pb-4">
              {monthly.length === 0 ? (
                <EmptyState title="No monthly records yet" className="py-12" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART_GRID} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                    <Tooltip
                      content={<ChartTooltip format={(v) => `${Number(v).toFixed(1)}%`} />}
                      cursor={{ fill: "rgba(188,197,204,0.18)" }}
                    />
                    <ReferenceLine y={threshold} stroke={CHART.highlight} strokeDasharray="4 4" />
                    <Bar
                      dataKey="percentage"
                      name="Attendance"
                      fill={CHART.single}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={44}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>

        <AttendanceCalendar records={displayRecords} />
      </div>
    </div>
  );
}

function AttendanceCalendar({ records }: { records: { date: string; status: "present" | "absent" | "late" | "excused" }[] }) {
  const byDate = useMemo(() => Object.fromEntries(records.map((r) => [r.date, r.status])), [records]);
  const latest = records[0]?.date ?? todayISO();
  const [cursor, setCursor] = useState(() => new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1, 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => toISODate(new Date(year, month, i + 1)))];
  const monthRecords = records.filter((r) => r.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`));

  return (
    <Card>
      <CardHeader
        title="Attendance calendar"
        description={cursor.toLocaleString("en-IN", { month: "long", year: "numeric" })}
        action={
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <div className="p-5">
        {monthRecords.length === 0 && <EmptyState title="No attendance recorded this month" className="py-4" />}
        <div className="grid grid-cols-7 gap-1.5 text-center" role="grid" aria-label="Attendance calendar">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="pb-1 text-[11.5px] font-semibold uppercase text-ink-muted" role="columnheader">{d}</div>
          ))}
          {cells.map((c, i) => {
            if (!c) return <div key={`e${i}`} />;
            const st = byDate[c];
            return (
              <div
                key={c}
                role="gridcell"
                aria-label={`${c}: ${st ?? "no record"}`}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center rounded-xl text-sm sm:aspect-[1.6]",
                  st === "present" ? "bg-teal-soft text-lagoon" : st === "absent" ? "bg-blush/70 font-semibold text-plum" : st === "late" ? "bg-lavender/35 text-plum" : "text-ink-muted/60",
                  c === todayISO() && "ring-2 ring-sapphire"
                )}
              >
                <span>{Number(c.slice(8))}</span>
                {st && <span className="hidden text-[10px] font-semibold uppercase sm:block">{st === "present" ? "P" : st === "absent" ? "Absent" : "Late"}</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-teal-soft" /> Present</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-lavender/35" /> Late</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-blush/70" /> Absent</span>
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">
          This month: {formatPercent(monthRecords.length ? (monthRecords.filter((r) => r.status !== "absent").length / monthRecords.length) * 100 : null)}
        </p>
      </div>
    </Card>
  );
}