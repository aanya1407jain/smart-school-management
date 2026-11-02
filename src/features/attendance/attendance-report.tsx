"use client";
/**
 * Reports → Attendance (Attendance; contributed to the Core reports page).
 */
import { useMemo } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import { useSession } from "@/features/auth/session-provider";
import { Avatar, Card, CardHeader, DataTable, EmptyState, QueryView } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { CHART } from "@/lib/constants/theme";
import { formatPercent } from "@/lib/utils/format";
import { requireDemo } from "@/lib/demo/runtime";
import { LiveLowAttendance } from "./low-attendance-live";
const pctTick = (v: number) => `${v}%`;

export function AttendanceReport() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  // Live: register totals per month and per section (this academic year, school-local dates).
  // Per-student bands are not computed for live data (shown as such); the below-threshold list is LiveLowAttendance.
  const liveAtt = useSchoolQuery(api.attendanceReports.attendanceReport, live ? {} : "skip");
  const q = useQuery(() => requireDemo().data("reports.attendance") as Promise<any>, [live], { enabled: !live });

  const adaptedLive = useMemo(() => {
    if (!liveAtt) return undefined;
    return {
      monthly: liveAtt.monthly.filter((m) => m.percentage !== null).map((m) => ({
        month: new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }),
        percentage: m.percentage as number, late: m.late, absent: m.absent,
      })),
      bySection: liveAtt.bySection.filter((s) => s.percentage !== null).map((s) => ({ label: s.label, percentage: s.percentage as number })),
      bands: null,
      lowAttendance: null,
      threshold: liveAtt.threshold,
    };
  }, [liveAtt]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, adaptedLive, q],
  );

  return (
    <QueryView query={queryState}>
      {(d) => (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Monthly attendance" description={`School-wide · dashed line = ${d.threshold}% requirement`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis domain={live ? [0, 100] : [80, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} />
                  <ReferenceLine y={d.threshold} stroke={CHART.highlight} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="percentage" name="Attendance" stroke={CHART.single} strokeWidth={2} dot={{ r: 4, fill: CHART.single, stroke: "#fff", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            {d.bands === null ? (
              <Card className="p-6"><EmptyState title="Attendance bands per student" description="Per-student attendance bands are not calculated for live school data yet. Section and monthly figures are complete." /></Card>
            ) : (
            <ChartCard title="Students by attendance band" description="How many students fall in each range">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bands} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="band" {...axisProps} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Bar dataKey="students" name="Students" {...barProps("secondary")} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}
          </div>
          <ChartCard title="Attendance by section" description="Year to date" height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.bySection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval={0} fontSize={11} />
                <YAxis domain={live ? [0, 100] : [80, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
                <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                <Bar dataKey="percentage" name="Attendance" {...barProps("single")} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          {live && <LiveLowAttendance />}
          {d.lowAttendance !== null && <Card>
            <CardHeader title={`Students below ${d.threshold}%`} description="Follow up with these students and their parents" />
            <div className="p-5">
              <DataTable rows={d.lowAttendance as any[]} getRowId={(s: any) => s.id} empty={<EmptyState title="No students below the threshold" />}
                columns={[
                  { key: "n", header: "Student", primary: true, cell: (s: any) => <Link href={`/admin/students/${s.id}`} className="flex items-center gap-2.5 hover:text-lagoon"><Avatar name={s.name} size="sm" /><span className="font-semibold text-ink">{s.name}</span></Link> },
                  { key: "c", header: "Class", cell: (s: any) => s.classLabel },
                  { key: "a", header: "Absent days", cell: (s: any) => s.absent },
                  { key: "p", header: "Attendance", align: "right", cell: (s: any) => <span className="font-semibold text-plum">{formatPercent(s.percentage, 1)}</span> },
                ]} />
            </div>
          </Card>}
        </div>
      )}
    </QueryView>
  );
}
