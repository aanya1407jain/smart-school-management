"use client";
/**
 * Printable per-student report card for ONE published examination. Data comes
 * from published `results` snapshots only (studentPortal.myResults for the
 * student; exams.sectionResults for staff), so unpublished marks can
 * never appear here.
 */
import { Printer } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

export type ReportCardData = {
  schoolName: string;
  studentName: string;
  admissionNo?: string | null;
  classLabel?: string | null;
  academicYear?: string | null;
  examName: string;
  term?: string | null;
  startDate?: string | null;
  subjects: { subjectId: string; subject: string; marks: number | null; isAbsent: boolean; maxMarks: number; grade: string | null; passed: boolean }[];
  totalMarks: number;
  maxMarks: number;
  percentage: number;
  grade: string | null;
  rank: number | null;
  sectionSize?: number | null;
};

export function ReportCard({ d }: { d: ReportCardData }) {
  const passed = d.subjects.every((s) => s.passed);
  return (
    <article id="report-card" className="rounded-2xl border border-line/70 bg-white p-6 text-ink" aria-label={`Report card: ${d.studentName}, ${d.examName}`}>
      <header className="border-b border-line/70 pb-4 text-center">
        <p className="text-lg font-semibold text-sapphire">{d.schoolName}</p>
        <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-plum">Report card</p>
        <p className="mt-2 text-base font-semibold">{d.examName}{d.term ? ` · ${d.term}` : ""}</p>
        {d.startDate && <p className="text-[12px] text-ink-muted">{d.academicYear ? `${d.academicYear} · ` : ""}from {formatDate(d.startDate)}</p>}
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 py-4 text-[13px] sm:grid-cols-4">
        <div><dt className="text-ink-muted">Student</dt><dd className="font-semibold">{d.studentName}</dd></div>
        <div><dt className="text-ink-muted">Admission no.</dt><dd className="font-semibold">{d.admissionNo || "—"}</dd></div>
        <div><dt className="text-ink-muted">Class</dt><dd className="font-semibold">{d.classLabel || "—"}</dd></div>
        <div><dt className="text-ink-muted">Rank</dt><dd className="font-semibold">{d.rank ? `${d.rank}${d.sectionSize ? ` of ${d.sectionSize}` : ""}` : "—"}</dd></div>
      </dl>
      <table className="w-full text-sm">
        <caption className="sr-only">Subject marks</caption>
        <thead>
          <tr className="border-y border-line/70 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
            <th scope="col" className="py-2">Subject</th><th scope="col" className="py-2 text-right">Marks</th><th scope="col" className="py-2 text-right">Max</th><th scope="col" className="py-2 text-right">Grade</th><th scope="col" className="py-2 text-right">Result</th>
          </tr>
        </thead>
        <tbody>
          {d.subjects.map((s) => (
            <tr key={s.subjectId} className="border-b border-line/40">
              <td className="py-2 font-medium">{s.subject}</td>
              <td className="py-2 text-right">{s.isAbsent ? "Absent" : s.marks ?? "—"}</td>
              <td className="py-2 text-right text-ink-muted">{s.maxMarks}</td>
              <td className="py-2 text-right font-semibold">{s.grade ?? "—"}</td>
              <td className="py-2 text-right">{s.passed ? "Pass" : "Not passed"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="pt-3">Total</td><td className="pt-3 text-right">{d.totalMarks}</td><td className="pt-3 text-right text-ink-muted">{d.maxMarks}</td>
            <td className="pt-3 text-right">{d.grade ?? "—"}</td><td className="pt-3 text-right">{d.percentage.toFixed(2)}%</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-4 text-[13px]">Overall: <strong>{passed ? "Passed all subjects" : "Did not pass every subject"}</strong></p>
      <footer className="mt-8 grid grid-cols-2 gap-8 text-[12px] text-ink-muted">
        <p className="border-t border-line/70 pt-1.5">Class teacher</p>
        <p className="border-t border-line/70 pt-1.5 text-right">Principal</p>
      </footer>
    </article>
  );
}

export function ReportCardModal({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: ReportCardData | null }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Report card" size="lg" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></>}>
      {data && <ReportCard d={data} />}
    </Modal>
  );
}
