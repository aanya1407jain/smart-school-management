"use client";
/**
 * Academics workspace for DEMO personas (in-browser demo data). Kept unchanged
 * from before the Convex wiring; school accounts use the live workspace in
 * academics-workspace.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookMarked, CalendarRange, Check, ChevronRight, GraduationCap, Layers, Pencil, Plus, School, UserCheck, Users } from "lucide-react";
import { services } from "@/lib/services";
import type { AcademicsOverview } from "@/lib/services/academics.service";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, FormField, GlassCard, Input, Modal, PageHeader,
  QueryView, Select, StatusBadge, Tabs, TabsContent, TabsList, useToast, ProgressBar,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Overview = AcademicsOverview;

export function DemoAcademicsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState(params.get("tab") ?? "setup");
  const q = useQuery(() => services.academics.getOverview(yearId), [yearId]);

  useEffect(() => { const t = params.get("tab"); if (t) setTab(t); }, [params]);
  const changeTab = (t: string) => { setTab(t); router.replace(`/admin/academics?tab=${t}`, { scroll: false }); };

  return (
    <div>
      <PageHeader
        title="Academics"
        description="Set up the academic year: classes, sections, subjects, enrollments and teacher assignments."
        actions={q.data && (
          <div className="flex items-center gap-2">
            <label htmlFor="ay" className="text-[13px] text-ink-muted">Academic year</label>
            <Select id="ay" value={q.data.year.id} onChange={(e) => setYearId(e.target.value)} className="w-52">
              {q.data.years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? " (current)" : ""}</option>)}
            </Select>
          </div>
        )}
      />
      <QueryView query={q}>
        {(d) => (
          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList items={[
              { value: "setup", label: "Setup overview" },
              { value: "years", label: "Academic years", count: d.years.length },
              { value: "classes", label: "Classes & sections", count: d.progress.sections },
              { value: "subjects", label: "Subjects", count: d.subjects.length },
              { value: "enrollments", label: "Enrollments", count: d.progress.enrolled },
              { value: "assignments", label: "Teacher assignments" },
            ]} />
            <TabsContent value="setup"><SetupOverview d={d} go={changeTab} /></TabsContent>
            <TabsContent value="years"><YearsTab d={d} /></TabsContent>
            <TabsContent value="classes"><ClassesTab d={d} /></TabsContent>
            <TabsContent value="subjects"><SubjectsTab d={d} /></TabsContent>
            <TabsContent value="enrollments"><EnrollmentsTab d={d} /></TabsContent>
            <TabsContent value="assignments"><AssignmentsTab d={d} /></TabsContent>
          </Tabs>
        )}
      </QueryView>
    </div>
  );
}

// ------------------------------------------------------------------ Setup overview (workflow)

function SetupOverview({ d, go }: { d: Overview; go: (t: string) => void }) {
  const steps = [
    { tab: "years", Icon: CalendarRange, title: "Academic year", detail: `${d.year.name} · ${formatDate(d.year.startDate)} – ${formatDate(d.year.endDate)}`, done: true },
    { tab: "classes", Icon: School, title: "Classes", detail: `${d.progress.classes} classes`, done: d.progress.classes > 0 },
    { tab: "classes", Icon: Layers, title: "Sections", detail: `${d.progress.sections} sections`, done: d.progress.sections > 0 },
    { tab: "subjects", Icon: BookMarked, title: "Subjects", detail: `${d.progress.subjects} subjects`, done: d.progress.subjects > 0 },
    { tab: "enrollments", Icon: GraduationCap, title: "Enroll students", detail: `${d.progress.enrolled} of ${d.progress.activeStudents} active students`, done: d.progress.enrolled > 0 && d.unenrolled.length === 0 },
    { tab: "assignments", Icon: UserCheck, title: "Assign teachers", detail: `${Math.round(d.progress.assignmentCoverage)}% of subject slots covered`, done: d.progress.openSlots === 0 && d.progress.sections > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <GlassCard className="p-6 lg:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-sapphire">Year setup workflow</h2>
            <p className="text-sm text-ink-muted">Each step builds on the previous one. Changes flow straight to teachers&apos; and students&apos; views.</p>
          </div>
          <Badge tone={done === steps.length ? "teal" : "lavender"}>{done}/{steps.length} complete</Badge>
        </div>
        <ol className="mt-6 space-y-2">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button onClick={() => go(s.tab)} className="group flex w-full items-center gap-4 rounded-2xl border border-white/80 bg-white/60 p-3.5 text-left transition-all hover:bg-white hover:shadow-soft">
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", s.done ? "bg-lagoon text-white" : "bg-heather/25 text-ink-soft")}>
                  {s.done ? <Check className="h-5 w-5" /> : <s.Icon className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Step {i + 1}</span>
                  <span className="block font-semibold text-ink">{s.title}</span>
                  <span className="block text-[13px] text-ink-muted">{s.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      </GlassCard>
      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Teacher coverage</p>
          <p className="mt-1 text-2xl font-semibold text-sapphire">{Math.round(d.progress.assignmentCoverage)}%</p>
          <ProgressBar className="mt-3" value={d.progress.assignmentCoverage} label="Teacher coverage" />
          <p className="mt-2 text-[12.5px] text-ink-muted">{d.progress.openSlots ? `${d.progress.openSlots} subject slots still need a teacher.` : "Every section has a teacher for every subject."}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Enrollment</p>
          <p className="mt-1 text-2xl font-semibold text-sapphire">{d.progress.enrolled}</p>
          <p className="text-[12.5px] text-ink-muted">{d.unenrolled.length ? `${d.unenrolled.length} active students are not enrolled in ${d.year.name}.` : `All active students are enrolled in ${d.year.name}.`}</p>
          {d.unenrolled.length > 0 && <Button size="sm" variant="soft" className="mt-3" onClick={() => go("enrollments")}>Enroll now</Button>}
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Years

function YearsTab({ d }: { d: Overview }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "2027–28", startDate: "2027-04-01", endDate: "2028-03-31" });
  const create = useMutation(services.academics.createAcademicYear);
  const setCurrent = useMutation(services.academics.setCurrentYear);
  return (
    <Card>
      <CardHeader title="Academic years" description="Only one year is current at a time." action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New year</Button>} />
      <div className="p-5">
        <DataTable
          rows={d.years}
          getRowId={(y) => y.id}
          columns={[
            { key: "name", header: "Year", primary: true, cell: (y) => <span className="font-semibold text-ink">{y.name}</span> },
            { key: "dates", header: "Duration", cell: (y) => `${formatDate(y.startDate)} – ${formatDate(y.endDate)}` },
            { key: "classes", header: "Classes", cell: (y) => y.classCount },
            { key: "status", header: "Status", cell: (y) => y.isCurrent ? <Badge tone="teal" dot>Current</Badge> : <StatusBadge status={y.status === "upcoming" ? "upcoming" : "archived"} /> },
          ]}
          rowActions={(y) => !y.isCurrent && y.status === "upcoming" ? <Button size="sm" variant="outline" onClick={() => setConfirm(y.id)}>Make current</Button> : null}
        />
      </div>
      <Modal open={open} onOpenChange={setOpen} title="Create academic year" size="sm" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} onClick={async () => { const r = await create.mutate(form); if (r) { toast({ title: "Academic year created", description: `${form.name} is ready for classes.` }); setOpen(false); } }}>Create</Button></>}>
        <div className="space-y-4">
          <FormField label="Name" required error={create.fieldErrors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts" required><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></FormField>
            <FormField label="Ends" required error={create.fieldErrors.endDate}><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></FormField>
          </div>
          <FormError error={create.error} />
        </div>
      </Modal>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Switch the current academic year?"
        description="Dashboards, attendance, fees and timetables will show data for the new year. Classes must be created for it first. You can switch back at any time in this demo (or use Settings → Reset demo data)."
        confirmLabel="Make current"
        loading={setCurrent.isPending}
        onConfirm={async () => { if (confirm && (await setCurrent.mutate(confirm))) { toast({ title: "Current academic year changed" }); setConfirm(null); } }}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ Classes & sections

function ClassesTab({ d }: { d: Overview }) {
  const { toast } = useToast();
  const [classOpen, setClassOpen] = useState(false);
  const [sectionFor, setSectionFor] = useState<string | null>(null);
  const [editSection, setEditSection] = useState<Overview["classes"][number]["sections"][number] | null>(null);
  const [subjectsFor, setSubjectsFor] = useState<Overview["classes"][number] | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setClassOpen(true)}><Plus className="h-4 w-4" /> Add class</Button></div>
      {d.classes.length === 0 && <Card><EmptyState title={`No classes for ${d.year.name} yet`} description="Create classes to start setting up this academic year." action={<Button onClick={() => setClassOpen(true)}>Add class</Button>} /></Card>}
      <div className="grid gap-4 xl:grid-cols-2">
        {d.classes.map((c) => (
          <Card key={c.id}>
            <CardHeader
              title={c.name}
              description={`${c.sections.length} sections · ${c.sections.reduce((a, s) => a + s.studentCount, 0)} students · ${c.subjects.length} subjects`}
              action={<div className="flex gap-1.5"><Button size="sm" variant="ghost" onClick={() => setSubjectsFor(c)}>Subjects</Button><Button size="sm" variant="soft" onClick={() => setSectionFor(c.id)}><Plus className="h-3.5 w-3.5" /> Section</Button></div>}
            />
            <ul className="grid gap-2.5 p-5 sm:grid-cols-3">
              {c.sections.map((s) => {
                const open = s.subjectCoverage.filter((x) => !x.teacherId).length;
                return (
                  <li key={s.id} className="rounded-xl border border-line/70 bg-alabaster/50 p-3.5">
                    <div className="flex items-start justify-between">
                      <p className="text-lg font-semibold text-sapphire">{s.label}</p>
                      <button onClick={() => setEditSection(s)} className="rounded-md p-1 text-ink-muted hover:bg-white hover:text-ink" aria-label={`Edit section ${s.label}`}><Pencil className="h-3.5 w-3.5" /></button>
                    </div>
                    <p className="text-[12.5px] text-ink-muted"><Users className="mr-1 inline h-3.5 w-3.5" aria-hidden />{s.studentCount}/{s.capacity} · {s.room}</p>
                    <p className="mt-1.5 truncate text-[12.5px] text-ink-soft">{s.classTeacherName ?? <span className="text-plum">No class teacher</span>}</p>
                    {open > 0 && <Badge tone="lavender" className="mt-2">{open} subject{open > 1 ? "s" : ""} unassigned</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <AddClassModal open={classOpen} onOpenChange={setClassOpen} d={d} onDone={() => toast({ title: "Class created", description: "Now add sections to it." })} />
      <SectionModal key={sectionFor ?? editSection?.id ?? "none"} d={d} classId={sectionFor} section={editSection} onClose={() => { setSectionFor(null); setEditSection(null); }} />
      {subjectsFor && <ClassSubjectsModal cls={subjectsFor} d={d} onClose={() => setSubjectsFor(null)} />}
    </div>
  );
}

function AddClassModal({ open, onOpenChange, d, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; d: Overview; onDone: () => void }) {
  const [grade, setGrade] = useState(6);
  const [subjectIds, setSubjectIds] = useState<string[]>(d.subjects.map((s) => s.id));
  const m = useMutation(services.academics.createClass);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add class" description={`For academic year ${d.year.name}`} size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} onClick={async () => { if (await m.mutate({ academicYearId: d.year.id, grade, subjectIds })) { onDone(); onOpenChange(false); } }}>Create class</Button></>}>
      <div className="space-y-4">
        <FormField label="Grade" required error={m.fieldErrors.grade}><Input type="number" min={1} max={12} value={grade} onChange={(e) => setGrade(Number(e.target.value))} /></FormField>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-soft">Subjects taught</legend>
          <div className="grid grid-cols-2 gap-2">
            {d.subjects.map((s) => <Checkbox key={s.id} label={s.name} checked={subjectIds.includes(s.id)} onChange={(e) => setSubjectIds(e.target.checked ? [...subjectIds, s.id] : subjectIds.filter((x) => x !== s.id))} />)}
          </div>
        </fieldset>
        <FormError error={m.error} />
      </div>
    </Modal>
  );
}

function SectionModal({ d, classId, section, onClose }: { d: Overview; classId: string | null; section: Overview["classes"][number]["sections"][number] | null; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [room, setRoom] = useState(section?.room ?? "");
  const [capacity, setCapacity] = useState(section?.capacity ?? 40);
  const [teacherId, setTeacherId] = useState(section?.classTeacherId ?? "");
  const create = useMutation(services.academics.createSection);
  const update = useMutation(services.academics.updateSection);
  const open = !!classId || !!section;
  const cls = d.classes.find((c) => c.id === (classId ?? section?.classId));
  const busy = new Set(d.classes.flatMap((c) => c.sections).filter((s) => s.id !== section?.id).map((s) => s.classTeacherId));
  const err = create.error ?? update.error;
  const save = async () => {
    const res = section
      ? await update.mutate(section.id, { room, capacity, classTeacherId: teacherId || null })
      : await create.mutate({ classId: classId!, name, room, capacity, classTeacherId: teacherId || null });
    if (res) { toast({ title: section ? "Section updated" : "Section created" }); onClose(); }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={section ? `Edit section ${section.label}` : `Add section to ${cls?.name}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending || update.isPending} onClick={save}>{section ? "Save" : "Create section"}</Button></>}>
      <div className="space-y-4">
        {!section && <FormField label="Section name" required error={create.fieldErrors.name} hint="A single letter, e.g. D"><Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={2} /></FormField>}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Room"><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room 120" /></FormField>
          <FormField label="Capacity"><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></FormField>
        </div>
        <FormField label="Class teacher" hint="The class teacher marks daily attendance for this section.">
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Not assigned</option>
            {d.teachers.map((t) => <option key={t.id} value={t.id} disabled={busy.has(t.id)}>{t.name}{busy.has(t.id) ? " (class teacher elsewhere)" : ""}</option>)}
          </Select>
        </FormField>
        <FormError error={err} />
      </div>
    </Modal>
  );
}

function ClassSubjectsModal({ cls, d, onClose }: { cls: Overview["classes"][number]; d: Overview; onClose: () => void }) {
  const { toast } = useToast();
  const [ids, setIds] = useState<string[]>(cls.subjectIds);
  const m = useMutation(services.academics.updateClassSubjects);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${cls.name} subjects`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={async () => { if (await m.mutate(cls.id, ids)) { toast({ title: "Subjects updated" }); onClose(); } }}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-2">
        {d.subjects.map((s) => <Checkbox key={s.id} label={s.name} description={s.code} checked={ids.includes(s.id)} onChange={(e) => setIds(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} />)}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Subjects

function SubjectsTab({ d }: { d: Overview }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", type: "elective" as "core" | "language" | "elective", classIds: [] as string[] });
  const m = useMutation(services.academics.createSubject);
  return (
    <Card>
      <CardHeader title="Subjects" description="Subjects offered across the school" action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add subject</Button>} />
      <div className="p-5">
        <DataTable
          rows={d.subjects}
          getRowId={(s) => s.id}
          columns={[
            { key: "name", header: "Subject", primary: true, cell: (s) => <span className="font-semibold text-ink">{s.name}</span> },
            { key: "code", header: "Code", cell: (s) => <span className="font-mono">{s.code}</span> },
            { key: "type", header: "Type", cell: (s) => <Badge tone={s.type === "core" ? "sapphire" : s.type === "language" ? "lavender" : "teal"}>{s.type}</Badge> },
            { key: "classes", header: "Classes", cell: (s) => `${s.classCount} classes` },
            { key: "teachers", header: "Teachers", cell: (s) => `${s.teacherCount} teachers` },
          ]}
        />
      </div>
      <Modal open={open} onOpenChange={setOpen} title="Add subject" size="sm"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={m.isPending} onClick={async () => { if (await m.mutate(form)) { toast({ title: "Subject added", description: "Assign teachers to it under Teacher assignments." }); setOpen(false); setForm({ name: "", code: "", type: "elective", classIds: [] }); } }}>Add subject</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Name" required error={m.fieldErrors.name} className="col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sanskrit" /></FormField>
            <FormField label="Code" required error={m.fieldErrors.code}><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={4} placeholder="SKT" /></FormField>
          </div>
          <FormField label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}><option value="core">Core</option><option value="language">Language</option><option value="elective">Elective</option></Select></FormField>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-soft">Offer in classes</legend>
            <div className="grid grid-cols-3 gap-2">{d.classes.map((c) => <Checkbox key={c.id} label={c.name} checked={form.classIds.includes(c.id)} onChange={(e) => setForm({ ...form, classIds: e.target.checked ? [...form.classIds, c.id] : form.classIds.filter((x) => x !== c.id) })} />)}</div>
          </fieldset>
          <FormError error={m.error} />
        </div>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ Enrollments

function EnrollmentsTab({ d }: { d: Overview }) {
  const { toast } = useToast();
  const allSections = d.classes.flatMap((c) => c.sections);
  const [sectionId, setSectionId] = useState(allSections[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const roster = useQuery(() => services.academics.getSectionRoster(sectionId), [sectionId], { enabled: !!sectionId });
  const enroll = useMutation(services.academics.enrollStudents);
  const section = allSections.find((s) => s.id === sectionId);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title="Not yet enrolled" description={`Active students without a section in ${d.year.name}`} />
        <div className="space-y-3 p-5">
          {d.unenrolled.length === 0 ? <EmptyState title="Everyone is enrolled" description="New students added from the Students module are enrolled at creation." /> : (
            <>
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {d.unenrolled.map((s) => (
                  <li key={s.id}><Checkbox label={s.name} description={s.admissionNo} checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} /></li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Select aria-label="Target section" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose section</option>
                  {allSections.map((s) => <option key={s.id} value={s.id}>Class {s.label}</option>)}
                </Select>
                <Button disabled={!target || !selected.length} loading={enroll.isPending} onClick={async () => { if (await enroll.mutate(target, selected)) { toast({ title: `${selected.length} student(s) enrolled` }); setSelected([]); } }}>Enroll</Button>
              </div>
            </>
          )}
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader
          title={section ? `Class ${section.label} roster` : "Section roster"}
          description={section ? `${section.studentCount} students · ${section.classTeacherName ?? "no class teacher"}` : undefined}
          action={<Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-36">{allSections.map((s) => <option key={s.id} value={s.id}>Class {s.label}</option>)}</Select>}
        />
        <div className="p-5">
          <QueryView query={roster} loading="inline">
            {(rows) => rows.length === 0 ? <EmptyState title="No students in this section" /> : (
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {rows.map((s) => (
                  <li key={s.id} className="flex items-center justify-between border-b border-line/50 py-2 text-sm">
                    <span><span className="mr-2 inline-block w-6 text-[12px] text-ink-muted">{s.rollNo}</span><span className="font-medium text-ink">{s.name}</span></span>
                    <span className="font-mono text-[11.5px] text-ink-muted">{s.admissionNo}</span>
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Teacher assignments

function AssignmentsTab({ d }: { d: Overview }) {
  const { toast } = useToast();
  const [classId, setClassId] = useState(d.classes.find((c) => c.grade === 10)?.id ?? d.classes[0]?.id ?? "");
  const cls = d.classes.find((c) => c.id === classId);
  const teacherById = useMemo(() => Object.fromEntries(d.teachers.map((t) => [t.id, t])), [d.teachers]);

  if (!cls) return <Card><EmptyState title="Create classes first" /></Card>;
  return (
    <Card>
      <CardHeader
        title="Teacher assignments"
        description="Choose who teaches each subject in each section. The teacher sees the class, its students, attendance and marks entry immediately."
        action={<Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} className="w-36">{d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
      />
      <div className="overflow-x-auto p-5">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{cls.name} teacher assignments</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-line bg-alabaster/60 px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted first:rounded-tl-xl">Subject</th>
              {cls.sections.map((s) => <th key={s.id} scope="col" className="border-b border-line bg-alabaster/60 px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted last:rounded-tr-xl">Section {s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {cls.subjects.map((sub) => (
              <tr key={sub.id}>
                <th scope="row" className="border-b border-line/50 px-3 py-2.5 text-left font-semibold text-ink">{sub.name}</th>
                {cls.sections.map((s) => {
                  const cov = s.subjectCoverage.find((x) => x.subjectId === sub.id);
                  const qualified = d.teachers.filter((t) => t.specializationIds.includes(sub.id));
                  return (
                    <td key={s.id} className="border-b border-line/50 px-3 py-2">
                      <Select
                        aria-label={`${sub.name} teacher for ${s.label}`}
                        value={cov?.teacherId ?? ""}
                        className={cn("h-9 text-[13px]", !cov?.teacherId && "border-mauve/60 bg-blush/20")}
                        onChange={async (e) => {
                          const teacherId = e.target.value;
                          if (!teacherId) return;
                          try {
                            await services.academics.assignTeacher({ sectionId: s.id, subjectId: sub.id, teacherId });
                            toast({ title: "Teacher assigned", description: `${teacherById[teacherId]?.name} → ${sub.name}, Class ${s.label}` });
                          } catch (err) {
                            toast({ title: "Could not assign", description: (err as Error).message, tone: "error" });
                          }
                        }}
                      >
                        <option value="">Unassigned</option>
                        {qualified.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.load})</option>)}
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[12.5px] text-ink-muted">Numbers in brackets show each teacher&apos;s current number of subject–section assignments. Only teachers qualified for a subject are listed.</p>
      </div>
    </Card>
  );
}
