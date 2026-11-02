"use client";
/** A teacher's own leave applications (Attendance; contributed to the Core staff profile). */
import { useState } from "react";
import { CalendarPlus, Undo2 } from "lucide-react";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex/_generated/api";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, FormField, Input, LoadingState, Modal, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";

type LeaveType = FunctionArgs<typeof api.staff.applyLeave>["type"];
export const LEAVE_LABEL: Record<LeaveType, string> = { casual: "Casual", sick: "Sick", earned: "Earned", duty: "On duty" };

export function MyLeave() {
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Type" className="sm:col-span-2"><Select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>{(Object.keys(LEAVE_LABEL) as LeaveType[]).map((k) => <option key={k} value={k}>{LEAVE_LABEL[k]}</option>)}</Select></FormField>
        <FormField label="From" required><Input type="date" value={fromDate} onChange={(e) => { setFrom(e.target.value); if (toDate < e.target.value) setTo(e.target.value); }} /></FormField>
        <FormField label="To" required><Input type="date" value={toDate} min={fromDate} onChange={(e) => setTo(e.target.value)} /></FormField>
        <FormField label="Reason" required className="sm:col-span-2"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
