"use client";
/**
 * Pass out: a graduating section's clearance (final result + fee balance) and
 * the move of the cohort to Alumni. Marks, attendance and fee ledgers are not
 * touched — only the enrollment ends ("completed") and the status changes, so
 * the section's roster frees up for the next cohort.
 */
import { useEffect, useState } from "react";
import { Download, FileBadge2, GraduationCap, Printer } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AlertPill, Avatar, Badge, BadgeChip, Button, Card, CardHeader, Checkbox, EmptyState, FormField, GlassCard, Input, LoadingState, Modal, ProgressBar, ProgressRing, useToast,
} from "@/components/ui";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { downloadCsv } from "@/lib/utils/csv";
import { formatDate, formatLongDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { ResultPill, YearSectionPicker, rupees, type PassResult } from "./shared";

type Graduate = { name: string; admissionNo: string; scholarNo: string | null; dateOfBirth: string | null; result: PassResult };

export function PassOutTab() {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useState<Id<"sections"> | "">("");
  const data = useSchoolQuery(api.studentLifecycle.passOutPlan, sectionId ? { sectionId } : "skip");
  const passOut = useSchoolMutation(api.studentLifecycle.passOut);
  const [date, setDate] = useState(todayISO());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graduated, setGraduated] = useState<{ section: string; year: string; date: string; school: string; students: Graduate[] } | null>(null);
  const [printing, setPrinting] = useState(false);

  // Cleared students are selected by default when a section loads.
  const key = data ? `${data.section.sectionId}:${data.rows.length}` : "";
  useEffect(() => { if (data) setPicked(new Set(data.rows.filter((r) => r.cleared && r.status === "active").map((r) => r.studentId))); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows ?? [];
  const selectable = rows.filter((r) => r.status === "active");
  const cleared = rows.filter((r) => r.cleared).length;
  const pct = rows.length ? (cleared / rows.length) * 100 : 0;
  const pickedRows = rows.filter((r) => picked.has(r.studentId));
  const pickedBlocked = pickedRows.filter((r) => !r.cleared);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`no-dues-${data.section.label}-${data.section.year}`, ["Roll no", "Name", "Admission no", "Scholar no", "Result", "Percentage", "Fee balance (INR)", "Fee clearance", "Overall"],
      rows.map((r) => [r.rollNo, r.name, r.admissionNo, r.scholarNo, r.result, r.percentage?.toFixed(1) ?? "", r.outstandingMinor === null ? "" : (r.outstandingMinor / 100).toFixed(2), r.outstandingMinor === null ? "Not checked (Fees not installed)" : r.outstandingMinor === 0 ? "Zero balance" : "Pending dues", r.cleared ? "Cleared" : "Not cleared"]));
  };

  const run = async () => {
    if (!sectionId || !data) return;
    setBusy(true);
    setError(null);
    const students = pickedRows.map((r) => ({ name: r.name, admissionNo: r.admissionNo, scholarNo: r.scholarNo, dateOfBirth: r.dateOfBirth, result: r.result }));
    try {
      const r = await passOut({ sectionId, studentIds: pickedRows.map((x) => x.studentId), date });
      toast({ title: "Cohort graduated", description: `${r.passedOut} student(s) are now alumni. Their marks, attendance and fee records are unchanged.` });
      setGraduated({ section: data.section.label, year: data.section.year, date, school: data.school.name, students });
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <GlassCard className="spatial">
        <CardHeader title="Graduating cohort" description="Choose the final-year section. Clearance = result declared as passed and a zero fee balance for the year." icon={<GraduationCap className="h-4 w-4" />} />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <YearSectionPicker label="Cohort" value={sectionId} onChange={setSectionId} placeholder="Graduating section" />
          <FormField label="Pass-out date" hint={data ? `${data.section.year}: ${formatDate(data.section.yearStart)} – ${formatDate(data.section.yearEnd)}` : undefined}>
            <Input type="date" value={date} min={data?.section.yearStart} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </div>
      </GlassCard>

      {graduated && (
        <AlertPill tone="teal" icon={<FileBadge2 className="h-4 w-4" aria-hidden />} className="rounded-2xl">
          <span className="flex flex-wrap items-center gap-3">
            <span><strong className="figures text-ink">{graduated.students.length}</strong> student(s) of {graduated.section} graduated on {formatDate(graduated.date)}.</span>
            <Button size="sm" variant="outline" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" /> Provisional certificates</Button>
          </span>
        </AlertPill>
      )}

      {sectionId && data === undefined && <Card><LoadingState variant="inline" label="Loading the cohort" /></Card>}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <GlassCard className="spatial flex items-center gap-5 p-5">
              <ProgressRing value={pct} size={92} sublabel="cleared" />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Candidates</dt><dd className="figures text-xl font-bold text-sapphire">{rows.length}</dd></div>
                <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Cleared</dt><dd className="figures text-xl font-bold text-lagoon">{cleared}</dd></div>
                <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Dues pending</dt><dd className="figures text-xl font-bold text-plum">{rows.filter((r) => (r.outstandingMinor ?? 0) > 0).length}</dd></div>
                <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Result pending</dt><dd className="figures text-xl font-bold text-ink">{rows.filter((r) => r.result === "withheld").length}</dd></div>
              </dl>
            </GlassCard>
            <GlassCard className="spatial flex flex-col justify-center gap-3 p-5">
              <p className="text-sm font-semibold text-ink">{data.section.label} · {data.section.year} <span className="font-normal text-ink-muted">— clearance progress</span></p>
              <ProgressBar value={pct} label="Clearance progress" className="h-2.5" />
              <p className="figures text-[12.5px] text-ink-muted">{cleared} of {rows.length} cleared ({Math.round(pct)}%). Library, lab and ID-card returns aren&apos;t tracked in the system yet — check them on paper before graduating.</p>
            </GlassCard>
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              title="No-dues & clearance"
              description="Students with pending dues or results can still be graduated after review."
              action={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> Export no-dues report (CSV)</Button>}
            />
            {rows.length === 0 ? <EmptyState title="No students currently enrolled in this section" className="py-8" /> : (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">Clearance of {data.section.label}</caption>
                  <thead>
                    <tr className="border-b border-line/60 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                      <th scope="col" className="w-10 px-4 py-2.5"><Checkbox label={<span className="sr-only">Select all</span>} checked={selectable.length > 0 && selectable.every((r) => picked.has(r.studentId))} onChange={(e) => setPicked(new Set(e.target.checked ? selectable.map((r) => r.studentId) : []))} /></th>
                      <th scope="col" className="px-2 py-2.5 font-semibold">Student</th>
                      <th scope="col" className="px-2 py-2.5 font-semibold">Final result</th>
                      <th scope="col" className="px-2 py-2.5 font-semibold">Fee clearance</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Overall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.studentId} className="border-b border-line/40 transition-colors hover:bg-teal-soft/20">
                        <td className="px-4 py-2.5"><Checkbox label={<span className="sr-only">Select {r.name}</span>} disabled={r.status !== "active"} checked={picked.has(r.studentId)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.studentId); else n.delete(r.studentId); return n; })} /></td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={r.name} size="sm" />
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 font-semibold text-ink"><BadgeChip tone="neutral">{r.rollNo ?? "—"}</BadgeChip><span className="truncate">{r.name}</span></p>
                              <p className="mono-id mt-0.5 text-ink-muted">{r.admissionNo}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5"><div className="flex flex-col items-start gap-1"><ResultPill result={r.result} />{r.percentage !== null && <span className="figures text-[12px] text-ink-muted">{r.percentage.toFixed(1)}%{r.grade ? ` · ${r.grade}` : ""}</span>}</div></td>
                        <td className="px-2 py-2.5">{r.outstandingMinor === null ? <Badge tone="neutral" dot>Not checked</Badge> : r.outstandingMinor === 0 ? <Badge tone="teal" dot>Zero balance</Badge> : <Badge tone="plum" dot className="figures">Pending dues · {rupees(r.outstandingMinor)}</Badge>}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold ring-1 ring-inset", r.cleared ? "bg-gradient-to-r from-teal-soft to-cyan/10 text-lagoon ring-teal/25" : "bg-blush/40 text-plum ring-plum/20")}>
                            <span aria-hidden className={cn("h-2 w-2 rounded-full", r.cleared ? "bg-teal shadow-[0_0_6px_rgb(var(--c-teal))]" : "bg-plum")} />
                            {r.cleared ? "Cleared" : "Not cleared"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {error && <p role="alert" className="px-5 py-3 text-[13px] text-plum">{error}</p>}
            <div className="flex flex-col gap-2 border-t border-line/60 bg-white/50 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="figures text-[13px] text-ink-muted">{picked.size} selected{pickedBlocked.length ? ` · ${pickedBlocked.length} not cleared` : ""}</p>
              <Button disabled={!picked.size || !date} onClick={() => setConfirming(true)}><GraduationCap className="h-4 w-4" /> Graduate cohort to alumni</Button>
            </div>
          </Card>
        </>
      )}

      <Modal open={confirming} onOpenChange={(o) => { if (!busy) setConfirming(o); }} title={`Graduate ${picked.size} student(s) of ${data?.section.label ?? ""}?`} size="md"
        footer={<><Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button><Button loading={busy} onClick={run}>Graduate to alumni</Button></>}>
        <div className="space-y-3 text-sm text-ink-soft">
          <p>Their enrollment in {data?.section.label} ends on {date ? formatLongDate(date) : "—"} and their status becomes <strong>Alumni</strong>. Marks, attendance and fee ledgers are kept exactly as they are, and the section&apos;s roster frees up. Sign-in accounts are not changed.</p>
          {pickedBlocked.length > 0 && <p role="note" className="rounded-xl bg-blush/40 px-3 py-2 text-plum">{pickedBlocked.length} selected student(s) are not cleared (pending dues or result). Graduating them leaves those balances on record.</p>}
        </div>
      </Modal>

      {graduated && <CertificatesModal open={printing} onClose={() => setPrinting(false)} batch={graduated} />}
    </div>
  );
}

/** Provisional school-leaving (completion) and character certificates for a graduated batch, printable as one PDF. */
function CertificatesModal({ open, onClose, batch }: { open: boolean; onClose: () => void; batch: { section: string; year: string; date: string; school: string; students: Graduate[] } }) {
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="Provisional certificates" description={`${batch.students.length} student(s) · completion and character certificates`} size="xl"
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / save as PDF</Button></>}>
      <style>{`@media print { body * { visibility: hidden !important; } #cert-batch, #cert-batch * { visibility: visible !important; } #cert-batch { position: absolute; inset: 0; } .cert-page { break-after: page; box-shadow: none !important; } }`}</style>
      <div id="cert-batch" className="space-y-4">
        {batch.students.map((s) => (
          <article key={s.admissionNo} className="cert-page rounded-2xl border border-line bg-white p-8 text-ink shadow-sm">
            <p className="text-center font-display text-xl font-semibold text-sapphire">{batch.school}</p>
            <p className="mt-1 text-center text-[12px] font-semibold uppercase tracking-[0.18em] text-ink-muted">Provisional completion &amp; character certificate</p>
            <p className="mt-6 text-sm leading-7">
              This is to certify that <strong>{s.name}</strong> (Admission No. <span className="font-mono">{s.admissionNo}</span>{s.scholarNo ? <>, Scholar No. <span className="font-mono">{s.scholarNo}</span></> : null}){s.dateOfBirth ? <>, born on {formatLongDate(s.dateOfBirth)},</> : null} was a bonafide student of this school and completed Class {batch.section} in the academic year {batch.year}, leaving on {formatLongDate(batch.date)}.
              {s.result === "passed" ? " The student has passed the final examination." : " The final result is to be confirmed by the school."} During the period of study the student&apos;s conduct and character were found to be good.
            </p>
            <p className="mt-3 text-[12px] text-ink-muted">Provisional — the final certificate is issued with the marks statement.</p>
            <div className="mt-12 flex justify-between text-[13px] text-ink-muted"><span>Date: {formatDate(todayISO())}</span><span>Principal&apos;s signature &amp; seal</span></div>
          </article>
        ))}
      </div>
    </Modal>
  );
}
