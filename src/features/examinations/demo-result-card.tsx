"use client";
/** Demo-dataset result card (internal demo screens only). */
import type { ExamResult } from "@/lib/services/derive";
import { Card, ProgressBar, StatusBadge } from "@/components/ui";
import { GradeChip, ResultSummary } from "./result-card";

export function ResultCard({ result, rank, classSize }: { result: ExamResult; rank?: number | null; classSize?: number }) {
  return (
    <Card className="spatial overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-ambient-lg">
      <ResultSummary
        term={result.term}
        examName={result.examName}
        percentage={result.percentage}
        grade={result.grade}
        rank={rank ? `Rank ${rank}${classSize ? ` of ${classSize}` : ""}` : null}
        failed={result.rows.some((r) => r.passed === false)}
        badges={!result.published && <StatusBadge status="marks_entry" label="Not published" />}
      />
      <table className="w-full text-sm">
        <caption className="sr-only">{result.examName} subject results</caption>
        <thead>
          <tr className="text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
            <th scope="col" className="px-5 py-2.5 font-semibold">Subject</th>
            <th scope="col" className="px-2 py-2.5 text-right font-semibold">Marks</th>
            <th scope="col" className="hidden px-2 py-2.5 font-semibold sm:table-cell"><span className="sr-only">Score bar</span></th>
            <th scope="col" className="px-5 py-2.5 text-right font-semibold">Grade</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.subjectId} className="border-t border-line/50 transition-colors hover:bg-teal-soft/20">
              <td className="px-5 py-2.5 font-medium text-ink">{r.subject}</td>
              <td className="figures px-2 py-2.5 text-right text-ink-soft">
                {r.absent ? <span className="text-plum">Absent</span> : r.marks === null ? <span className="text-ink-muted">Pending</span> : <><span className="font-semibold text-ink">{r.marks}</span>/{r.maxMarks}</>}
              </td>
              <td className="hidden w-32 px-2 py-2.5 sm:table-cell">{r.percentage !== null && <ProgressBar value={r.percentage} tone={r.passed === false ? "plum" : "teal"} label={`${r.subject} score`} />}</td>
              <td className="px-5 py-2.5 text-right">{r.grade ? <GradeChip grade={r.grade} passed={r.passed !== false} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-alabaster/60">
            <td className="px-5 py-3 font-semibold text-ink">Total</td>
            <td className="figures px-2 py-3 text-right font-semibold text-ink">{result.total}/{result.max}</td>
            <td className="hidden sm:table-cell" />
            <td className="px-5 py-3 text-right text-[12.5px] text-ink-muted">{rank ? "" : result.remark ?? ""}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}
