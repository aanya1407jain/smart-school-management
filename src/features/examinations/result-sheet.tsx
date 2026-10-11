"use client";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Badge, EmptyState, QueryView } from "@/components/ui";
import { formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/** Section result sheet with ranks and subject averages (computed by the service). */
export function ResultSheet({ examId, sectionId }: { examId: string; sectionId: string }) {
  const q = useQuery(() => services.exams.getSectionResults(examId, sectionId), [examId, sectionId]);
  return (
    <QueryView query={q} loading="inline">
      {(d) => d.rows.length === 0 ? <EmptyState title="No students in this section" /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="sapphire">Class average {formatPercent(d.classAverage, 1)}</Badge>
            {d.subjectAverages.map((s) => <Badge key={s.subject} tone="outline">{s.subject}: {formatPercent(s.average)} {s.grade && `· ${s.grade}`}</Badge>)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Result sheet for Class {d.sectionLabel}</caption>
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="py-2.5 pr-3 font-semibold">Rank</th>
                  <th scope="col" className="py-2.5 pr-3 font-semibold">Student</th>
                  {d.rows[0].result.rows.map((r) => <th key={r.subjectId} scope="col" className="px-2 py-2.5 text-right font-semibold">{r.subject.split(" ")[0]}</th>)}
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Total</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">%</th>
                  <th scope="col" className="py-2.5 pl-2 text-right font-semibold">Grade</th>
                </tr>
              </thead>
              <tbody>
                {[...d.rows].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map((row) => (
                  <tr key={row.studentId} className="border-b border-line/50 hover:bg-teal-soft/30">
                    <td className="py-2.5 pr-3">{row.rank ? <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold", row.rank <= 3 ? "bg-sapphire text-white" : "bg-alabaster text-ink-soft")}>{row.rank}</span> : "—"}</td>
                    <td className="py-2.5 pr-3 font-medium text-ink">{row.name}</td>
                    {row.result.rows.map((r) => (
                      <td key={r.subjectId} className={cn("px-2 py-2.5 text-right", r.passed === false ? "font-semibold text-plum" : "text-ink-soft")}>
                        {r.absent ? "AB" : r.marks === null ? <span className="text-ink-muted">—</span> : r.marks}
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-right font-semibold text-ink">{row.result.total}/{row.result.max}</td>
                    <td className="px-2 py-2.5 text-right text-ink-soft">{formatPercent(row.result.percentage, 1)}</td>
                    <td className="py-2.5 pl-2 text-right font-semibold text-plum">{row.result.grade ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-ink-muted">AB = absent · marks shown in plum are below the pass mark · grades follow the CBSE 8-point scale (A1 ≥ 91%, A2 ≥ 81% … E &lt; 33%).</p>
        </div>
      )}
    </QueryView>
  );
}
