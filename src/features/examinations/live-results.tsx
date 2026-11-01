"use client";
/**
 * Published results of a REAL (Convex) student record: the result card, the report card and the list. Used by the student portal (My Results) and by the Examinations section of the staff student profile.
 */
import { useState } from "react";
import { FileText } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Button, Card, EmptyState } from "@/components/ui";
import { ReportCardModal } from "@/features/examinations/report-card";
import { GradeChip, ResultSummary } from "@/features/examinations/result-card";

type Ok<T> = Extract<T, { state: "ok" }>;
export type LiveResult = Ok<FunctionReturnType<typeof api.exams.myResults>>["results"][number];

type ReportHeader = { school: string; student: { name: string; admissionNo: string } };

export function LiveResultCard({ r, header }: { r: LiveResult; header?: ReportHeader }) {
  const [card, setCard] = useState(false);
  return (
    <Card className="spatial overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-ambient-lg" data-testid="live-result">
      <ResultSummary
        term={r.term}
        examName={r.examName}
        percentage={r.percentage}
        grade={r.grade}
        rank={r.rank ? `Rank ${r.rank} of ${r.sectionSize}` : null}
        failed={r.subjects.some((s) => !s.isAbsent && s.marks !== null && !s.passed)}
      />
      <table className="w-full text-sm">
        <caption className="sr-only">{r.examName} subject results</caption>
        <thead>
          <tr className="text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
            <th scope="col" className="px-5 py-2.5 font-semibold">Subject</th>
            <th scope="col" className="px-2 py-2.5 text-right font-semibold">Marks</th>
            <th scope="col" className="px-5 py-2.5 text-right font-semibold">Grade</th>
          </tr>
        </thead>
        <tbody>
          {r.subjects.map((s) => (
            <tr key={s.subjectId} className="border-t border-line/50 transition-colors hover:bg-teal-soft/20">
              <td className="px-5 py-2.5 font-medium text-ink">{s.subject}</td>
              <td className="figures px-2 py-2.5 text-right text-ink-soft">
                {s.isAbsent ? <span className="text-plum">Absent</span> : s.marks === null ? "—" : <><span className="font-semibold text-ink">{s.marks}</span>/{s.maxMarks}</>}
              </td>
              <td className="px-5 py-2.5 text-right">{s.grade ? <GradeChip grade={s.grade} passed={s.passed} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-alabaster/60">
            <td className="px-5 py-3 font-semibold text-ink">Total</td>
            <td className="figures px-2 py-3 text-right font-semibold text-ink">{r.totalMarks}/{r.maxMarks}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {header && (
        <div className="flex justify-end border-t border-line/60 px-5 py-3">
          <Button size="sm" variant="outline" onClick={() => setCard(true)}><FileText className="h-4 w-4" /> Report card</Button>
          <ReportCardModal
            open={card}
            onOpenChange={setCard}
            data={{
              schoolName: header.school, studentName: header.student.name, admissionNo: header.student.admissionNo, classLabel: r.sectionLabel,
              examName: r.examName, term: r.term, startDate: r.startDate, subjects: r.subjects.map((x) => ({ ...x, subjectId: x.subjectId as string })),
              totalMarks: r.totalMarks, maxMarks: r.maxMarks, percentage: r.percentage, grade: r.grade, rank: r.rank, sectionSize: r.sectionSize,
            }}
          />
        </div>
      )}
    </Card>
  );
}

export function LiveResultsList({ results, header }: { results: LiveResult[]; header?: ReportHeader }) {
  if (results.length === 0) return <Card><EmptyState title="No published results yet" description="Results appear here once the school publishes an examination." /></Card>;
  return <div className="grid gap-4 lg:grid-cols-2">{results.map((r) => <LiveResultCard key={r.examId} r={r} header={header} />)}</div>;
}
