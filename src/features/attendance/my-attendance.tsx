"use client";

/**
 * "My Attendance" for DEMO sessions (Aster Academy demo personas). Live
 * school accounts get `LiveMyAttendance` (student-portal/live-portal.tsx,
 * Convex `attendance.studentHistory`) — see src/app/student/attendance/page.tsx.
 *
 * Data comes from the demo dataset through `services.attendance`, which checks
 * that the signed-in student may see the selected student. Nothing
 * is invented: with no records the page shows empty states.
 *
 * Layout (summary card, month-by-month chart, calendar) from d78a25d; the
 * arithmetic follows the product rules in ./attendance-summary.ts.
 */
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId } from "@/features/auth/session-provider";
import { Button, Card, CardHeader, EmptyState, GlassCard, PageHeader, ProgressRing, QueryView } from "@/components/ui";
import { ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { CHART } from "@/lib/constants/theme";
import { formatPercent } from "@/lib/utils/format";
import { toISODate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { latestRecordDate, monthlyAttendance, summarizeAttendance, type AttendanceRecord } from "./attendance-summary";

export function MyAttendance() {
  const studentId = useActiveStudentId();
  const q = useQuery(() => services.attendance.getStudentAttendance(studentId!), [studentId], { enabled: !!studentId });

  return (
    <div>
      <PageHeader
        title="My Attendance"
        description="Your attendance for the 2026–27 academic year, updated as soon as your teacher saves the register."
      />
      {!studentId ? (
        <EmptyState title="No student selected" description="This account is not linked to a student record." />
      ) : (
        <QueryView query={q}>
          {(d) => <AttendanceOverview key={studentId} records={d.records} threshold={d.threshold} lateCountsAsPresent={d.lateCountsAsPresent} />}
        </QueryView>
      )}
    </div>
  );
}

function AttendanceOverview({ records, threshold, lateCountsAsPresent }: { records: AttendanceRecord[]; threshold: number; lateCountsAsPresent: boolean }) {
  const opts = { lateCountsAsPresent };
  const totals = useMemo(() => summarizeAttendance(records, { lateCountsAsPresent }), [records, lateCountsAsPresent]);
  const monthly = useMemo(
    () =>
      monthlyAttendance(records, { lateCountsAsPresent }).map((m) => ({
        ...m,
        label: new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }),
      })),
    [records, lateCountsAsPresent],
  );
  const percentage = totals.percentage;
  const low = percentage !== null && percentage < threshold;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="flex flex-col items-center p-6 text-center">
          <ProgressRing value={percentage} size={150} stroke={12} sublabel="overall" tone={low ? "plum" : "teal"} />
          <p className={cn("mt-4 text-sm font-medium", percentage === null ? "text-ink-muted" : low ? "text-plum" : "text-lagoon")}>
            {percentage === null ? "No attendance has been marked yet." : low ? `Below the ${threshold}% requirement` : `Above the ${threshold}% requirement`}
          </p>
          <dl className="mt-4 grid w-full grid-cols-4 gap-2 text-sm">
            <div><dt className="text-ink-muted">Days</dt><dd className="font-semibold text-ink">{totals.recorded}</dd></div>
            <div><dt className="text-ink-muted">Present</dt><dd className="font-semibold text-ink">{totals.present}</dd></div>
            <div><dt className="text-ink-muted">Late</dt><dd className="font-semibold text-ink">{totals.late}</dd></div>
            <div><dt className="text-ink-muted">Absent</dt><dd className="font-semibold text-ink">{totals.absent}</dd></div>
          </dl>
          {totals.excused > 0 && <p className="mt-2 text-[12px] text-ink-muted">{totals.excused} excused {totals.excused === 1 ? "day is" : "days are"} not counted.</p>}
          <p className="mt-3 flex items-center gap-1 text-[12px] text-ink-muted">
            <Info className="h-3.5 w-3.5" /> {lateCountsAsPresent ? "Late arrivals count as present." : "Late arrivals do not count as present."}
          </p>
        </GlassCard>

        <Card className="lg:col-span-2">
          <CardHeader title="Month by month" description={`Dashed line marks the ${threshold}% requirement`} />
          <div className="h-64 px-3 pb-4">
            {monthly.length === 0 ? (
              <EmptyState title="No monthly records yet" className="py-12" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                  <Tooltip content={<ChartTooltip format={(v) => `${Number(v).toFixed(1)}%`} />} cursor={barCursor} />
                  <ReferenceLine y={threshold} stroke={CHART.highlight} strokeDasharray="4 4" />
                  <Bar dataKey="percentage" name="Attendance" {...barProps("single")} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <AttendanceCalendar records={records} opts={opts} />
    </div>
  );
}

const STATUS_LABEL: Record<AttendanceRecord["status"], string> = { present: "P", absent: "Absent", late: "Late", excused: "Excused" };

function AttendanceCalendar({ records, opts }: { records: AttendanceRecord[]; opts: { lateCountsAsPresent: boolean } }) {
  const byDate = useMemo(() => Object.fromEntries(records.map((r) => [r.date, r.status])) as Record<string, AttendanceRecord["status"]>, [records]);
  // Open on the month of the LATEST record (records may arrive in any order); no records → this month.
  const latest = latestRecordDate(records) ?? todayISO();
  const [cursor, setCursor] = useState(() => new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1, 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => toISODate(new Date(year, month, i + 1)))];
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthRecords = records.filter((r) => r.date.startsWith(monthKey));
  const monthSummary = summarizeAttendance(monthRecords, opts);

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
                  st === "present" ? "bg-teal-soft text-lagoon" : st === "absent" ? "bg-blush/70 font-semibold text-plum" : st === "late" ? "bg-lavender/35 text-plum" : st === "excused" ? "bg-sapphire/10 text-sapphire" : "text-ink-muted/60",
                  c === todayISO() && "ring-2 ring-sapphire",
                )}
              >
                <span>{Number(c.slice(8))}</span>
                {st && <span className="hidden text-[10px] font-semibold uppercase sm:block">{STATUS_LABEL[st]}</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-teal-soft" /> Present</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-lavender/35" /> Late</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-blush/70" /> Absent</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sapphire/10" /> Excused</span>
        </div>
        <p className="mt-2 text-[12px] text-ink-muted" data-testid="month-attendance">This month: {formatPercent(monthSummary.percentage)}</p>
      </div>
    </Card>
  );
}
