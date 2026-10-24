"use client";
/**
 * Presentational pieces for REAL (Convex) student records — results, fees,
 * homework, timetable and notices. Shared by the live student portal and the
 * staff student profile. They render exactly what the server returned (see
 * convex/model/studentRecords.ts) and say so plainly when there is nothing.
 * Amounts arrive in minor units (paise).
 */
import { useState } from "react";
import { FileText, Megaphone } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Badge, Button, Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { ReportCardModal } from "@/features/examinations/report-card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { dueLabel, formatDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { TimetableGrid, daysWithLessons } from "@/features/timetable/timetable-grid";

type Ok<T> = Extract<T, { state: "ok" }>;
export type LiveResult = Ok<FunctionReturnType<typeof api.studentPortal.myResults>>["results"][number];
export type LiveFees = Omit<Ok<FunctionReturnType<typeof api.studentPortal.myFees>>, "state">;
export type LiveHomework = Ok<FunctionReturnType<typeof api.studentPortal.myHomework>>["homework"][number];
export type LiveTimetable = Omit<Ok<FunctionReturnType<typeof api.studentPortal.myTimetable>>, "state" | "section">;
export type LiveNotice = Ok<FunctionReturnType<typeof api.studentPortal.myNotices>>["notices"][number];

const rupees = (minor: number) => formatCurrency(minor / 100);
const METHOD: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", cheque: "Cheque", online: "Online" };

// ------------------------------------------------------------------ results
type ReportHeader = { school: string; student: { name: string; admissionNo: string } };

export function LiveResultCard({ r, header }: { r: LiveResult; header?: ReportHeader }) {
  const [card, setCard] = useState(false);
  return (
    <Card className="overflow-hidden" data-testid="live-result">
      <div className="flex items-start justify-between gap-3 border-b border-line/60 bg-gradient-to-r from-alabaster to-white px-5 py-4">
        <div>
          {r.term && <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{r.term}</p>}
          <h3 className="text-base font-semibold text-sapphire">{r.examName}</h3>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-sapphire">{formatPercent(r.percentage, 1)}</p>
          {r.grade && <Badge tone="lavender">Grade {r.grade}</Badge>}
        </div>
      </div>
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
            <tr key={s.subjectId} className="border-t border-line/50">
              <td className="px-5 py-2.5 font-medium text-ink">{s.subject}</td>
              <td className="px-2 py-2.5 text-right text-ink-soft">
                {s.isAbsent ? <span className="text-plum">Absent</span> : s.marks === null ? "—" : <><span className="font-semibold text-ink">{s.marks}</span>/{s.maxMarks}</>}
              </td>
              <td className={cn("px-5 py-2.5 text-right font-semibold", s.passed ? "text-sapphire" : "text-plum")}>{s.grade ?? "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-alabaster/60">
            <td className="px-5 py-3 font-semibold text-ink">Total</td>
            <td className="px-2 py-3 text-right font-semibold text-ink">{r.totalMarks}/{r.maxMarks}</td>
            <td className="px-5 py-3 text-right text-[12.5px] text-ink-muted">{r.rank ? `Rank ${r.rank} of ${r.sectionSize}` : ""}</td>
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

// ------------------------------------------------------------------ fees
export function LiveFeesPanel({ fees, today = todayISO() }: { fees: LiveFees; today?: string }) {
  const overdue = fees.obligations.some((o) => o.outstandingMinor > 0 && o.dueDate < today);
  return (
    <div className="space-y-4" data-testid="live-fees">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Amount label="Total fees" value={rupees(fees.totals.grossMinor)} />
        <Amount label="Concession" value={rupees(fees.totals.concessionMinor)} />
        <Amount label="Paid" value={rupees(fees.totals.paidMinor)} />
        <Amount label="Outstanding" value={rupees(fees.totals.outstandingMinor)} warn={overdue} />
      </div>
      <Card>
        <CardHeader title="Installments" description={fees.academicYear} />
        {fees.obligations.length === 0 ? (
          <EmptyState title="No fees assigned" description="The school office has not assigned a fee structure to this student for the current year." />
        ) : (
          <div className="overflow-x-auto p-5">
            <table className="w-full text-sm">
              <caption className="sr-only">Fee installments</caption>
              <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-ink-muted"><th className="py-2">Installment</th><th className="py-2 text-right">Amount</th><th className="py-2 text-right">Concession</th><th className="py-2 text-right">Paid</th><th className="py-2 text-right">Balance</th></tr></thead>
              <tbody>
                {fees.obligations.map((o) => (
                  <tr key={o.obligationId} className="border-t border-line/50">
                    <td className="py-2.5"><p className="font-semibold text-ink">{o.label}</p><p className="text-[12px] text-ink-muted">{o.outstandingMinor > 0 ? dueLabel(o.dueDate, today) : `Due ${formatDate(o.dueDate)}`}</p></td>
                    <td className="py-2.5 text-right">{rupees(o.amountMinor)}</td>
                    <td className="py-2.5 text-right">{o.concessionMinor ? `− ${rupees(o.concessionMinor)}` : "—"}</td>
                    <td className="py-2.5 text-right">{rupees(o.paidMinor)}</td>
                    <td className="py-2.5 text-right">{o.outstandingMinor > 0 ? <span className="font-semibold text-ink">{rupees(o.outstandingMinor)}</span> : <StatusBadge status="paid" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Payment history" />
        {fees.payments.length === 0 ? <EmptyState title="No payments recorded" /> : (
          <ul className="divide-y divide-line/60">
            {fees.payments.map((p) => (
              <li key={p.paymentId} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span><span className="font-mono font-semibold text-ink">{p.receiptNo ?? "—"}</span><span className="ml-2 text-ink-muted">{formatDate(p.paidOn)} · {METHOD[p.method] ?? p.method}</span></span>
                <span className="font-semibold text-ink">{rupees(p.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Amount({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="solid-card p-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", warn ? "text-plum" : "text-sapphire")}>{value}</p>
    </div>
  );
}

// ------------------------------------------------------------------ homework
export function homeworkState(h: LiveHomework, today = todayISO()): "pending" | "overdue" | "submitted" | "late" | "reviewed" {
  if (h.submission) return h.submission.status;
  return h.dueDate < today ? "overdue" : "pending";
}

export function LiveHomeworkList({ homework, today = todayISO() }: { homework: LiveHomework[]; today?: string }) {
  if (homework.length === 0) return <Card><EmptyState title="No homework set" description="Homework set for this class appears here." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line/60" data-testid="live-homework">
        {homework.map((h) => {
          const st = homeworkState(h, today);
          return (
            <li key={h.homeworkId} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{h.title}</p>
                <p className="text-[12.5px] text-ink-muted">{h.subject}{h.teacher ? ` · ${h.teacher}` : ""} · set {formatDate(h.assignedOn)} · {st === "pending" || st === "overdue" ? dueLabel(h.dueDate, today) : `due ${formatDate(h.dueDate)}`}</p>
                {h.description && <p className="mt-1 text-[13px] text-ink-soft">{h.description}</p>}
                {h.submission?.feedback && <p className="mt-1 text-[12.5px] text-lagoon">Feedback: {h.submission.feedback}</p>}
              </div>
              <StatusBadge status={st} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ timetable
export function LiveTimetableGrid({ timetable }: { timetable: LiveTimetable }) {
  const periods = [...timetable.periods].sort((a, b) => a.index - b.index);
  if (timetable.lessons.length === 0) return <Card><EmptyState title="No timetable yet" description="The school has not published a timetable for this class." /></Card>;
  return (
    <Card className="p-4 sm:p-5" data-testid="live-timetable">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Weekly timetable</p>
      <TimetableGrid
        days={daysWithLessons(timetable.lessons.map((l) => l.dayOfWeek))}
        periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
        lessonAt={(d, gp) => {
          const l = timetable.lessons.find((x) => x.dayOfWeek === d && x.periodId === gp.key);
          return l ? { subject: l.subject, detail: [l.room, l.teacher].filter(Boolean).join(" · ") } : undefined;
        }}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ notices
export function LiveNoticesList({ notices }: { notices: LiveNotice[] }) {
  if (notices.length === 0) return <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No notices" description="Notices from your school appear here." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line/60" data-testid="live-notices">
        {notices.map((n) => (
          <li key={n.noticeId} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink">{n.title}</p>
              {n.priority !== "normal" && <Badge tone="plum">{n.priority === "urgent" ? "Urgent" : "Important"}</Badge>}
              {n.type !== "notice" && <Badge tone="lavender">{n.type === "event" ? "Event" : "Holiday"}</Badge>}
            </div>
            <p className="mt-1 whitespace-pre-line text-[13px] text-ink-soft">{n.body}</p>
            <p className="mt-1 text-[11.5px] text-ink-muted">Published {formatDate(n.publishDate)}{n.eventDate ? ` · on ${formatDate(n.eventDate)}` : ""}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
