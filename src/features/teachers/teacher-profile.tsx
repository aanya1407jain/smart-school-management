"use client";
import { useState } from "react";
import Link from "next/link";
import { Briefcase, CalendarDays, GraduationCap, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react";
import type { LeaveType } from "@/types/attendance";
import { services } from "@/lib/services";
import type { TeacherProfile } from "@/lib/services/teachers.service";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, FormField, GlassCard, Input, LinkButton, Modal, QueryView, Select, StatusBadge,
  Tabs, TabsContent, TabsList, Textarea, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { WeekGrid } from "@/features/timetable/week-grid";
import { formatDate, formatShortDate, todayISO } from "@/lib/utils/dates";
import { LEAVE_TYPE_LABELS } from "@/features/attendance/labels";
import { cn } from "@/lib/utils/cn";

/** Used by admins (/admin/teachers/[id]) and by teachers for their own profile. */
export function TeacherProfileView({ teacherId, self }: { teacherId: string; self?: boolean }) {
  const q = useQuery(() => services.teachers.getProfile(teacherId), [teacherId]);
  const periods = useQuery(() => services.timetable.getTeacherTimetable(teacherId), [teacherId]);
  return <QueryView query={q}>{(p) => <Body p={p} self={self} periods={periods.data?.periods ?? []} />}</QueryView>;
}

function Body({ p, self, periods }: { p: TeacherProfile; self?: boolean; periods: NonNullable<Awaited<ReturnType<typeof services.timetable.getTeacherTimetable>>>["periods"] }) {
  const t = p.teacher;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const classHref = (sectionId: string) => (self ? `/teacher/classes/${sectionId}` : undefined);
  return (
    <div className="space-y-6">
      <GlassCard className="relative overflow-hidden p-6">
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={p.name} size="xl" />
            <div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-sapphire">{p.name}</h1><StatusBadge status={t.status} /></div>
              <p className="text-sm text-ink-muted"><span className="font-mono">{t.employeeId}</span> · {t.designation}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{p.specializations.map((s) => <Badge key={s} tone="teal">{s}</Badge>)}</div>
            </div>
          </div>
          <div className="flex gap-2">
            {self ? <Button onClick={() => setLeaveOpen(true)}><Plus className="h-4 w-4" /> Apply for leave</Button> : <LinkButton href={`/admin/teachers/${t.id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          </div>
        </div>
        <dl className="relative mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Assignments</dt><dd className="text-lg font-semibold text-sapphire">{p.assignments.length}</dd></div>
          <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Periods / week</dt><dd className="text-lg font-semibold text-sapphire">{p.timetable.length}</dd></div>
          <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Class teacher</dt><dd className="text-lg font-semibold text-sapphire">{p.classTeacherOf.map((c) => c.label).join(", ") || "—"}</dd></div>
          <div><dt className="text-[12px] uppercase tracking-wide text-ink-muted">Present (28 days)</dt><dd className="text-lg font-semibold text-sapphire">{p.attendance.present}/{p.attendance.records.length}</dd></div>
        </dl>
      </GlassCard>

      <Tabs defaultValue="overview">
        <TabsList items={[{ value: "overview", label: "Overview" }, { value: "classes", label: "Assigned classes", count: p.assignments.length }, { value: "timetable", label: "Timetable" }, { value: "attendance", label: "Attendance" }, { value: "leave", label: "Leave", count: p.leave.length }]} />
        <TabsContent value="overview">
          <Card>
            <CardHeader title="Contact & employment" />
            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Row icon={<Mail />} label="Email" value={t.email} />
              <Row icon={<Phone />} label="Phone" value={t.phone} />
              <Row icon={<GraduationCap />} label="Qualification" value={t.qualification} />
              <Row icon={<CalendarDays />} label="Joined" value={formatDate(t.joiningDate)} />
              <Row icon={<Briefcase />} label="Designation" value={t.designation} />
              <Row icon={<MapPin />} label="Address" value={t.address || "—"} />
            </dl>
            {p.account && <p className="border-t border-line/60 px-5 py-3 text-[12.5px] text-ink-muted">Portal login: <span className="font-mono text-ink-soft">{p.account}</span></p>}
          </Card>
        </TabsContent>
        <TabsContent value="classes">
          {p.assignments.length === 0 ? <Card><EmptyState title="No classes assigned yet" description={self ? "The school office will assign your classes." : "Assign subjects and sections in Academics."} action={!self && <LinkButton href="/admin/academics?tab=assignments">Assign classes</LinkButton>} /></Card> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {p.assignments.map((a) => {
                const href = classHref(a.sectionId);
                const body = (
                  <Card className={cn("p-4", href && "transition-all hover:shadow-lift")}>
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{a.subject}</p>
                    <p className="mt-1 text-lg font-semibold text-sapphire">Class {a.sectionLabel}</p>
                    <p className="text-[13px] text-ink-muted">{a.students} students</p>
                  </Card>
                );
                return <div key={a.id}>{href ? <Link href={href}>{body}</Link> : body}</div>;
              })}
            </div>
          )}
        </TabsContent>
        <TabsContent value="timetable">
          <Card className="p-4">{p.timetable.length ? <WeekGrid periods={periods} entries={p.timetable.map((e) => ({ ...e, subjectCode: "", teacher: p.name }))} mode="teacher" /> : <EmptyState title="No timetable yet" />}</Card>
        </TabsContent>
        <TabsContent value="attendance">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap gap-2 text-sm"><Badge tone="teal">{p.attendance.present} present</Badge><Badge tone="plum">{p.attendance.absent} absent</Badge><Badge tone="lavender">{p.attendance.onLeave} on leave</Badge></div>
            {p.attendance.records.length === 0 ? <EmptyState title="No staff attendance records" /> : (
              <ul className="flex flex-wrap gap-2">
                {p.attendance.records.map((r) => (
                  <li key={r.id} className={cn("w-[74px] rounded-xl border px-2 py-2 text-center", r.status === "absent" ? "border-purple/30 bg-blush/40" : r.status === "on_leave" ? "border-mauve/30 bg-lavender/20" : "border-line/70 bg-white")}>
                    <p className="text-sm font-semibold text-ink">{formatShortDate(r.date)}</p>
                    <p className={cn("text-[11px] font-semibold", r.status === "absent" ? "text-plum" : r.status === "on_leave" ? "text-plum" : "text-lagoon")}>{r.status === "on_leave" ? "Leave" : r.status === "absent" ? "Absent" : "Present"}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="leave">
          <Card>
            {p.leave.length === 0 ? <EmptyState title="No leave requests" /> : (
              <ul className="divide-y divide-line/60">
                {p.leave.map((l) => (
                  <li key={l.id} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="text-sm font-semibold text-ink">{LEAVE_TYPE_LABELS[l.type]} leave · {formatDate(l.fromDate)} → {formatDate(l.toDate)}</p><p className="text-[13px] text-ink-muted">{l.reason}</p></div>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      {self && <LeaveModal open={leaveOpen} onOpenChange={setLeaveOpen} />}
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactElement; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-soft text-lagoon [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>
      <div><dt className="text-[12px] text-ink-muted">{label}</dt><dd className="text-sm font-medium text-ink">{value}</dd></div>
    </div>
  );
}

function LeaveModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ type: "casual" as LeaveType, fromDate: todayISO(), toDate: todayISO(), reason: "" });
  const m = useMutation(services.teachers.applyLeave);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Apply for leave" description="The principal will be notified." size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} onClick={async () => { if (await m.mutate(form)) { toast({ title: "Leave request sent" }); onOpenChange(false); } }}>Submit request</Button></>}>
      <div className="space-y-4">
        <FormField label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}>{Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="From" required><Input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></FormField>
          <FormField label="To" required error={m.fieldErrors.toDate}><Input type="date" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></FormField>
        </div>
        <FormField label="Reason" required error={m.fieldErrors.reason}><Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField>
        <FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} />
      </div>
    </Modal>
  );
}
