"use client";
/** Daily staff attendance and leave decisions (Attendance; contributed to the Core Teachers & Staff workspace). */
import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Check, UserCheck, UserX, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, FormField, Input, LoadingState, Modal, Segmented, StatCard, StatusBadge, Textarea, useToast } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { LEAVE_LABEL } from "./my-leave";

type StaffStatus = "present" | "absent" | "on_leave";
const STAFF_LABEL: Record<StaffStatus, string> = { present: "Present", absent: "Absent", on_leave: "On leave" };

export function StaffAttendance() {
  const { toast } = useToast();
  const [date, setDate] = useState(todayISO());
  const rows = useSchoolQuery(api.staff.staffAttendanceByDate, { date });
  const mark = useSchoolMutation(api.staff.markStaffAttendance);
  const [draft, setDraft] = useState<Record<string, StaffStatus>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!rows) return;
    // Start from what is saved; unmarked teachers default to on_leave (approved leave) or present.
    setDraft(Object.fromEntries(rows.map((r) => [r.teacherId, (r.status ?? (r.approvedLeave ? "on_leave" : "present")) as StaffStatus])));
  }, [rows]);
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, on_leave: 0 };
    Object.values(draft).forEach((s) => c[s]++);
    return c;
  }, [draft]);
  const changed = (rows ?? []).filter((r) => r.status !== draft[r.teacherId]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await mark({ date, entries: (rows ?? []).map((t) => ({ teacherId: t.teacherId, status: draft[t.teacherId] })) });
      toast({ title: "Staff attendance saved", description: `${r.changed} change${r.changed === 1 ? "" : "s"} for ${formatDate(date)}` });
    } catch (e) {
      toast({ tone: "error", title: "Could not save", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="live-staff-attendance">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Present" value={counts.present} icon={<UserCheck className="h-5 w-5" />} />
        <StatCard label="Absent" value={counts.absent} icon={<UserX className="h-5 w-5" />} tone="purple" />
        <StatCard label="On leave" value={counts.on_leave} icon={<CalendarOff className="h-5 w-5" />} tone="lavender" />
      </div>
      <Card>
        <CardHeader title="Daily staff attendance" description="One status per teacher per day. Approved leave is suggested; nothing is saved until you press Save."
          action={<div className="flex items-center gap-2"><Input type="date" aria-label="Date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" /><Button loading={busy} disabled={!rows?.length} onClick={save}>Save{changed.length ? ` (${changed.length})` : ""}</Button></div>} />
        <div className="p-5 pt-2">
          {rows === undefined ? <LoadingState variant="table" /> : (
            <DataTable caption="Staff attendance" rows={rows} getRowId={(r) => r.teacherId} empty={<EmptyState title="No active teachers" />}
              columns={[
                { key: "n", header: "Teacher", primary: true, cell: (r) => <div><p className="font-medium text-ink">{r.name}</p><p className="font-mono text-[12px] text-ink-muted">{r.employeeId}</p></div> },
                { key: "l", header: "Leave", cell: (r) => r.approvedLeave ? <Badge tone="lavender">{LEAVE_LABEL[r.approvedLeave.type]} leave approved</Badge> : "—" },
                { key: "saved", header: "Saved", cell: (r) => r.status ? STAFF_LABEL[r.status as StaffStatus] : <span className="text-ink-muted">Not marked</span> },
                { key: "s", header: "Status", cell: (r) => (
                  <Segmented size="sm" label={`Status for ${r.name}`} value={draft[r.teacherId] ?? "present"} onChange={(v) => setDraft({ ...draft, [r.teacherId]: v as StaffStatus })}
                    options={(Object.keys(STAFF_LABEL) as StaffStatus[]).map((k) => ({ value: k, label: STAFF_LABEL[k] }))} />
                ) },
              ]} />
          )}
        </div>
      </Card>
    </div>
  );
}

export function LeaveRequests() {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const rows = useSchoolQuery(api.staff.listLeave, status === "pending" ? { status: "pending" } : {});
  const [deciding, setDeciding] = useState<{ row: NonNullable<typeof rows>[number]; decision: "approved" | "rejected" } | null>(null);
  return (
    <Card data-testid="live-leave">
      <CardHeader title="Leave requests" action={<Segmented size="sm" label="Show" value={status} onChange={setStatus} options={[{ value: "pending", label: "Pending" }, { value: "all", label: "All" }]} />} />
      <div className="p-5 pt-2">
        {rows === undefined ? <LoadingState variant="table" /> : (
          <DataTable caption="Leave requests" rows={rows} getRowId={(r) => r.leaveRequestId} empty={<EmptyState title={status === "pending" ? "No pending requests" : "No leave requests"} />}
            columns={[
              { key: "t", header: "Teacher", primary: true, cell: (r) => <span className="font-medium text-ink">{r.teacher}</span> },
              { key: "d", header: "Dates", cell: (r) => r.fromDate === r.toDate ? formatDate(r.fromDate) : `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}` },
              { key: "k", header: "Type", cell: (r) => LEAVE_LABEL[r.type] },
              { key: "r", header: "Reason", cell: (r) => <span className="text-ink-soft">{r.reason}</span> },
              { key: "s", header: "Status", cell: (r) => <span className="flex flex-col gap-0.5"><StatusBadge status={r.status} />{r.decisionNote && <span className="text-[12px] text-ink-muted">{r.decisionNote}</span>}</span> },
            ]}
            rowActions={(r) => r.status === "pending" ? (
              <div className="flex gap-1">
                <Button size="sm" variant="soft" onClick={() => setDeciding({ row: r, decision: "approved" })}><Check className="h-4 w-4" /> Approve</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeciding({ row: r, decision: "rejected" })}><X className="h-4 w-4" /> Reject</Button>
              </div>
            ) : null} />
        )}
      </div>
      {deciding && <DecideModal {...deciding} onClose={() => setDeciding(null)} />}
    </Card>
  );
}

function DecideModal({ row, decision, onClose }: { row: { leaveRequestId: Id<"leaveRequests">; teacher: string; fromDate: string; toDate: string }; decision: "approved" | "rejected"; onClose: () => void }) {
  const { toast } = useToast();
  const decide = useSchoolMutation(api.staff.decideLeave);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await decide({ leaveRequestId: row.leaveRequestId, decision, ...(note.trim() ? { note: note.trim() } : {}) });
      toast({ title: decision === "approved" ? "Leave approved" : "Leave rejected", description: `${row.teacher} has been notified.` });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={decision === "approved" ? "Approve leave" : "Reject leave"} description={`${row.teacher} · ${formatDate(row.fromDate)}${row.toDate !== row.fromDate ? ` – ${formatDate(row.toDate)}` : ""}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={decision === "rejected" ? "danger" : "primary"} loading={busy} onClick={submit}>{decision === "approved" ? "Approve" : "Reject"}</Button></>}>
      <FormField label="Note to the teacher" hint="Optional"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></FormField>
      {error && <p role="alert" className="mt-2 text-[13px] text-plum">{error}</p>}
    </Modal>
  );
}
