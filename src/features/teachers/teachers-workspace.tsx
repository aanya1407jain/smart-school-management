"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Mail, MoreHorizontal, Pencil, Phone, UserPlus, X, Eye } from "lucide-react";
import type { StaffAttendanceStatus } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import {
  Avatar, Badge, Button, Card, CardHeader, DataTable, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, EmptyState, FilterBar,
  FilterSelect, Input, LinkButton, PageHeader, QueryView, SearchInput, Segmented, StatusBadge, Tabs, TabsContent, TabsList, useToast,
} from "@/components/ui";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { formatDate, previousSchoolDay, todayISO, formatLongDate, isSchoolDay } from "@/lib/utils/dates";
import { LEAVE_TYPE_LABELS } from "@/lib/constants/labels";

export function TeachersWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState(params.get("tab") ?? "all");
  useEffect(() => { const t = params.get("tab"); if (t) setTab(t); }, [params]);
  const pending = useQuery(() => services.teachers.listLeave("pending"), []);
  return (
    <div>
      <PageHeader title="Teachers & Staff" description="Teaching staff, their assignments, daily staff attendance and leave." actions={<LinkButton href="/admin/teachers/new"><UserPlus className="h-4 w-4" /> Add teacher</LinkButton>} />
      <Tabs value={tab} onValueChange={(t) => { setTab(t); router.replace(`/admin/teachers?tab=${t}`, { scroll: false }); }}>
        <TabsList items={[{ value: "all", label: "All teachers" }, { value: "attendance", label: "Staff attendance" }, { value: "leave", label: "Leave", count: pending.data?.length }]} />
        <TabsContent value="all"><TeacherDirectory /></TabsContent>
        <TabsContent value="attendance"><StaffAttendance /></TabsContent>
        <TabsContent value="leave"><LeaveRequests /></TabsContent>
      </Tabs>
    </div>
  );
}

function TeacherDirectory() {
  const router = useRouter();
  const opts = useAcademicOptions();
  const [search, setSearch] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [classId, setClassId] = useState("");
  const q = useQuery(() => services.teachers.list({ search, subjectId, classId }), [search, subjectId, classId]);
  return (
    <Card className="p-4 sm:p-5">
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, employee ID or email" className="col-span-2 sm:w-72" label="Search teachers" />
        <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} allLabel="All subjects" options={(opts.data?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect label="Class" value={classId} onChange={setClassId} allLabel="All classes" options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      </FilterBar>
      <div className="mt-5">
        <QueryView query={q} loading="table" wrapError={false}>
          {(rows) => (
            <DataTable
              caption="Teachers"
              rows={rows}
              getRowId={(t) => t.id}
              onRowClick={(t) => router.push(`/admin/teachers/${t.id}`)}
              empty={<EmptyState title="No teachers found" description="Try a different search or filter." />}
              columns={[
                { key: "name", header: "Teacher", primary: true, cell: (t) => <div className="flex items-center gap-3"><Avatar name={t.name} size="sm" /><div className="min-w-0"><p className="truncate font-semibold text-ink">{t.name}</p><p className="truncate text-[12px] text-ink-muted">{t.designation}</p></div></div> },
                { key: "emp", header: "Employee ID", cell: (t) => <span className="font-mono text-[12.5px]">{t.employeeId}</span> },
                { key: "subjects", header: "Subjects", cell: (t) => <div className="flex flex-wrap gap-1">{t.subjects.map((s) => <Badge key={s} tone="outline">{s}</Badge>)}</div> },
                { key: "classes", header: "Classes", cell: (t) => <span className="text-[13px]">{t.sections.length ? t.sections.join(", ") : <span className="text-ink-muted">Unassigned</span>}</span> },
                { key: "ct", header: "Class teacher", cell: (t) => t.classTeacherOf ?? "—" },
                { key: "load", header: "Periods/wk", align: "right", cell: (t) => t.periodsPerWeek },
                { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
              ]}
              rowActions={(t) => (
                <DropdownMenu>
                  <DropdownTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownTrigger>
                  <DropdownContent>
                    <DropdownItem onSelect={() => router.push(`/admin/teachers/${t.id}`)}><Eye className="h-4 w-4" /> View profile</DropdownItem>
                    <DropdownItem onSelect={() => router.push(`/admin/teachers/${t.id}/edit`)}><Pencil className="h-4 w-4" /> Edit</DropdownItem>
                    <DropdownItem onSelect={() => { window.location.href = `mailto:${t.email}`; }}><Mail className="h-4 w-4" /> Email</DropdownItem>
                    <DropdownItem onSelect={() => { window.location.href = `tel:${t.phone}`; }}><Phone className="h-4 w-4" /> Call</DropdownItem>
                  </DropdownContent>
                </DropdownMenu>
              )}
            />
          )}
        </QueryView>
      </div>
    </Card>
  );
}

function StaffAttendance() {
  const { toast } = useToast();
  const [date, setDate] = useState(isSchoolDay(todayISO()) ? todayISO() : previousSchoolDay(todayISO()));
  const q = useQuery(() => services.teachers.getStaffAttendance(date), [date]);
  const [entries, setEntries] = useState<Record<string, StaffAttendanceStatus>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setEntries(Object.fromEntries(q.data.filter((r) => r.status).map((r) => [r.teacherId, r.status!])));
  }, [q.data]);
  const save = async () => {
    setSaving(true);
    try {
      await services.teachers.saveStaffAttendance(date, entries);
      toast({ title: "Staff attendance saved", description: formatLongDate(date) });
    } catch (e) { toast({ title: "Could not save", description: (e as Error).message, tone: "error" }); }
    setSaving(false);
  };
  const marked = Object.keys(entries).length;
  return (
    <Card>
      <CardHeader
        title="Staff attendance"
        description={formatLongDate(date)}
        action={<div className="flex items-center gap-2"><Input type="date" aria-label="Date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>}
      />
      <div className="p-5">
        <QueryView query={q} loading="inline">
          {(rows) => (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-muted">{marked}/{rows.length} marked · {Object.values(entries).filter((v) => v === "present").length} present</p>
                <Button size="sm" variant="soft" onClick={() => setEntries(Object.fromEntries(rows.map((r) => [r.teacherId, r.onApprovedLeave ? "on_leave" : "present"])))}><Check className="h-4 w-4" /> Mark all present</Button>
              </div>
              <ul className="divide-y divide-line/60">
                {rows.map((r) => (
                  <li key={r.teacherId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3"><Avatar name={r.name} size="sm" /><div><p className="text-sm font-semibold text-ink">{r.name}</p><p className="text-[12px] text-ink-muted">{r.employeeId} · {r.designation}{r.onApprovedLeave && " · approved leave"}</p></div></div>
                    <Segmented<StaffAttendanceStatus>
                      label={`Attendance for ${r.name}`}
                      size="sm"
                      value={entries[r.teacherId] ?? null}
                      onChange={(v) => setEntries((e) => ({ ...e, [r.teacherId]: v }))}
                      options={[
                        { value: "present", label: "Present", activeClass: "bg-teal text-white shadow-soft" },
                        { value: "absent", label: "Absent", activeClass: "bg-plum text-white shadow-soft" },
                        { value: "on_leave", label: "On leave", activeClass: "bg-mauve text-white shadow-soft" },
                      ]}
                    />
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex justify-end"><Button onClick={save} loading={saving} disabled={!marked}>Save staff attendance</Button></div>
            </>
          )}
        </QueryView>
      </div>
    </Card>
  );
}

function LeaveRequests() {
  const { toast } = useToast();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const q = useQuery(() => services.teachers.listLeave(status), [status]);
  const decide = async (id: string, d: "approved" | "rejected") => {
    try { await services.teachers.decideLeave(id, d); toast({ title: `Leave ${d}`, description: "The teacher has been notified." }); }
    catch (e) { toast({ title: "Failed", description: (e as Error).message, tone: "error" }); }
  };
  return (
    <Card>
      <CardHeader title="Leave requests" action={<Segmented label="Filter leave" size="sm" value={status} onChange={setStatus} options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]} />} />
      <div className="p-5">
        <QueryView query={q} loading="inline">
          {(rows) => rows.length === 0 ? <EmptyState title={status === "pending" ? "No pending leave requests" : "No leave requests"} /> : (
            <ul className="space-y-3">
              {rows.map((l) => (
                <li key={l.id} className="flex flex-col gap-3 rounded-xl border border-line/70 bg-alabaster/40 p-4 sm:flex-row sm:items-center">
                  <Avatar name={l.teacherName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{l.teacherName}</p><Badge tone="outline">{LEAVE_TYPE_LABELS[l.type]} leave</Badge><StatusBadge status={l.status} /></div>
                    <p className="text-sm text-ink-soft">{formatDate(l.fromDate)} → {formatDate(l.toDate)} · {l.days} day{l.days > 1 ? "s" : ""}</p>
                    <p className="text-[13px] text-ink-muted">{l.reason}</p>
                  </div>
                  {l.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => decide(l.id, "rejected")}><X className="h-4 w-4" /> Reject</Button>
                      <Button size="sm" onClick={() => decide(l.id, "approved")}><Check className="h-4 w-4" /> Approve</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </div>
    </Card>
  );
}

