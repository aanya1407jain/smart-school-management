"use client";
/**
 * Reports → Student statistics (Students; contributed to the Core reports page).
 */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GraduationCap, Users } from "lucide-react";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import { useSession } from "@/features/auth/session-provider";
import { QueryView, StatCard } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { requireDemo } from "@/lib/demo/runtime";
const pctTick = (v: number) => `${v}%`;

export function StudentStats() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  // Live: enrolled-student statistics computed on the server from the school's records.
  const liveStats = useSchoolQuery(api.studentReports.studentStatistics, live ? {} : "skip");
  const q = useQuery(() => requireDemo().data("reports.studentStatistics"), [live], { enabled: !live });

  const adaptedLive = useMemo(() => {
    if (!liveStats) return undefined;
    return {
      total: liveStats.total,
      status: liveStats.status,
      bySection: liveStats.bySection.map((s) => ({ label: s.label, students: s.students, capacity: s.capacity })),
      parentContacts: liveStats.parentContacts,
      byClass: liveStats.byClass.map((c) => ({ name: c.name, male: c.male, female: c.female, total: c.total })),
    };
  }, [liveStats]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, adaptedLive, q],
  );

  return (
    <QueryView query={queryState}>
      {(d) => (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Enrolled students" value={d.total} icon={<GraduationCap className="h-5 w-5" />} hint={`${d.status?.active ?? d.total} active`} />
            <StatCard label="Sections" value={d.bySection.length} icon={<Users className="h-5 w-5" />} tone="sapphire" hint={`Avg ${(d.total / Math.max(1, d.bySection.length)).toFixed(1)} per section`} />
            <StatCard label="Parent contacts" value={d.parentContacts} icon={<Users className="h-5 w-5" />} tone="purple" hint="Contact records linked to enrolled students" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Students by class" description="Split by gender">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.byClass} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="female" name="Girls" stackId="g" {...barProps("primary", { top: false })} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="male" name="Boys" stackId="g" {...barProps("secondary")} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Section strength" description="Students per section (capacity 40)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bySection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} interval={0} fontSize={11} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Bar dataKey="students" name="Students" {...barProps("single")} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}
    </QueryView>
  );
}
