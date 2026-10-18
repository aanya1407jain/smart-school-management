"use client";
/**
 * LIVE profile for administrators and teachers (profile.mine / updateMine):
 * account details, password change, and — for teachers — their own record,
 * current-year duties and leave applications (staff.myLeave / applyLeave /
 * withdrawLeave). Editable fields follow the server rules: an administrator
 * can rename themself, a teacher can update their own phone number.
 */
import { useEffect, useState } from "react";
import { CalendarPlus, Calculator, Save, ShieldCheck, Undo2 } from "lucide-react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { PasswordCard } from "./profile-page";

type LeaveType = FunctionArgs<typeof api.staff.applyLeave>["type"];
export const LEAVE_LABEL: Record<LeaveType, string> = { casual: "Casual", sick: "Sick", earned: "Earned", duty: "On duty" };

export function LiveStaffProfile() {
  const p = useSchoolQuery(api.profile.mine, {});
  if (p === undefined) return <LoadingState />;
  return (
    <div className="space-y-6" data-testid="live-staff-profile">
      <PageHeader title="Profile" description="Your account details and sign-in settings." />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <AccountCard p={p} />
        <PasswordCard />
      </div>
      {p.teacher && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Staff record" description="Kept by the school office." />
            <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
              <Field label="Employee ID" value={p.teacher.employeeId} mono />
              <Field label="Designation" value={p.teacher.designation} />
              <Field label="Qualification" value={p.teacher.qualification} />
              <Field label="Joined" value={p.teacher.joiningDate ? formatDate(p.teacher.joiningDate) : null} />
              <Field label="Contact email" value={p.teacher.email} />
              <Field label="Status" value={p.teacher.status.replace("_", " ")} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="This year's duties" />
            <div className="space-y-3 p-5 text-sm">
              <div><p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Class teacher of</p><p className="text-ink">{p.duties?.classTeacherOf.length ? p.duties.classTeacherOf.join(", ") : "—"}</p></div>
              <div><p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Subjects</p>{p.duties?.subjects.length ? <ul className="mt-1 space-y-0.5 text-ink">{p.duties.subjects.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-ink">—</p>}</div>
            </div>
          </Card>
        </div>
      )}
      {p.teacher && <MyLeave />}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return <div><dt className="text-[12px] text-ink-muted">{label}</dt><dd className={mono ? "font-mono text-ink" : "capitalize text-ink"}>{value || "—"}</dd></div>;
}

function AccountCard({ p }: { p: FunctionReturnType<typeof api.profile.mine> }) {
  const { toast } = useToast();
  const update = useSchoolMutation(api.profile.updateMine);
  const [name, setName] = useState(p.displayName);
  const [phone, setPhone] = useState(p.teacher?.phone ?? "");
  useEffect(() => { setName(p.displayName); setPhone(p.teacher?.phone ?? ""); }, [p.displayName, p.teacher?.phone]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = (p.canRename && name !== p.displayName) || (p.canEditPhone && phone !== (p.teacher?.phone ?? ""));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await update({ ...(p.canRename && name !== p.displayName ? { displayName: name } : {}), ...(p.canEditPhone && phone !== (p.teacher?.phone ?? "") ? { phone } : {}) });
      toast({ title: "Profile updated" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Account" />
      <div className="space-y-5 p-5">
        <div className="flex items-center gap-4">
          <Avatar name={p.displayName} size="xl" />
          <div>
            <p className="text-lg font-semibold text-sapphire">{p.displayName}</p>
            <p className="font-mono text-sm text-ink-muted">{p.loginId ?? "—"}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone="teal"><ShieldCheck className="h-3 w-3" /> {p.role === "admin" ? "Administrator" : "Teacher"}</Badge>
              {p.accountantOnly && <Badge tone="lavender"><Calculator className="h-3 w-3" /> Accountant only</Badge>}
              <Badge tone="neutral">{p.school}</Badge>
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Display name" hint={p.canRename ? undefined : "Managed by the school office."}><Input value={name} disabled={!p.canRename} onChange={(e) => setName(e.target.value)} maxLength={120} /></FormField>
          {p.canEditPhone && <FormField label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></FormField>}
          <FormField label="Login ID" hint="Issued by your school. Contact the office to change it." className="sm:col-span-2"><Input value={p.loginId ?? ""} disabled className="font-mono" /></FormField>
        </div>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
        {(p.canRename || p.canEditPhone) && <div className="flex justify-end"><Button loading={busy} disabled={!dirty} onClick={save}><Save className="h-4 w-4" /> Save</Button></div>}
      </div>
    </Card>
  );
}

function MyLeave() {
  const { toast } = useToast();
  const rows = useSchoolQuery(api.staff.myLeave, {});
  const withdraw = useSchoolMutation(api.staff.withdrawLeave);
  const [applying, setApplying] = useState(false);
  const [del, setDel] = useState<NonNullable<typeof rows>[number] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card data-testid="my-leave">
      <CardHeader title="My leave" description="Apply for leave; the school office approves or rejects it and you are notified." action={<Button size="sm" onClick={() => setApplying(true)}><CalendarPlus className="h-4 w-4" /> Apply for leave</Button>} />
      <div className="p-5 pt-2">
        {rows === undefined ? <LoadingState variant="inline" /> : (
          <DataTable caption="My leave requests" rows={rows} getRowId={(r) => r.leaveRequestId} empty={<EmptyState title="No leave requests yet" />}
            columns={[
              { key: "d", header: "Dates", primary: true, cell: (r) => r.fromDate === r.toDate ? formatDate(r.fromDate) : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}` },
              { key: "t", header: "Type", cell: (r) => LEAVE_LABEL[r.type] },
              { key: "r", header: "Reason", cell: (r) => <span className="text-ink-soft">{r.reason}</span> },
              { key: "s", header: "Status", cell: (r) => <span className="flex flex-col gap-0.5"><StatusBadge status={r.status} />{r.decisionNote && <span className="text-[12px] text-ink-muted">{r.decisionNote}</span>}</span> },
            ]}
            rowActions={(r) => r.status === "pending" ? <Button size="sm" variant="ghost" onClick={() => setDel(r)}><Undo2 className="h-4 w-4" /> Withdraw</Button> : null} />
        )}
      </div>
      {applying && <ApplyLeaveModal onClose={() => setApplying(false)} />}
      {del && <ConfirmDialog open onOpenChange={(o) => !o && setDel(null)} title="Withdraw this request?" description={`Your ${LEAVE_LABEL[del.type].toLowerCase()} leave request for ${formatDate(del.fromDate)} will be withdrawn.`} confirmLabel="Withdraw" tone="danger" loading={busy}
        onConfirm={async () => { setBusy(true); try { await withdraw({ leaveRequestId: del.leaveRequestId }); toast({ title: "Leave request withdrawn" }); setDel(null); } catch (e) { toast({ tone: "error", title: "Could not withdraw", description: errorMessage(e) }); } finally { setBusy(false); } }} />}
    </Card>
  );
}

function ApplyLeaveModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const apply = useSchoolMutation(api.staff.applyLeave);
  const [type, setType] = useState<LeaveType>("casual");
  const [fromDate, setFrom] = useState(todayISO());
  const [toDate, setTo] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!reason.trim()) return setError("Give a reason.");
    setBusy(true);
    setError(null);
    try {
      await apply({ type, fromDate, toDate, reason: reason.trim() });
      toast({ title: "Leave requested", description: "The school office will review it." });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Apply for leave" size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Submit request</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Type" className="sm:col-span-2"><Select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>{(Object.keys(LEAVE_LABEL) as LeaveType[]).map((k) => <option key={k} value={k}>{LEAVE_LABEL[k]}</option>)}</Select></FormField>
        <FormField label="From" required><Input type="date" value={fromDate} onChange={(e) => { setFrom(e.target.value); if (toDate < e.target.value) setTo(e.target.value); }} /></FormField>
        <FormField label="To" required><Input type="date" value={toDate} min={fromDate} onChange={(e) => setTo(e.target.value)} /></FormField>
        <FormField label="Reason" required className="sm:col-span-2"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
