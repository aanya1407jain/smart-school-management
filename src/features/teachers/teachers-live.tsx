"use client";
/**
 * LIVE Teachers & Staff (staff:manage): teacher records (edit, deactivate),
 * daily staff attendance and leave decisions. Deliberately not payroll/HR.
 * New teachers are added in Accounts & Import (one row or a spreadsheet).
 * Server: teachers.listTeachers / updateTeacher (Core). Staff attendance and
 * leave tabs are contributed by Attendance (features/attendance/staff-admin.tsx).
 */
import { useState } from "react";
import { Pencil, Upload } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { Button, Card, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, LinkButton, LoadingState, Modal, PageHeader, Segmented, Select, StatusBadge, Tabs, TabsContent, TabsList, useToast } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";
import { contributionsTo } from "@/lib/contributions";

type Teacher = FunctionReturnType<typeof api.teachers.listTeachers>[number];

export function LiveTeachersWorkspace() {
  // Teacher records are Core; staff attendance and leave tabs are contributed by Attendance when shipped and enabled.
  const tabs = contributionsTo("teachersWorkspace", useSession().hasModule).flatMap((c) => c.tabs);
  return (
    <div data-testid="live-teachers">
      <PageHeader title="Teachers & Staff" description="Teacher records, daily staff attendance and leave requests." actions={<LinkButton href="/admin/accounts" variant="outline"><Upload className="h-4 w-4" /> Add or import teachers</LinkButton>} />
      <Tabs defaultValue="teachers">
        <TabsList items={[{ value: "teachers", label: "Teachers" }, ...tabs.map(({ value, label }) => ({ value, label }))]} />
        <TabsContent value="teachers"><TeacherRecords /></TabsContent>
        {tabs.map(({ value, Content }) => <TabsContent key={value} value={value}><Content /></TabsContent>)}
      </Tabs>
    </div>
  );
}

function TeacherRecords() {
  const rows = useSchoolQuery(api.teachers.listTeachers, {});
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
  const update = useSchoolMutation(api.teachers.updateTeacher);
  const subjects = useSchoolQuery(api.academics.listSubjectOptions, {});
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
        specializationSubjectIds: f.subjectIds, status: f.status,
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

