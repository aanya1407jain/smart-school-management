"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Hourglass } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId } from "@/features/auth/session-provider";
import { Card, CardHeader, EmptyState, PageHeader, QueryView, StatusBadge } from "@/components/ui";
import { ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { formatDate } from "@/lib/utils/dates";
import { ResultCard } from "./demo-result-card";

export function MyResults() {
  const studentId = useActiveStudentId();
  const q = useQuery(() => services.exams.getStudentResults(studentId!), [studentId], { enabled: !!studentId });
  return (
    <div>
      <PageHeader title="My Results" description="Only results published by the school appear here." />
      <QueryView query={q}>
        {(d) => {
          const latest = d.results[0];
          const prev = d.results[1];
          const compare = latest ? latest.rows.map((r) => ({
            subject: r.subject.split(" ")[0],
            [latest.examName]: r.percentage ?? 0,
            ...(prev ? { [prev.examName]: prev.rows.find((x) => x.subjectId === r.subjectId)?.percentage ?? 0 } : {}),
          })) : [];
          return (
            <div className="space-y-5">
              {d.pending.length > 0 && (
                <Card className="p-4">
                  <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {d.pending.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 rounded-xl bg-alabaster px-3 py-2 text-sm">
                        <Hourglass className="h-4 w-4 text-plum" aria-hidden />
                        <span className="font-medium text-ink">{p.name}</span>
                        <span className="text-ink-muted">{p.status === "scheduled" ? `begins ${formatDate(p.startDate)}` : "results not yet published"}</span>
                        <StatusBadge status={p.status === "scheduled" ? "scheduled" : "pending"} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {d.results.length === 0 ? <Card><EmptyState title="No published results yet" description="Your results will appear here once the school publishes them." /></Card> : (
                <>
                  {compare.length > 0 && (
                    <Card>
                      <CardHeader title="Subject performance" description={prev ? `${latest.examName} compared with ${prev.examName}` : latest.examName} />
                      <div className="h-64 px-3 pb-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={compare} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barGap={2}>
                            <CartesianGrid {...gridProps} />
                            <XAxis dataKey="subject" {...axisProps} />
                            <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                            <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                            {prev && <Bar dataKey={prev.examName} {...barProps("secondary")} maxBarSize={26} />}
                            <Bar dataKey={latest.examName} {...barProps("primary")} maxBarSize={26} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                  )}
                  <div className="grid gap-4 lg:grid-cols-2">{d.results.map((r) => <ResultCard key={r.examId} result={r} rank={r.rank} classSize={r.classSize} />)}</div>
                </>
              )}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
