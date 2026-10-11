import type { ExamResult } from "@/lib/services/derive";
import { Badge, Card, ProgressBar, StatusBadge } from "@/components/ui";
import { formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export function ResultCard({ result, rank, classSize }: { result: ExamResult; rank?: number | null; classSize?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line/60 bg-gradient-to-r from-alabaster to-white px-5 py-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{result.term}</p>
          <h3 className="text-base font-semibold text-sapphire">{result.examName}</h3>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-sapphire">{formatPercent(result.percentage, 1)}</p>
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            {result.grade && <Badge tone="lavender">Grade {result.grade}</Badge>}
            {!result.published && <StatusBadge status="marks_entry" label="Not published" />}
          </div>
        </div>
      </div>
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
            <tr key={r.subjectId} className="border-t border-line/50">
              <td className="px-5 py-2.5 font-medium text-ink">{r.subject}</td>
              <td className="px-2 py-2.5 text-right text-ink-soft">
                {r.absent ? <span className="text-plum">Absent</span> : r.marks === null ? <span className="text-ink-muted">Pending</span> : <><span className="font-semibold text-ink">{r.marks}</span>/{r.maxMarks}</>}
              </td>
              <td className="hidden w-32 px-2 py-2.5 sm:table-cell">{r.percentage !== null && <ProgressBar value={r.percentage} tone={r.passed === false ? "plum" : "teal"} label={`${r.subject} score`} />}</td>
              <td className={cn("px-5 py-2.5 text-right font-semibold", r.passed === false ? "text-plum" : "text-sapphire")}>{r.grade ?? "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-alabaster/60">
            <td className="px-5 py-3 font-semibold text-ink">Total</td>
            <td className="px-2 py-3 text-right font-semibold text-ink">{result.total}/{result.max}</td>
            <td className="hidden sm:table-cell" />
            <td className="px-5 py-3 text-right text-[12.5px] text-ink-muted">{rank ? `Rank ${rank}${classSize ? ` of ${classSize}` : ""}` : result.remark ?? ""}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}
