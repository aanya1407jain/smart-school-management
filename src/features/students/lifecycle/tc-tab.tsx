"use client";
/**
 * Transfer certificates: issue a new TC (student search with auto-filled
 * particulars, a fee-dues gate with an authorised waiver, drafts, preview)
 * and the register of drafted / issued / cancelled certificates with
 * printing, summaries, voiding and public verification codes.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Ban, Eye, FileText, Printer, Save, Search, ShieldAlert, UserRound } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Avatar, Badge, BadgeChip, Button, Card, CardHeader, Checkbox, EmptyState, FilterPills, FormField, GlassCard, Input, LoadingState, Modal, SearchInput, Select, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { CheckItem, rupees } from "./shared";
import { TcDocument, type TcDocumentData } from "./tc-document";

const REASONS = ["Parent transfer", "Relocating", "Higher education", "Personal", "Other"] as const;
const CONDUCT_CHIPS = ["Exemplary", "Good", "Satisfactory"];

type View = "issue" | "register";

export function TransferCertificatesTab() {
  const [view, setView] = useState<View>("issue");
  const [studentId, setStudentId] = useState<Id<"students"> | null>(null);
  return (
    <div className="space-y-4">
      <FilterPills<View> label="Transfer certificates" value={view} onChange={setView} items={[{ value: "issue", label: "Issue new TC" }, { value: "register", label: "Issued TC register" }]} />
      {view === "issue"
        ? <IssueTc studentId={studentId} onStudent={setStudentId} />
        : <TcRegister onContinueDraft={(id) => { setStudentId(id); setView("issue"); }} />}
    </div>
  );
}

// ================================================================ issue
type Form = { tcNo: string; reasonCategory: string; reasonOther: string; destinationSchool: string; conduct: string; remarks: string; applicationDate: string; leavingDate: string };
const EMPTY_FORM: Form = { tcNo: "", reasonCategory: "", reasonOther: "", destinationSchool: "", conduct: "", remarks: "", applicationDate: todayISO(), leavingDate: todayISO() };

function splitReason(reason: string): Pick<Form, "reasonCategory" | "reasonOther"> {
  const known = REASONS.find((r) => r !== "Other" && r === reason);
  if (known) return { reasonCategory: known, reasonOther: "" };
  return { reasonCategory: reason ? "Other" : "", reasonOther: reason.replace(/^Other:\s*/, "") };
}

function IssueTc({ studentId, onStudent }: { studentId: Id<"students"> | null; onStudent: (id: Id<"students"> | null) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [tcNoEdited, setTcNoEdited] = useState(false);
  const [draftId, setDraftId] = useState<Id<"transferCertificates"> | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [waive, setWaive] = useState(false);
  const [waiverNote, setWaiverNote] = useState("");
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [issuedId, setIssuedId] = useState<Id<"transferCertificates"> | null>(null);

  const profile = useSchoolQuery(api.studentLifecycle.tcStudentProfile, studentId ? { studentId, leavingDate: form.leavingDate } : "skip");
  const school = useSchoolQuery(api.schools.current, {});
  const saveDraft = useSchoolMutation(api.studentLifecycle.saveTransferCertificateDraft);
  const issue = useSchoolMutation(api.studentLifecycle.issueTransferCertificate);

  // A new student: start from their saved draft if there is one, otherwise a fresh form.
  useEffect(() => {
    if (!profile || loadedFor === profile.studentId) return;
    setLoadedFor(profile.studentId);
    setWaive(false);
    setWaiverNote("");
    setError(null);
    const d = profile.draft;
    if (d) {
      setDraftId(d.tcId);
      setTcNoEdited(!!d.tcNo);
      setForm({ ...EMPTY_FORM, ...splitReason(d.reason), tcNo: d.tcNo || profile.nextTcNo, destinationSchool: d.destinationSchool ?? "", conduct: d.conduct ?? "", remarks: d.remarks ?? "", applicationDate: d.applicationDate ?? todayISO(), leavingDate: d.leavingDate });
    } else {
      setDraftId(null);
      setTcNoEdited(false);
      setForm({ ...EMPTY_FORM, tcNo: profile.nextTcNo });
    }
  }, [profile, loadedFor]);
  // Keep the suggested number current until the office edits it.
  useEffect(() => { if (profile && !tcNoEdited) setForm((f) => ({ ...f, tcNo: profile.nextTcNo })); }, [profile?.nextTcNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const reason = form.reasonCategory === "Other" ? (form.reasonOther.trim() ? `Other: ${form.reasonOther.trim()}` : "") : form.reasonCategory;
  const dues = profile?.dues ?? null; // null: Fees is not installed in this build, dues are not checked
  const hasDues = !!dues && dues.outstandingMinor > 0;
  const gateOpen = !hasDues || (waive && waiverNote.trim().length > 0);
  const blocked = !profile || profile.status !== "active" || !!profile.issued;
  const canIssue = !blocked && !!reason && !!form.leavingDate && gateOpen;

  const payload = () => ({
    studentId: studentId!, leavingDate: form.leavingDate, reason, conduct: form.conduct || undefined, destinationSchool: form.destinationSchool || undefined,
    remarks: form.remarks || undefined, applicationDate: form.applicationDate || undefined, tcNo: tcNoEdited && form.tcNo.trim() ? form.tcNo.trim() : undefined,
  });

  const onSaveDraft = async () => {
    if (!studentId || !reason) return setError("Choose a reason for leaving before saving the draft.");
    setBusy("draft");
    setError(null);
    try {
      const r = await saveDraft({ ...payload(), ...(draftId ? { tcId: draftId } : {}) });
      setDraftId(r.tcId);
      toast({ title: "Draft saved", description: "The student is unchanged until the certificate is issued." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onIssue = async () => {
    if (!studentId) return;
    setBusy("issue");
    setError(null);
    try {
      const r = await issue({ ...payload(), ...(draftId ? { draftId } : {}), ...(hasDues ? { waiverNote: waiverNote.trim() } : {}) });
      toast({ title: "Transfer certificate issued", description: `${r.tcNo} · ${profile?.snapshot.studentName}` });
      setIssuedId(r.tcId);
      onStudent(null);
      setLoadedFor(null);
      setForm(EMPTY_FORM);
      setDraftId(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const previewData: TcDocumentData | null = profile ? {
    school: { name: school?.school.name ?? "", address: school?.school.address ?? null }, tcNo: form.tcNo, status: "preview", snapshot: profile.snapshot,
    leavingDate: form.leavingDate, applicationDate: form.applicationDate || null, issueDate: null, reason, conduct: form.conduct || null,
    destinationSchool: form.destinationSchool || null, remarks: form.remarks || null, verificationCode: null,
  } : null;
  const s = profile?.snapshot;

  return (
    <div className="space-y-4">
      <GlassCard className="spatial">
        <CardHeader title="Find the student" description="Search by name, admission number, scholar number or current roll number." icon={<Search className="h-4 w-4" />} />
        <div className="p-5 pt-3"><StudentSearch onPick={(id) => { onStudent(id); setLoadedFor(null); }} /></div>
      </GlassCard>

      {studentId && profile === undefined && <Card><LoadingState variant="inline" label="Loading the student's record" /></Card>}

      {profile && s && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Card className="spatial overflow-hidden">
              <div className="flex items-center gap-4 border-b border-line/60 bg-gradient-to-br from-teal-soft/60 via-white/70 to-blush/25 px-5 py-4">
                <Avatar name={s.studentName} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold text-sapphire">{s.studentName}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-muted">
                    <BadgeChip tone="neutral">{s.admissionNo}</BadgeChip>{s.scholarNo && <BadgeChip>{s.scholarNo}</BadgeChip>}<StatusBadge status={profile.status} />
                  </p>
                </div>
                {draftId && <Badge tone="lavender">Draft loaded</Badge>}
              </div>
              <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Particular label="Father's name" value={s.fatherName} />
                <Particular label="Mother's name" value={s.motherName ?? (s.fatherName ? undefined : s.parentName)} />
                <Particular label="Date of birth" value={s.dateOfBirth && formatDate(s.dateOfBirth)} />
                <Particular label="Date of admission" value={s.admissionDate && formatDate(s.admissionDate)} />
                <Particular label="Class last studied" value={[s.lastClass, s.lastSection && `(${s.lastSection})`].filter(Boolean).join(" ") || undefined} />
                <Particular label="Working days / attended" value={s.workingDays !== undefined ? `${s.workingDays} / ${s.attendedDays ?? 0}` : undefined} mono />
              </dl>
              {(profile.issued || profile.status !== "active") && (
                <p role="alert" className="mx-5 mb-5 rounded-xl bg-blush/40 px-3 py-2 text-[13px] font-medium text-plum">
                  {profile.issued ? `Transfer certificate ${profile.issued} is already issued. Cancel it in the register to issue a new one.` : `This student's status is ${profile.status}; a TC can only be issued to an active student.`}
                </p>
              )}
            </Card>

            <Card>
              <CardHeader title="Certificate details" icon={<FileText className="h-4 w-4" />} />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <FormField label="TC serial number" hint={tcNoEdited ? "Manual number — must not be used by another certificate." : "Next number in the school's series; edit to match a printed TC book."}>
                  <Input value={form.tcNo} onChange={(e) => { setTcNoEdited(e.target.value.trim() !== profile.nextTcNo); setForm((f) => ({ ...f, tcNo: e.target.value })); }} className="font-mono" maxLength={40} />
                </FormField>
                <FormField label="Reason for leaving" required>
                  <Select value={form.reasonCategory} onChange={set("reasonCategory")}>
                    <option value="">Choose a reason</option>
                    {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </FormField>
                {form.reasonCategory === "Other" && <FormField label="Describe the reason" required className="sm:col-span-2"><Input value={form.reasonOther} onChange={set("reasonOther")} maxLength={180} /></FormField>}
                <FormField label="Date of application"><Input type="date" value={form.applicationDate} max={todayISO()} onChange={set("applicationDate")} /></FormField>
                <FormField label="Date of leaving" required><Input type="date" value={form.leavingDate} onChange={set("leavingDate")} /></FormField>
                <FormField label="Date of certificate issue" hint="Set to the day the certificate is issued."><Input value={formatDate(todayISO())} readOnly disabled /></FormField>
                <FormField label="School joining (if known)"><Input value={form.destinationSchool} onChange={set("destinationSchool")} maxLength={120} /></FormField>
                <div className="space-y-1.5 sm:col-span-2">
                  <FormField label="Conduct & character">
                    <Textarea rows={2} value={form.conduct} onChange={set("conduct")} maxLength={300} placeholder="e.g. Exemplary conduct throughout the period of study." />
                  </FormField>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick insert conduct remark">
                    {CONDUCT_CHIPS.map((c) => (
                      <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, conduct: f.conduct.trim() ? `${f.conduct.trim()} ${c}.` : c }))}
                        className="rounded-full bg-white/70 px-3 py-1 text-[12.5px] font-medium text-ink-soft ring-1 ring-inset ring-line/80 transition-all hover:bg-teal-soft hover:text-lagoon hover:ring-teal/30 active:scale-95 focus-visible:outline-none focus-visible:shadow-focus">
                        + {c}
                      </button>
                    ))}
                  </div>
                </div>
                <FormField label="Remarks" className="sm:col-span-2"><Textarea rows={2} value={form.remarks} onChange={set("remarks")} maxLength={300} /></FormField>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <GlassCard className="spatial">
              <CardHeader title="Pre-flight dues gate" description={dues ? `Checked against ${dues.year}.` : "Fees is not installed, so dues are not checked."} icon={<ShieldAlert className="h-4 w-4" />} />
              <ul className="space-y-3 p-5 pt-3">
                {dues ? (
                  <CheckItem ok={!hasDues} detail={hasDues ? `${rupees(dues.outstandingMinor)} outstanding${dues.overdueMinor ? `, ${rupees(dues.overdueMinor)} overdue` : ""}` : "No balance for the year"}>
                    Fee balance {hasDues ? rupees(dues.outstandingMinor) : "₹0"}
                  </CheckItem>
                ) : <li className="text-sm text-ink-soft">Fee balance not checked — confirm dues with the accounts office.</li>}
                <li className="text-[12px] text-ink-muted">Library books and ID-card return aren&apos;t tracked in the system — confirm them with the library and office.</li>
              </ul>
              {hasDues && (
                <div className="mx-5 mb-5 space-y-3 rounded-2xl tint-glass p-3" style={{ ["--tint" as string]: "var(--c-purple)" }}>
                  <p className="text-[13px] font-semibold text-plum">Dues must be cleared before a TC is issued.</p>
                  {profile.canWaive ? (
                    <>
                      <Checkbox label="Allow provisional issue with documented waiver" description="Principal / administrator authority. The balance stays on the ledger and the waiver is recorded on the certificate's audit trail." checked={waive} onChange={(e) => setWaive(e.target.checked)} />
                      {waive && <FormField label="Waiver note" required><Textarea rows={2} value={waiverNote} onChange={(e) => setWaiverNote(e.target.value)} maxLength={300} placeholder="Who approved it and why" /></FormField>}
                    </>
                  ) : <p className="text-[12.5px] text-ink-soft">Only the Principal or an administrator who manages fees can approve a provisional issue.</p>}
                </div>
              )}
            </GlassCard>

            <Card className="p-5">
              {error && <p role="alert" className="mb-3 text-[13px] text-plum">{error}</p>}
              <div className="grid gap-2">
                <Button variant="outline" loading={busy === "draft"} disabled={blocked || !!busy} onClick={onSaveDraft}><Save className="h-4 w-4" /> Save draft</Button>
                <Button variant="outline" disabled={!previewData} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Preview official TC</Button>
                <Button loading={busy === "issue"} disabled={!canIssue || !!busy} onClick={onIssue}><Printer className="h-4 w-4" /> Issue certificate &amp; generate PDF</Button>
              </div>
              <p className="mt-3 text-[12px] text-ink-muted">Issuing ends the current enrollment, marks the student Transferred (they leave the promotion and pass-out lists) and adds a verification code. Records stay; the sign-in account is not changed.</p>
            </Card>
          </div>
        </div>
      )}

      {!studentId && (
        <Card><EmptyState icon={<UserRound className="h-6 w-6" />} title="No student selected" description="Search above to start a certificate, or continue a draft from the register." className="py-10" /></Card>
      )}

      {previewData && (
        <Modal open={preview} onOpenChange={setPreview} title="Preview — transfer certificate" size="lg" footer={<Button variant="outline" onClick={() => setPreview(false)}>Close</Button>}>
          <TcDocument data={previewData} id="tc-preview" />
        </Modal>
      )}
      {issuedId && <TcPrintModal tcId={issuedId} onClose={() => setIssuedId(null)} autoPrint />}
    </div>
  );
}

function Particular({ label, value, mono }: { label: string; value?: string | null | false; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={cn("mt-0.5 font-medium", value ? "text-ink" : "text-ink-muted", mono && "figures")}>{value || "Not recorded"}</dd>
    </div>
  );
}

/** Autocomplete over active students (combobox + listbox, keyboard navigable). */
function StudentSearch({ onPick }: { onPick: (id: Id<"students">) => void }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = "tc-student-results";
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 220); return () => clearTimeout(t); }, [text]);
  const results = useSchoolQuery(api.studentLifecycle.tcCandidates, q ? { search: q } : "skip");
  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  const pick = (id: Id<"students">, label: string) => { onPick(id); setText(label); setOpen(false); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!results?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); const r = results[active]; if (r) pick(r.studentId, r.name); }
    else if (e.key === "Escape") setOpen(false);
  };
  const show = open && q.length > 0;
  return (
    <div ref={wrap} className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <Input
        role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-label="Search students"
        aria-activedescendant={show && results?.[active] ? `${listId}-${active}` : undefined}
        value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder="e.g. Aarav, AA-2026-0012, 0246CBSE0007 or 14" className="pl-10"
      />
      {show && (
        <ul id={listId} role="listbox" className="glass-strong spatial absolute left-0 right-0 top-full z-40 mt-1.5 max-h-80 overflow-auto rounded-xl bg-white/[0.97] p-1.5 animate-scale-in">
          {results === undefined ? <li className="px-3 py-2 text-sm text-ink-muted">Searching…</li> : results.length === 0 ? <li className="px-3 py-2 text-sm text-ink-muted">No active student matches “{q}”.</li> : results.map((r, i) => (
            <li key={r.studentId} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(r.studentId, r.name); }}
              className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", i === active ? "bg-gradient-to-r from-teal-soft to-teal-soft/30 text-lagoon" : "text-ink")}>
              <Avatar name={r.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.name}</span><span className="mono-id text-ink-muted">{r.admissionNo}{r.scholarNo ? ` · ${r.scholarNo}` : ""}</span></span>
              <BadgeChip tone="sapphire">{r.section}{r.rollNo ? ` · ${r.rollNo}` : ""}</BadgeChip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ================================================================ register
type Status = "all" | "draft" | "issued" | "cancelled";

function TcRegister({ onContinueDraft }: { onContinueDraft: (studentId: Id<"students">) => void }) {
  const { toast } = useToast();
  const list = useSchoolQuery(api.studentLifecycle.transferCertificates, {});
  const cancel = useSchoolMutation(api.studentLifecycle.cancelTransferCertificate);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [printId, setPrintId] = useState<Id<"transferCertificates"> | null>(null);
  const [summaryId, setSummaryId] = useState<Id<"transferCertificates"> | null>(null);
  const [voiding, setVoiding] = useState<{ tcId: Id<"transferCertificates">; label: string; draft: boolean } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c = { all: list?.length ?? 0, draft: 0, issued: 0, cancelled: 0 };
    for (const t of list ?? []) c[t.status] += 1;
    return c;
  }, [list]);
  const shown = (list ?? []).filter((t) => (status === "all" || t.status === status) && (!search.trim() || [t.tcNo, t.snapshot.studentName, t.snapshot.admissionNo, t.snapshot.scholarNo ?? ""].some((x) => x.toLowerCase().includes(search.trim().toLowerCase()))));
  const summary = list?.find((t) => t.tcId === summaryId) ?? null;

  const doVoid = async () => {
    if (!voiding || !voidReason.trim()) return;
    setBusy(true);
    try {
      await cancel({ tcId: voiding.tcId, reason: voidReason.trim() });
      toast({ title: voiding.draft ? "Draft voided" : "Certificate cancelled", description: voiding.draft ? undefined : `${voiding.label} stays on record as cancelled. Re-enrol the student if they are staying.` });
      setVoiding(null);
      setVoidReason("");
    } catch (e) {
      toast({ tone: "error", title: "Could not cancel", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Issued TC register" description="Drafts, issued and cancelled certificates, newest first. A cancelled certificate keeps its number." icon={<FileText className="h-4 w-4" />} />
      <div className="flex flex-col gap-3 px-5 pb-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterPills<Status> label="Filter by status" value={status} onChange={setStatus} items={[
          { value: "all", label: "All", count: counts.all }, { value: "draft", label: "Draft", count: counts.draft },
          { value: "issued", label: "Issued", count: counts.issued }, { value: "cancelled", label: "Cancelled", count: counts.cancelled },
        ]} />
        <SearchInput value={search} onChange={setSearch} placeholder="TC number, name or admission no." label="Search the register" className="xl:w-80" />
      </div>
      {list === undefined ? <LoadingState variant="inline" /> : shown.length === 0 ? <EmptyState title={list.length ? "No certificates match" : "No transfer certificates yet"} className="py-8" /> : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Transfer certificate register</caption>
            <thead>
              <tr className="border-y border-line/60 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-semibold">TC number</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">Student</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">Admission no.</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">Class left</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">Issue date</th>
                <th scope="col" className="px-2 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.tcId} className="border-b border-line/40 transition-colors hover:bg-teal-soft/20">
                  <td className="px-5 py-2.5">{t.tcNo ? <BadgeChip tone={t.status === "issued" ? "teal" : "neutral"}>{t.tcNo}</BadgeChip> : <span className="text-ink-muted">—</span>}</td>
                  <td className="px-2 py-2.5 font-semibold text-ink">{t.snapshot.studentName}</td>
                  <td className="mono-id px-2 py-2.5 text-ink-soft">{t.snapshot.admissionNo}</td>
                  <td className="px-2 py-2.5 text-ink-soft">{t.snapshot.lastSection ?? "—"}</td>
                  <td className="figures px-2 py-2.5 text-ink-soft">{t.status === "draft" ? "—" : formatDate(t.issueDate)}</td>
                  <td className="px-2 py-2.5"><TcStatus status={t.status} /></td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-end gap-1">
                      {t.status === "draft" && <Button size="sm" variant="ghost" onClick={() => onContinueDraft(t.studentId)}>Continue</Button>}
                      {t.status !== "draft" && <Button size="sm" variant="ghost" onClick={() => setPrintId(t.tcId)}><Printer className="h-4 w-4" /> PDF</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setSummaryId(t.tcId)}><Eye className="h-4 w-4" /> Summary</Button>
                      {t.status !== "cancelled" && <Button size="sm" variant="ghost" className="text-plum" onClick={() => setVoiding({ tcId: t.tcId, label: t.tcNo || "this draft", draft: t.status === "draft" })}><Ban className="h-4 w-4" /> {t.status === "draft" ? "Void" : "Cancel"}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {printId && <TcPrintModal tcId={printId} onClose={() => setPrintId(null)} />}
      <Modal open={!!summary} onOpenChange={(o) => { if (!o) setSummaryId(null); }} title={summary?.tcNo || "Draft certificate"} description={summary?.snapshot.studentName} size="md" footer={<Button variant="outline" onClick={() => setSummaryId(null)}>Close</Button>}>
        {summary && (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Particular label="Status" value={summary.status[0].toUpperCase() + summary.status.slice(1)} />
            <Particular label="Prepared by" value={summary.issuedBy} />
            <Particular label="Date of leaving" value={formatDate(summary.leavingDate)} />
            <Particular label="Date of application" value={summary.applicationDate && formatDate(summary.applicationDate)} />
            <Particular label="Reason" value={summary.reason} />
            <Particular label="Conduct" value={summary.conduct} />
            <Particular label="Class left" value={summary.snapshot.lastSection} />
            <Particular label="School joining" value={summary.destinationSchool} />
            {summary.verificationCode && <Particular label="Verification code" value={summary.verificationCode} mono />}
            {summary.duesWaiver && <div className="sm:col-span-2"><Particular label="Dues waiver" value={`${rupees(summary.duesWaiver.outstandingMinor)} — ${summary.duesWaiver.note}`} /></div>}
            {summary.cancelReason && <div className="sm:col-span-2"><Particular label="Cancellation reason" value={summary.cancelReason} /></div>}
          </dl>
        )}
      </Modal>
      <Modal open={!!voiding} onOpenChange={(o) => { if (!o) setVoiding(null); }} title={voiding?.draft ? "Void this draft?" : `Cancel ${voiding?.label ?? ""}?`} size="sm"
        footer={<><Button variant="outline" onClick={() => setVoiding(null)}>Keep</Button><Button variant="danger" loading={busy} disabled={!voidReason.trim()} onClick={doVoid}>{voiding?.draft ? "Void draft" : "Cancel certificate"}</Button></>}>
        <p className="mb-3 text-sm text-ink-soft">{voiding?.draft ? "The draft is kept on record as cancelled; the student is not affected." : "The certificate stays on record as cancelled (its verification shows it as not valid) and the student's previous status is restored. Their ended enrollment is not reopened."}</p>
        <FormField label="Reason" required><Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={200} placeholder="e.g. Issued by mistake" /></FormField>
      </Modal>
    </Card>
  );
}

function TcStatus({ status }: { status: "draft" | "issued" | "cancelled" }) {
  const tone = status === "issued" ? "teal" : status === "draft" ? "lavender" : "neutral";
  return <Badge tone={tone} dot>{status === "issued" ? "Issued" : status === "draft" ? "Draft" : "Cancelled"}</Badge>;
}

/** A saved certificate, ready to print / save as PDF. */
function TcPrintModal({ tcId, onClose, autoPrint }: { tcId: Id<"transferCertificates">; onClose: () => void; autoPrint?: boolean }) {
  const tc = useSchoolQuery(api.studentLifecycle.transferCertificate, { tcId });
  const printed = useRef(false);
  useEffect(() => {
    if (autoPrint && tc && !printed.current) { printed.current = true; setTimeout(() => window.print(), 350); }
  }, [autoPrint, tc]);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Transfer certificate" size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => window.print()} disabled={!tc}><Printer className="h-4 w-4" /> Print / save as PDF</Button></>}>
      {!tc ? <LoadingState variant="inline" /> : (
        <TcDocument data={{
          school: { name: tc.school.name, address: tc.school.address }, tcNo: tc.tcNo, status: tc.status, snapshot: tc.snapshot, leavingDate: tc.leavingDate,
          applicationDate: tc.applicationDate, issueDate: tc.status === "draft" ? null : tc.issueDate, reason: tc.reason, conduct: tc.conduct, destinationSchool: tc.destinationSchool,
          remarks: tc.remarks, verificationCode: tc.verificationCode, cancelReason: tc.cancelReason, issuedBy: tc.issuedBy,
        }} />
      )}
    </Modal>
  );
}
