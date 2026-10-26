import type { ReactNode } from "react";
import { Award } from "lucide-react";
import type { ExamResult } from "@/lib/services/derive";
import { Badge, Card, ProgressBar, ProgressRing, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/**
 * Accomplishment header shared by the demo and live result cards: score ring,
 * exam name and term, grade and rank badges on a frosted gradient band.
 */
export function ResultSummary({ term, examName, percentage, grade, rank, failed, badges }: { term?: string | null; examName: string; percentage: number | null; grade?: string | null; rank?: string | null; failed?: boolean; badges?: ReactNode }) {
  return (
    <div className="relative flex items-center gap-4 overflow-hidden border-b border-line/60 bg-gradient-to-br from-teal-soft/60 via-white/70 to-blush/25 px-5 py-4">
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-cyan/15 blur-2xl" />
      <ProgressRing value={percentage} size={72} stroke={7} tone={failed ? "plum" : "teal"} />
      <div className="relative min-w-0 flex-1">
        {term && <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{term}</p>}
        <h3 className="truncate text-base font-semibold text-sapphire">{examName}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {grade && <Badge tone="lavender"><Award className="h-3 w-3" aria-hidden />Grade {grade}</Badge>}
          {rank && <Badge tone="sapphire" className="figures">{rank}</Badge>}
          {badges}
        </div>
      </div>
    </div>
  );
}

/** Compact high-contrast grade tag for a subject row. */
export function GradeChip({ grade, passed }: { grade: string; passed: boolean }) {
  return (
    <span className={cn("inline-grid min-w-[2rem] place-items-center rounded-md px-1.5 py-0.5 font-mono text-[12px] font-bold ring-1 ring-inset", passed ? "bg-sapphire/[0.06] text-sapphire ring-sapphire/15" : "bg-blush/50 text-plum ring-plum/20")}>
      {grade}
    </span>
  );
}

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
