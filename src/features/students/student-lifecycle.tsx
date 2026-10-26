"use client";
/**
 * Admin → Promotions & TC. Moves students between academic years, passes out
 * final-year students and issues / reprints / cancels transfer certificates.
 * Server: convex/studentLifecycle.ts (permission `students:lifecycle`, Student
 * Management module). Every operation is atomic and audited; history (old
 * enrollments, roll numbers, cancelled TCs) is never deleted.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileText, GraduationCap, Printer, Search } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, Select, Tabs, TabsContent, TabsList, Textarea, useToast,
} from "@/components/ui";
import { isConvexConfigured } from "@/lib/convex/config";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { formatDate, todayISO } from "@/lib/utils/dates";

export function StudentLifecyclePage() {
  const header = (
    <PageHeader
      title="Promotions & transfer certificates"
      description="Promote a section into the next academic year, pass out final-year students, and issue transfer certificates. Nothing is deleted: earlier classes, roll numbers and cancelled certificates stay in each student's history."
    />
  );
  if (!isConvexConfigured) return <div>{header}<Card><EmptyState title="Backend not connected" description="Student lifecycle operations need the Convex backend." /></Card></div>;
  return (
    <div>
      {header}
      <Tabs defaultValue="promote">
        <TabsList items={[{ value: "promote", label: "Promote" }, { value: "passout", label: "Pass out" }, { value: "tc", label: "Transfer certificates" }]} />
        <TabsContent value="promote"><PromotePanel /></TabsContent>
        <TabsContent value="passout"><PassOutPanel /></TabsContent>
        <TabsContent value="tc"><TransferCertificatesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Year + section picker over every academic year (not only the current one). */
function SectionPicker({ label, value, onChange, yearFilter }: { label: string; value: Id<"sections"> | ""; onChange: (id: Id<"sections"> | "") => void; yearFilter?: (y: { startDate: string }) => boolean }) {
  const years = useSchoolQuery(api.academics.listAcademicYears, {});
  const [yearId, setYearId] = useState<Id<"academicYears"> | "">("");
  const visibleYears = (years ?? []).filter((y) => !yearFilter || yearFilter(y));
  useEffect(() => {
    if (!yearId && visibleYears.length) setYearId((visibleYears.find((y) => y.isCurrent) ?? visibleYears[0])._id);
  }, [yearId, visibleYears]);
  const sections = useSchoolQuery(api.academics.listSections, yearId ? { academicYearId: yearId } : "skip");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={`${label}: academic year`}>
        <Select value={yearId} onChange={(e) => { setYearId(e.target.value as Id<"academicYears">); onChange(""); }}>
          {visibleYears.length === 0 && <option value="">No academic years</option>}
          {visibleYears.map((y) => <option key={y._id} value={y._id}>{y.name}{y.isCurrent ? " (current)" : ""}</option>)}
        </Select>
      </FormField>
      <FormField label={`${label}: section`}>
        <Select value={value} onChange={(e) => onChange(e.target.value as Id<"sections"> | "")} disabled={!sections}>
          <option value="">Choose a section</option>
          {(sections ?? []).map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
        </Select>
      </FormField>
    </div>
  );
}

function PromotePanel() {
  const { toast } = useToast();
  const [from, setFrom] = useState<Id<"sections"> | "">("");
  const [to, setTo] = useState<Id<"sections"> | "">("");
  const plan = useSchoolQuery(api.studentLifecycle.promotionPlan, from && to ? { fromSectionId: from, toSectionId: to } : "skip");
  const promote = useSchoolMutation(api.studentLifecycle.promote);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planKey = plan ? `${plan.from.sectionId}:${plan.to.sectionId}:${plan.rows.length}` : "";
  useEffect(() => { if (plan) setPicked(new Set(plan.rows.filter((r) => r.eligible).map((r) => r.studentId))); }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!from || !to) return;
    setBusy(true);
    setError(null);
    try {
      const r = await promote({ fromSectionId: from, toSectionId: to, studentIds: [...picked] as Id<"students">[] });
      toast({ title: r.kind === "repeat" ? "Students moved" : "Students promoted", description: `${r.promoted} student(s) are now in ${plan?.to.label} (${plan?.to.year}).` });
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Promote a section" description="Choose the section students are in now and the section of the NEXT academic year they move to. Choosing the same class repeats the year." icon={<ArrowRight className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        <SectionPicker label="From" value={from} onChange={setFrom} />
        <SectionPicker label="To" value={to} onChange={setTo} />
        {from && to && plan === undefined && <LoadingState variant="inline" />}
        {plan && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="sapphire">{plan.from.label} · {plan.from.year}</Badge><ArrowRight className="h-4 w-4 text-ink-muted" /><Badge tone="teal">{plan.to.label} · {plan.to.year}</Badge>
              {plan.kind === "repeat" && <Badge tone="plum">Repeating the class</Badge>}
            </div>
            {plan.sectionProblem && <p role="alert" className="rounded-xl bg-blush/40 px-3 py-2 text-[13px] text-plum">{plan.sectionProblem}</p>}
            <StudentChecklist rows={plan.rows.map((r) => ({ ...r, disabledReason: r.eligible ? null : r.reason ?? plan.sectionProblem }))} picked={picked} setPicked={setPicked} />
            {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
            <div className="flex justify-end border-t border-line/70 pt-4">
              <Button disabled={!picked.size || !!plan.sectionProblem} onClick={() => setConfirming(true)}>{plan.kind === "repeat" ? "Move" : "Promote"} {picked.size} student(s)</Button>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirming} onOpenChange={setConfirming} loading={busy} onConfirm={run}
        title={`${plan?.kind === "repeat" ? "Move" : "Promote"} ${picked.size} student(s)?`}
        confirmLabel={plan?.kind === "repeat" ? "Move students" : "Promote students"}
        description={`They leave ${plan?.from.label} (${plan?.from.year}) — that enrollment and its roll number stay in their history — and join ${plan?.to.label} (${plan?.to.year}), where roll numbers are assigned alphabetically. The same student records are kept.`}
      />
    </Card>
  );
}

type CheckRow = { studentId: string; name: string; admissionNo: string; scholarNo: string | null; rollNo: number | null; disabledReason?: string | null };

function StudentChecklist({ rows, picked, setPicked }: { rows: CheckRow[]; picked: Set<string>; setPicked: (s: Set<string>) => void }) {
  const selectable = rows.filter((r) => !r.disabledReason);
  if (!rows.length) return <EmptyState title="No students currently enrolled in this section" className="py-6" />;
  return (
    <div className="rounded-xl border border-line/70">
      <div className="flex items-center justify-between border-b border-line/60 px-4 py-2 text-[13px]">
        <Checkbox label={`Select all (${selectable.length})`} checked={selectable.length > 0 && selectable.every((r) => picked.has(r.studentId))} onChange={(e) => setPicked(new Set(e.target.checked ? selectable.map((r) => r.studentId) : []))} />
        <span className="text-ink-muted">{picked.size} selected</span>
      </div>
      <ul className="max-h-[420px] divide-y divide-line/60 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.studentId} className="flex items-center gap-3 px-4 py-2">
            <span className="w-8 text-center text-sm font-bold text-sapphire">{r.rollNo ?? "—"}</span>
            <Checkbox
              className="flex-1"
              disabled={!!r.disabledReason}
              checked={picked.has(r.studentId)}
              onChange={(e) => { const next = new Set(picked); if (e.target.checked) next.add(r.studentId); else next.delete(r.studentId); setPicked(next); }}
              label={r.name}
              description={`Scholar No: ${r.scholarNo ?? "—"}${r.disabledReason ? ` · ${r.disabledReason}` : ""}`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PassOutPanel() {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useState<Id<"sections"> | "">("");
  const data = useSchoolQuery(api.studentLifecycle.sectionStudents, sectionId ? { sectionId } : "skip");
  const passOut = useSchoolMutation(api.studentLifecycle.passOut);
  const [date, setDate] = useState(todayISO());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPicked(new Set()), [sectionId]);
  const run = async () => {
    if (!sectionId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await passOut({ sectionId, studentIds: [...picked] as Id<"students">[], date });
      toast({ title: "Students passed out", description: `${r.passedOut} student(s) are now alumni.` });
      setPicked(new Set());
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Pass out students" description="For students who finished school: their enrollment is completed on the date below and they become alumni. Their records, results and fee history stay." icon={<GraduationCap className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        <SectionPicker label="Section" value={sectionId} onChange={setSectionId} />
        {data && (
          <>
            <FormField label="Pass-out date" hint={`${data.section.year}: ${formatDate(data.section.yearStart)} – ${formatDate(data.section.yearEnd)}`}><Input type="date" value={date} min={data.section.yearStart} onChange={(e) => setDate(e.target.value)} /></FormField>
            <StudentChecklist rows={data.rows.map((r) => ({ ...r, disabledReason: r.status === "active" ? null : `Status: ${r.status}` }))} picked={picked} setPicked={setPicked} />
            {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
            <div className="flex justify-end border-t border-line/70 pt-4"><Button disabled={!picked.size || !date} onClick={() => setConfirming(true)}>Pass out {picked.size} student(s)</Button></div>
          </>
        )}
      </div>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} loading={busy} onConfirm={run} tone="danger" confirmLabel="Pass out"
        title={`Pass out ${picked.size} student(s) of ${data?.section.label ?? ""}?`}
        description={`Their enrollment ends on ${date ? formatDate(date) : "—"} and their status becomes Alumni. Sign-in accounts are not changed — suspend them in Accounts & Import if needed.`} />
    </Card>
  );
}

function TransferCertificatesPanel() {
  const { toast } = useToast();
  const list = useSchoolQuery(api.studentLifecycle.transferCertificates, {});
  const cancel = useSchoolMutation(api.studentLifecycle.cancelTransferCertificate);
  const [issuing, setIssuing] = useState(false);
  const [printId, setPrintId] = useState<Id<"transferCertificates"> | null>(null);
  const [cancelling, setCancelling] = useState<{ tcId: Id<"transferCertificates">; tcNo: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const doCancel = async () => {
    if (!cancelling || !cancelReason.trim()) return;
    setBusy(true);
    try {
      await cancel({ tcId: cancelling.tcId, reason: cancelReason.trim() });
      toast({ title: "Certificate cancelled", description: `${cancelling.tcNo} is kept as cancelled. Re-enrol the student if they are staying.` });
      setCancelling(null);
      setCancelReason("");
    } catch (e) {
      toast({ tone: "error", title: "Could not cancel", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Transfer certificates" description="Issued certificates, newest first. Reprint any time; a cancelled certificate keeps its number." icon={<FileText className="h-4 w-4" />} action={<Button size="sm" onClick={() => setIssuing(true)}>Issue a TC</Button>} />
      <div className="p-5 pt-3">
        {list === undefined ? <LoadingState variant="inline" /> : list.length === 0 ? <EmptyState title="No transfer certificates yet" className="py-6" /> : (
          <ul className="divide-y divide-line/60">
            {list.map((tc) => (
              <li key={tc.tcId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{tc.snapshot.studentName} <span className="font-mono text-[12px] font-normal text-ink-muted">{tc.tcNo}</span></span>
                  <span className="block text-[12px] text-ink-muted">Left {formatDate(tc.leavingDate)} · {tc.snapshot.lastSection ?? "—"} · issued by {tc.issuedBy}{tc.status === "cancelled" ? ` · cancelled: ${tc.cancelReason ?? ""}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={tc.status === "issued" ? "teal" : "neutral"}>{tc.status === "issued" ? "Issued" : "Cancelled"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setPrintId(tc.tcId)}><Printer className="h-4 w-4" /> Print</Button>
                  {tc.status === "issued" && <Button size="sm" variant="ghost" onClick={() => setCancelling({ tcId: tc.tcId, tcNo: tc.tcNo })}>Cancel</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {issuing && <IssueTcModal onClose={() => setIssuing(false)} onIssued={(id) => { setIssuing(false); setPrintId(id); }} />}
      {printId && <TcPrintModal tcId={printId} onClose={() => setPrintId(null)} />}
      <Modal open={!!cancelling} onOpenChange={(o) => { if (!o) setCancelling(null); }} title={`Cancel ${cancelling?.tcNo ?? ""}?`} size="sm"
        footer={<><Button variant="outline" onClick={() => setCancelling(null)}>Keep</Button><Button variant="danger" loading={busy} disabled={!cancelReason.trim()} onClick={doCancel}>Cancel certificate</Button></>}>
        <p className="mb-3 text-sm text-ink-soft">The certificate stays on record as cancelled and the student&apos;s previous status is restored. Their ended enrollment is not reopened.</p>
        <FormField label="Reason" required><Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={200} placeholder="e.g. Issued by mistake" /></FormField>
      </Modal>
    </Card>
  );
}

function IssueTcModal({ onClose, onIssued }: { onClose: () => void; onIssued: (id: Id<"transferCertificates">) => void }) {
  const { toast } = useToast();
  const issue = useSchoolMutation(api.studentLifecycle.issueTransferCertificate);
  const [scholar, setScholar] = useState("");
  const [lookupKey, setLookupKey] = useState("");
  const found = useSchoolQuery(api.studentLifecycle.findByScholarNo, lookupKey ? { scholarNo: lookupKey } : "skip");
  const [form, setForm] = useState({ leavingDate: todayISO(), reason: "", conduct: "Good", destinationSchool: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const student = found ?? null;
  const canIssue = !!student && student.status !== "transferred" && form.reason.trim() && form.leavingDate;
  const submit = async () => {
    if (!student) return;
    setBusy(true);
    setError(null);
    try {
      const r = await issue({ studentId: student.studentId, leavingDate: form.leavingDate, reason: form.reason, conduct: form.conduct || undefined, destinationSchool: form.destinationSchool || undefined, remarks: form.remarks || undefined });
      toast({ title: "Transfer certificate issued", description: `${r.tcNo} · ${student.name}` });
      onIssued(r.tcId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Issue a transfer certificate" size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!canIssue} onClick={submit}>Issue certificate</Button></>}>
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <FormField label="Find the student by scholar number" className="flex-1"><Input value={scholar} onChange={(e) => setScholar(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setLookupKey(scholar.trim()); }} placeholder="e.g. SR 1042" /></FormField>
          <Button variant="outline" onClick={() => setLookupKey(scholar.trim())}><Search className="h-4 w-4" /> Find</Button>
        </div>
        {lookupKey && found === undefined && <LoadingState variant="inline" />}
        {lookupKey && found === null && <p className="text-[13px] text-plum">No student has scholar number “{lookupKey}”. Add the scholar number on the student&apos;s profile first.</p>}
        {student && (
          <div className="rounded-xl bg-teal-soft/30 px-3 py-2.5 text-sm">
            <span className="font-semibold text-ink">{student.name}</span> · Scholar No: {student.scholarNo} · <Badge tone={student.status === "active" ? "teal" : "neutral"}>{student.status}</Badge>
            {student.status === "transferred" && <span className="block text-[13px] text-plum">This student has already left the school.</span>}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Leaving date" required><Input type="date" value={form.leavingDate} onChange={set("leavingDate")} /></FormField>
          <FormField label="Conduct"><Input value={form.conduct} onChange={set("conduct")} maxLength={60} /></FormField>
          <FormField label="Reason for leaving" required className="sm:col-span-2"><Input value={form.reason} onChange={set("reason")} maxLength={200} placeholder="e.g. Family relocating" /></FormField>
          <FormField label="School joining (if known)" className="sm:col-span-2"><Input value={form.destinationSchool} onChange={set("destinationSchool")} maxLength={120} /></FormField>
          <FormField label="Remarks" className="sm:col-span-2"><Textarea rows={2} value={form.remarks} onChange={set("remarks")} maxLength={300} /></FormField>
        </div>
        <p className="text-[12px] text-ink-muted">Issuing ends the student&apos;s current enrollment (roll numbers in that section are re-assigned) and marks them Transferred. Their records stay; their sign-in account is not changed.</p>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

function TcPrintModal({ tcId, onClose }: { tcId: Id<"transferCertificates">; onClose: () => void }) {
  const tc = useSchoolQuery(api.studentLifecycle.transferCertificate, { tcId });
  const rows = useMemo(() => tc ? ([
    ["Certificate no.", tc.tcNo], ["Name of student", tc.snapshot.studentName], ["Admission no.", tc.snapshot.admissionNo], ["Scholar no.", tc.snapshot.scholarNo ?? "—"],
    ["Date of birth", tc.snapshot.dateOfBirth ? formatDate(tc.snapshot.dateOfBirth) : "—"], ["Parent / guardian", tc.snapshot.parentName ?? "—"],
    ["Date of admission", tc.snapshot.admissionDate ? formatDate(tc.snapshot.admissionDate) : "—"],
    ["Class last attended", [tc.snapshot.lastClass, tc.snapshot.lastSection && `(${tc.snapshot.lastSection})`, tc.snapshot.academicYear].filter(Boolean).join(" ") || "—"],
    ["Date of leaving", formatDate(tc.leavingDate)], ["Reason for leaving", tc.reason], ["Conduct", tc.conduct ?? "—"],
    ["School joining", tc.destinationSchool ?? "—"], ["Remarks", tc.remarks ?? "—"], ["Date of issue", formatDate(tc.issueDate)],
  ] as [string, string][]) : [], [tc]);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Transfer certificate" size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => window.print()} disabled={!tc}><Printer className="h-4 w-4" /> Print</Button></>}>
      <style>{`@media print { body * { visibility: hidden !important; } #tc-print, #tc-print * { visibility: visible !important; } #tc-print { position: fixed; inset: 0; padding: 32px; background: white; } }`}</style>
      {!tc ? <LoadingState variant="inline" /> : (
        <div id="tc-print" className="space-y-4 text-ink">
          <div className="text-center">
            <p className="text-lg font-semibold">{tc.school.name}</p>
            {tc.school.address && <p className="text-[13px] text-ink-muted">{tc.school.address}</p>}
            <p className="mt-2 text-sm font-semibold uppercase tracking-[0.14em]">Transfer certificate</p>
            {tc.status === "cancelled" && <p className="mt-1 text-sm font-bold text-plum">CANCELLED — {tc.cancelReason}</p>}
          </div>
          <table className="w-full text-sm"><tbody className="divide-y divide-line/60">
            {rows.map(([k, v]) => <tr key={k}><td className="w-48 py-1.5 pr-3 text-ink-muted">{k}</td><td className="py-1.5 font-medium">{v}</td></tr>)}
          </tbody></table>
          <div className="flex justify-between pt-10 text-[13px] text-ink-muted"><span>Prepared by: {tc.issuedBy}</span><span>Principal&apos;s signature &amp; seal</span></div>
        </div>
      )}
    </Modal>
  );
}
