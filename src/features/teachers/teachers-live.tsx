"use client";
/**
 * LIVE Teachers & Staff (staff:manage): teacher records (edit, deactivate),
 * daily staff attendance and leave decisions. Deliberately not payroll/HR.
 * New teachers are added in Accounts & Import (one row or a spreadsheet).
 * Server: staff.listTeachers / updateTeacher / staffAttendanceByDate /
 * markStaffAttendance / listLeave / decideLeave — all audited; a leave
 * decision notifies the teacher once.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Check, Pencil, Upload, UserCheck, UserX, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import {
  Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, LinkButton, LoadingState, Modal, PageHeader, Segmented,
  Select, StatCard, StatusBadge, Tabs, TabsContent, TabsList, Textarea, useToast,
} from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { LEAVE_LABEL } from "@/features/profile/staff-profile-live";

type Teacher = FunctionReturnType<typeof api.staff.listTeachers>[number];

export function LiveTeachersWorkspace() {
  const pending = useSchoolQuery(api.staff.listLeave, { status: "pending" });
  return (
    <div data-testid="live-teachers">
      <PageHeader title="Teachers & Staff" description="Teacher records, daily staff attendance and leave requests." actions={<LinkButton href="/admin/accounts" variant="outline"><Upload className="h-4 w-4" /> Add or import teachers</LinkButton>} />
      <Tabs defaultValue="teachers">
        <TabsList items={[{ value: "teachers", label: "Teachers" }, { value: "attendance", label: "Staff attendance" }, { value: "leave", label: "Leave", count: pending?.length || undefined }]} />
        <TabsContent value="teachers"><TeacherRecords /></TabsContent>
        <TabsContent value="attendance"><StaffAttendance /></TabsContent>
        <TabsContent value="leave"><LeaveRequests /></TabsContent>
      </Tabs>
    </div>
  );
}

function TeacherRecords() {
  const rows = useSchoolQuery(api.staff.listTeachers, {});
  const [status, setStatus] = useState<"active" | "all">("active");
  const [editing, setEditing] = useState<Teacher | null>(null);
  const shown = (rows ?? []).filter((t) => status === "all" || t.status !== "inactive");
  return (
    <Card>
      <CardHeader title="Teachers" action={<Segmented size="sm" label="Show" value={status} onChange={setStatus} options={[{ value: "active", label: "Current" }, { value: "all", label: "All" }]} />} />
      <div className="p-5 pt-2">
        {rows === undefined ? <LoadingState variant="table" /> : (
          <DataTable caption="Teachers" rows={shown} getRowId={(t) => t.teacherId} empty={<EmptyState title="No teachers yet" description="Add teachers in Accounts & Import." />}
            columns={[
              { key: "n", header: "Name", primary: true, cell: (t) => <div><p className="font-medium text-ink">{t.name}</p><p className="font-mono text-[12px] text-ink-muted">{t.employeeId}</p></div> },
              { key: "d", header: "Designation", cell: (t) => <span className="text-ink-soft">{t.designation ?? "—"}</span> },
              { key: "c", header: "Class teacher", cell: (t) => t.classTeacherOf.join(", ") || "—" },
              { key: "l", header: "Subject classes", cell: (t) => t.subjectLoad },
              { key: "a", header: "Sign-in", cell: (t) => t.account ? <span className="font-mono text-[12.5px]">{t.account.loginId ?? "pending"}{t.account.status === "suspended" ? " (disabled)" : ""}</span> : <span className="text-ink-muted">No account</span> },
              { key: "s", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
            ]}
            rowActions={(t) => <Button size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /> Edit</Button>} />
        )}
      </div>
      {editing && <EditTeacherModal teacher={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function EditTeacherModal({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const { toast } = useToast();
  const update = useSchoolMutation(api.staff.updateTeacher);
  const subjects = useSchoolQuery(api.academics.listSubjects, {});
  const [f, setF] = useState({
    title: teacher.title ?? "", firstName: teacher.firstName, lastName: teacher.lastName, gender: teacher.gender ?? "",
    email: teacher.email ?? "", phone: teacher.phone ?? "", designation: teacher.designation ?? "", qualification: teacher.qualification ?? "",
    joiningDate: teacher.joiningDate ?? "", status: teacher.status, subjectIds: teacher.specializationSubjectIds as string[],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.firstName.trim() || !f.lastName.trim()) return setError("First and last name are required.");
    setBusy(true);
    setError(null);
    try {
      await update({
        teacherId: teacher.teacherId, title: f.title, firstName: f.firstName, lastName: f.lastName, gender: (f.gender || null) as "male" | "female" | "other" | null,
        email: f.email, phone: f.phone, designation: f.designation, qualification: f.qualification, joiningDate: f.joiningDate,
        specializationSubjectIds: f.subjectIds as Id<"subjects">[], status: f.status,
      });
      toast({ title: "Teacher updated", description: `${f.firstName} ${f.lastName}` });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Edit ${teacher.name}`} description={`Employee ID ${teacher.employeeId} (fixed)`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Title"><Input value={f.title} onChange={set("title")} maxLength={20} placeholder="Mrs." /></FormField>
        <FormField label="First name" required><Input value={f.firstName} onChange={set("firstName")} maxLength={80} /></FormField>
        <FormField label="Last name" required><Input value={f.lastName} onChange={set("lastName")} maxLength={80} /></FormField>
        <FormField label="Gender"><Select value={f.gender} onChange={set("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></FormField>
        <FormField label="Email"><Input type="email" value={f.email} onChange={set("email")} /></FormField>
        <FormField label="Phone"><Input type="tel" value={f.phone} onChange={set("phone")} maxLength={30} /></FormField>
        <FormField label="Designation"><Input value={f.designation} onChange={set("designation")} maxLength={80} /></FormField>
        <FormField label="Qualification"><Input value={f.qualification} onChange={set("qualification")} maxLength={120} /></FormField>
        <FormField label="Joining date"><Input type="date" value={f.joiningDate} onChange={set("joiningDate")} /></FormField>
        <FormField label="Status" hint={f.status === "inactive" ? "Inactive teachers keep their history but drop off pickers and staff attendance." : undefined}>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Teacher["status"] })}><option value="active">Active</option><option value="on_leave">On leave</option><option value="inactive">Inactive</option></Select>
        </FormField>
        <fieldset className="sm:col-span-3">
          <legend className="mb-2 text-[13px] font-medium text-ink-soft">Subject specialisations</legend>
          <div className="flex flex-wrap gap-4">{(subjects ?? []).map((s) => <Checkbox key={s._id} label={s.name} checked={f.subjectIds.includes(s._id)} onChange={(e) => setF({ ...f, subjectIds: e.target.checked ? [...f.subjectIds, s._id] : f.subjectIds.filter((x) => x !== s._id) })} />)}</div>
        </fieldset>
        {error && <p role="alert" className="text-[13px] text-plum sm:col-span-3">{error}</p>}
      </div>
    </Modal>
  );
}

type StaffStatus = "present" | "absent" | "on_leave";
const STAFF_LABEL: Record<StaffStatus, string> = { present: "Present", absent: "Absent", on_leave: "On leave" };

function StaffAttendance() {
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

function LeaveRequests() {
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
