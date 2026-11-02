"use client";
/**
 * Reports → Examination and academic performance (Examinations; contributed to the Core reports page).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { requireDemo } from "@/lib/demo/runtime";
import { useQuery } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSession } from "@/features/auth/session-provider";
import { Avatar, Badge, Card, CardHeader, DataTable, EmptyState, QueryView, Select, StatusBadge } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
import { formatPercent } from "@/lib/utils/format";

const pctTick = (v: number) => `${v}%`;

export function ExamReport() {
  const { dataSource } = useSession();
  if (dataSource === "live") return <LiveExamReport />;
  return <DemoExamReport />;
}

/** Live: published examinations only, from the result snapshots written at publication. */

/** Live: published examinations only, from the result snapshots written at publication. */
function LiveExamReport() {
  const exams = useSchoolQuery(api.exams.list, {});
  const published = useMemo(() => (exams ?? []).filter((e) => e.status === "published"), [exams]);
  const [examId, setExamId] = useState<string>("");
  const selected = examId || published[0]?.examId || "";
  const perf = useSchoolQuery(api.examReports.examPerformance, selected ? { examId: selected as Id<"exams"> } : "skip");
  if (exams === undefined || (selected && perf === undefined)) return <Card className="p-6"><p className="text-sm text-ink-muted">Loading examination results…</p></Card>;
  if (!selected || !perf) return <Card><EmptyState title="No published examination results yet" description="Results appear here once an examination's results are published." /></Card>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Examination" value={selected} onChange={(e) => setExamId(e.target.value)} className="w-64">{published.map((e) => <option key={e.examId} value={e.examId}>{e.name}</option>)}</Select>
        <p className="text-sm text-ink-muted">{perf.students} students · average <span className="font-semibold text-ink">{perf.averagePercentage === null ? "—" : formatPercent(perf.averagePercentage, 1)}</span> · pass rate <span className="font-semibold text-ink">{perf.passRate === null ? "—" : formatPercent(perf.passRate, 1)}</span></p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Average by section" description="Percentage of total marks">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perf.sections.map((x) => ({ name: x.section, average: x.averagePercentage ?? 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis domain={[0, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
              <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
              <Bar dataKey="average" name="Average" {...barProps("single")} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card>
          <CardHeader title="Subjects" description="Average and pass rate per subject" />
          <div className="p-5">
            <DataTable rows={perf.subjects} getRowId={(x) => x.subjectId} empty={<EmptyState title="No subject results" />}
              columns={[
                { key: "s", header: "Subject", primary: true, cell: (x) => x.subject },
                { key: "a", header: "Average", align: "right", cell: (x) => (x.averagePercentage === null ? "—" : formatPercent(x.averagePercentage, 1)) },
                { key: "p", header: "Pass rate", align: "right", cell: (x) => (x.passRate === null ? "—" : formatPercent(x.passRate, 1)) },
                { key: "n", header: "Students", align: "right", cell: (x) => x.students },
              ]} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function DemoExamReport() {
  const [examId, setExamId] = useState<string | undefined>(undefined);
  const q = useQuery(() => requireDemo().data("reports.examPerformance", examId) as Promise<any>, [examId]); // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <QueryView query={q}>
      {(d) => !d.exam ? <Card><EmptyState title="No examination data yet" /></Card> : (
        <div className="space-y-5">
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Select aria-label="Examination" value={d.exam.id} onChange={(e) => setExamId(e.target.value)} className="w-64">{d.exams.map((e: { id: string; name: string }) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
              <StatusBadge status={d.exam.status} />
            </div>
            <p className="text-sm text-ink-muted">Pass rate <span className="font-semibold text-ink">{formatPercent(d.passRate, 1)}</span>{d.exam.status !== "published" && " · includes unpublished marks"}</p>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Average by class" description="Class average vs highest score">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.byClass} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis domain={[0, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="average" name="Average" {...barProps("primary")} maxBarSize={28} />
                  <Bar dataKey="highest" name="Highest" {...barProps("secondary")} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Grade distribution" description="Students by overall grade">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.gradeDistribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="grade" {...axisProps} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Bar dataKey="students" name="Students" {...barProps("single")} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Subject averages" description="All classes combined">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bySubject} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} {...axisProps} tickFormatter={pctTick} />
                  <YAxis type="category" dataKey="subject" {...axisProps} width={118} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                  <Bar dataKey="average" name="Average" {...barProps("secondary", { horizontal: true })} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <Card>
              <CardHeader title="Top performers" description={d.exam.name} />
              <ol className="space-y-2.5 p-5">
                {d.toppers.map((t: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <li key={t.id} className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-sapphire text-[12px] font-semibold text-white">{i + 1}</span>
                    <Avatar name={t.name} size="sm" />
                    <Link href={`/admin/students/${t.id}`} className="min-w-0 flex-1 hover:text-lagoon"><p className="truncate text-sm font-semibold text-ink">{t.name}</p><p className="text-[12px] text-ink-muted">Class {t.classLabel}</p></Link>
                    <Badge tone="lavender">{t.grade}</Badge>
                    <span className="w-14 text-right text-sm font-semibold text-sapphire">{formatPercent(t.percentage, 1)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      )}
    </QueryView>
  );
}

export function AcademicReport() {
  const { dataSource } = useSession();
  if (dataSource === "live") {
    return <Card><EmptyState title="Academic trend not available yet" description="The exam-over-exam subject trend is not calculated for live school data yet. Use Examination performance for published results." /></Card>;
  }
  return <DemoAcademicReport />;
}

function DemoAcademicReport() {
  const q = useQuery(() => requireDemo().data("reports.academicTrend") as Promise<any>, []); // eslint-disable-line @typescript-eslint/no-explicit-any
  const subjects = ["Mathematics", "Science", "English", "Computer Science", "Social Science", "Hindi"];
  return (
    <QueryView query={q}>
      {(rows) => rows.length < 1 ? <Card><EmptyState title="Not enough exam data" /></Card> : (
        <div className="space-y-5">
          <p className="text-sm text-ink-muted">Subject averages across examinations this year — one small chart per subject so every line stays readable.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {subjects.filter((s) => s in rows[0]).map((s) => {
              const data = rows.map((r: Record<string, unknown>) => ({ exam: String(r.exam).replace(" Examination", ""), value: Number(r[s]) }));
              const last = data[data.length - 1]?.value ?? 0;
              const first = data[0]?.value ?? 0;
              return (
                <ChartCard key={s} title={s} description={data.length > 1 ? `${last >= first ? "+" : ""}${(last - first).toFixed(1)} pts since ${data[0].exam}` : data[0]?.exam} height={170}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="exam" {...axisProps} fontSize={11} />
                      <YAxis domain={[50, 90]} {...axisProps} tickFormatter={pctTick} width={42} />
                      <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} />
                      <Line type="monotone" dataKey="value" name="Average" stroke={CHART.single} strokeWidth={2} dot={{ r: 4, fill: CHART.single, stroke: "#fff", strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              );
            })}
          </div>
        </div>
      )}
    </QueryView>
  );
}
