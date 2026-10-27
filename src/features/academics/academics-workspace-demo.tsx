"use client";
/**
 * Academics workspace for DEMO personas (in-browser demo data). Kept unchanged
 * from before the Convex wiring; school accounts use the live workspace in
 * academics-workspace.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookMarked, ChevronDown, Pencil, Plus, School, Users } from "lucide-react";
import { services } from "@/lib/services";
import type { AcademicsOverview } from "@/lib/services/academics.service";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, EmptyState, FormField, Input, Modal, PageHeader,
  QueryView, Select, StatusBadge, Tabs, TabsContent, TabsList, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { SyllabusProgressTracker } from "./syllabus-tracker";
import { SetupCockpit, type CockpitStep } from "./setup-cockpit";

type Overview = AcademicsOverview;

export function DemoAcademicsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState(params.get("tab") ?? "setup");
  const q = useQuery(() => services.academics.getOverview(yearId), [yearId]);

  useEffect(() => { const t = params.get("tab"); if (t) setTab(t); }, [params]);
  const action = params.get("action");
  const changeTab = (t: string, extra = "") => { setTab(t); router.replace(`/admin/academics?tab=${t}${extra}`, { scroll: false }); };
  // Stepper / command-bar navigation: open the tab and bring it into view.
  const openTab = (t: string, extra = "") => {
    changeTab(t, extra);
    requestAnimationFrame(() => document.getElementById("academics-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Academic Operations & Curriculum"
        description="Manage class structures, teacher assignments, and real-time curriculum pacing."
        actions={q.data && (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Academic year" title="Academic year" value={q.data.year.id} onChange={(e) => setYearId(e.target.value)} className="w-56">
              {q.data.years.map((y) => <option key={y.id} value={y.id}>{`${y.name}${y.isCurrent ? " (current)" : ""}`}</option>)}
            </Select>
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button><Plus className="h-4 w-4" /> Add class / subject <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden /></Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem onSelect={() => openTab("classes", "&action=add-class")}><School className="h-4 w-4" /> Add class</DropdownItem>
                <DropdownItem onSelect={() => openTab("subjects", "&action=add-subject")}><BookMarked className="h-4 w-4" /> Add subject</DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          </div>
        )}
      />
      <QueryView query={q}>
        {(d) => (
          <div className="space-y-5">
            <SetupCockpit
              steps={setupSteps(d)}
              onStep={(t) => openTab(t)}
              coverage={{ pct: d.progress.sections ? d.progress.assignmentCoverage : null, caption: d.progress.openSlots ? `${d.progress.openSlots} subject slot${d.progress.openSlots === 1 ? "" : "s"} still need a teacher` : `All ${d.progress.sections} sections fully assigned` }}
              enrollment={{ enrolled: d.progress.enrolled, active: d.progress.activeStudents, caption: d.unenrolled.length ? `${d.unenrolled.length} active student${d.unenrolled.length === 1 ? " is" : "s are"} not enrolled in ${d.year.name}` : `${d.progress.activeStudents ? Math.round((d.progress.enrolled / d.progress.activeStudents) * 100) : 0}% of the active roster mapped` }}
            />
            <div id="academics-tabs" className="scroll-mt-20">
              <Tabs value={tab} onValueChange={(t) => changeTab(t)}>
                <TabsList items={[
                  { value: "setup", label: "Overview" },
                  { value: "years", label: "Academic years", count: d.years.length },
                  { value: "classes", label: "Classes & sections", count: d.progress.sections },
                  { value: "subjects", label: "Subjects", count: d.subjects.length },
                  { value: "enrollments", label: "Enrollments", count: d.progress.enrolled },
                  { value: "assignments", label: "Teacher assignments" },
                ]} />
                {/* Overview: curriculum pacing (Principal view, read-only; the same tracker as the live workspace). */}
                <TabsContent value="setup"><SyllabusProgressTracker readOnly={true} /></TabsContent>
                <TabsContent value="years"><YearsTab d={d} /></TabsContent>
                <TabsContent value="classes"><ClassesTab d={d} autoOpen={action === "add-class"} /></TabsContent>
                <TabsContent value="subjects"><SubjectsTab d={d} autoOpen={action === "add-subject"} /></TabsContent>
                <TabsContent value="enrollments"><EnrollmentsTab d={d} /></TabsContent>
                <TabsContent value="assignments"><AssignmentsTab d={d} /></TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </QueryView>
    </div>
  );
}

// ------------------------------------------------------------------ Setup steps (cockpit)

function setupSteps(d: Overview): CockpitStep[] {
  return [
    { tab: "years", key: "years", title: "Academic year", metric: null, detail: `${d.year.name} · ${formatDate(d.year.startDate)} – ${formatDate(d.year.endDate)}`, done: true },
    { tab: "classes", key: "classes", title: "Classes", metric: String(d.progress.classes), detail: `${d.progress.classes} classes`, done: d.progress.classes > 0 },
    { tab: "classes", key: "sections", title: "Sections", metric: String(d.progress.sections), detail: `${d.progress.sections} sections`, done: d.progress.sections > 0 },
    { tab: "subjects", key: "subjects", title: "Subjects", metric: String(d.progress.subjects), detail: `${d.progress.subjects} subjects`, done: d.progress.subjects > 0 },
    { tab: "enrollments", key: "enrollments", title: "Enrollments", metric: String(d.progress.enrolled), detail: `${d.progress.enrolled} of ${d.progress.activeStudents} active students`, done: d.progress.enrolled > 0 && d.unenrolled.length === 0 },
    { tab: "assignments", key: "assignments", title: "Teacher assignments", metric: `${Math.round(d.progress.assignmentCoverage)}%`, detail: `${Math.round(d.progress.assignmentCoverage)}% of subject slots covered`, done: d.progress.openSlots === 0 && d.progress.sections > 0 },
  ];
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

function ClassesTab({ d, autoOpen = false }: { d: Overview; autoOpen?: boolean }) {
  const { toast } = useToast();
  const [classOpen, setClassOpen] = useState(autoOpen);
  useEffect(() => { if (autoOpen) setClassOpen(true); }, [autoOpen]);
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

function SubjectsTab({ d, autoOpen = false }: { d: Overview; autoOpen?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
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
