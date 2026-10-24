"use client";
/**
 * Academics workspace.
 *  - Demo personas: the original demo-data workspace (academics-workspace-demo.tsx).
 *  - School accounts (live): Convex records via the school-aware hooks. Built on
 *    Trisha's Convex wiring (fec0ceb) and extended with the admin actions the
 *    demo workspace had: class teachers, subject teachers, class curriculum,
 *    the current academic year and enrolling students who have no section yet.
 *
 * Every action is enforced on the server (academics:manage / students:write,
 * school isolation, one class teacher per year, curriculum before assignment).
 * Roll numbers are assigned by the server; the roster is shown in the server's
 * canonical order (model/rollNumbers.ts) and is never re-sorted here.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookMarked, CalendarRange, Check, ChevronRight, GraduationCap, Layers, Loader2, Plus, School, Trash2, UserCheck, Users } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { useSession } from "@/features/auth/session-provider";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, FormField, GlassCard, Input, Modal, PageHeader,
  Select, StatusBadge, Tabs, TabsContent, TabsList, useToast,
} from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { DemoAcademicsWorkspace } from "./academics-workspace-demo";

export function AcademicsWorkspace() {
  const { dataSource } = useSession();
  return dataSource === "live" ? <LiveAcademicsWorkspace /> : <DemoAcademicsWorkspace />;
}

type Year = FunctionReturnType<typeof api.academics.listAcademicYears>[number];
type Klass = FunctionReturnType<typeof api.academics.listClasses>[number];
type Subject = FunctionReturnType<typeof api.academics.listSubjects>[number];
type Section = FunctionReturnType<typeof api.academics.listSections>[number];
type Teacher = FunctionReturnType<typeof api.academics.listTeachers>[number];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Spinner() {
  return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>;
}

function LiveAcademicsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [tab, setTab] = useState(params.get("tab") ?? "setup");
  // Enrolling students is Student Management (module entitlement); the rest of Academics setup is core.
  const studentsOn = useSession().hasModule("students");

  const years = useSchoolQuery(api.academics.listAcademicYears, {});
  const classes = useSchoolQuery(api.academics.listClasses, {});
  const subjects = useSchoolQuery(api.academics.listSubjects, {});
  const teachers = useSchoolQuery(api.academics.listTeachers, {});

  // The year being viewed: the chosen one, else the school's current year, else none (no invented fallback).
  const activeYear = useMemo<Year | null>(() => {
    if (!years || years.length === 0) return null;
    return years.find((y) => y._id === selectedYearId) ?? years.find((y) => y.isCurrent) ?? null;
  }, [years, selectedYearId]);
  const sections = useSchoolQuery(api.academics.listSections, activeYear ? { academicYearId: activeYear._id } : "skip");

  useEffect(() => {
    const t = params.get("tab");
    if (t) setTab(t);
  }, [params]);

  const changeTab = (t: string) => {
    setTab(t);
    router.replace(`/admin/academics?tab=${t}`, { scroll: false });
  };

  if (!years || !classes || !subjects || !teachers || (activeYear && sections === undefined)) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Academics"
        description="Set up the academic year: classes, sections, subjects, enrollments and teacher assignments."
        actions={years.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ay" className="text-[13px] text-ink-muted">Academic year</label>
            <Select id="ay" value={activeYear?._id ?? ""} onChange={(e) => setSelectedYearId(e.target.value)} className="w-52">
              {!activeYear && <option value="">Choose a year</option>}
              {years.map((y) => <option key={y._id} value={y._id}>{y.name}{y.isCurrent ? " (current)" : ""}</option>)}
            </Select>
          </div>
        )}
      />

      {!activeYear && (
        <div role="status" className="mb-5 rounded-xl border border-blush bg-blush/30 px-4 py-3 text-[13px] text-plum">
          {years.length === 0
            ? "No academic year exists yet. Create one in Academic years and make it current to start setting up classes and sections."
            : "The school has no current academic year. Choose a year above, or make one current in Academic years."}
        </div>
      )}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList
          items={[
            { value: "setup", label: "Setup overview" },
            { value: "years", label: "Academic years", count: years.length },
            { value: "classes", label: "Classes & sections", count: sections?.length ?? 0 },
            { value: "subjects", label: "Subjects", count: subjects.length },
            ...(studentsOn ? [{ value: "enrollments", label: "Enrollments" }] : []),
            { value: "assignments", label: "Teacher assignments" },
          ]}
        />
        <TabsContent value="setup">
          <SetupOverview years={years} year={activeYear} classes={classes} sections={sections ?? []} subjects={subjects} go={changeTab} studentsOn={studentsOn} />
        </TabsContent>
        <TabsContent value="years"><YearsTab years={years} /></TabsContent>
        <TabsContent value="classes">
          {activeYear ? <ClassesTab year={activeYear} classes={classes} sections={sections ?? []} subjects={subjects} teachers={teachers} /> : <NeedYear />}
        </TabsContent>
        <TabsContent value="subjects"><SubjectsTab subjects={subjects} /></TabsContent>
        {studentsOn && <TabsContent value="enrollments">
          {activeYear ? <EnrollmentsTab year={activeYear} sections={sections ?? []} /> : <NeedYear />}
        </TabsContent>}
        <TabsContent value="assignments">
          {activeYear ? <AssignmentsTab year={activeYear} sections={sections ?? []} teachers={teachers} /> : <NeedYear />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NeedYear() {
  return <Card><EmptyState icon={<CalendarRange className="h-6 w-6" />} title="No academic year selected" description="Create an academic year (or choose one) first." /></Card>;
}

/** Keeps a selected section id valid as the sections list changes (e.g. when switching years). */
function useSectionSelection(sections: Section[]) {
  const [sectionId, setSectionId] = useState<string>(sections[0]?._id ?? "");
  useEffect(() => {
    if (!sections.some((s) => s._id === sectionId)) setSectionId(sections[0]?._id ?? "");
  }, [sections, sectionId]);
  return [sectionId, setSectionId] as const;
}

// ------------------------------------------------------------------ Setup overview

function SetupOverview({ years, year, classes, sections, subjects, go, studentsOn }: { years: Year[]; year: Year | null; classes: Klass[]; sections: Section[]; subjects: Subject[]; go: (t: string) => void; studentsOn: boolean }) {
  const allSteps = [
    { tab: "years", Icon: CalendarRange, title: "Academic year", detail: year ? `${year.name} · ${formatDate(year.startDate)} – ${formatDate(year.endDate)}${year.isCurrent ? " (current)" : ""}` : "No current academic year", done: years.some((y) => y.isCurrent) },
    { tab: "classes", Icon: School, title: "Classes", detail: `${classes.length} classes created`, done: classes.length > 0 },
    { tab: "classes", Icon: Layers, title: "Sections", detail: year ? `${sections.length} sections in ${year.name}` : "—", done: sections.length > 0 },
    { tab: "subjects", Icon: BookMarked, title: "Subjects", detail: `${subjects.length} school subjects`, done: subjects.length > 0 },
    { tab: "enrollments", Icon: GraduationCap, title: "Enroll students", detail: "Place students in sections; roll numbers follow automatically", done: sections.length > 0 },
    { tab: "assignments", Icon: UserCheck, title: "Assign teachers", detail: "Class teachers and subject teachers", done: sections.length > 0 && sections.every((s) => s.classTeacherId) },
  ];
  const steps = allSteps.filter((s) => studentsOn || s.tab !== "enrollments");
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <GlassCard className="p-6 lg:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-sapphire">Year setup workflow</h2>
            <p className="text-sm text-ink-muted">Each step builds on the previous one. Changes flow straight to teachers&apos; and students&apos; views.</p>
          </div>
          <Badge tone={doneCount === steps.length ? "teal" : "lavender"}>{doneCount}/{steps.length} complete</Badge>
        </div>
        <ol className="mt-6 space-y-2">
          {steps.map((s, i) => (
            <li key={`${s.title}-${i}`}>
              <button onClick={() => go(s.tab)} className="group flex w-full items-center gap-4 rounded-2xl border border-white/80 bg-white/60 p-3.5 text-left transition-all hover:bg-white hover:shadow-soft">
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", s.done ? "bg-lagoon text-white" : "bg-heather/25 text-ink-soft")}>
                  {s.done ? <Check className="h-5 w-5" /> : <s.Icon className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Step {i + 1}</span>
                  <span className="block font-semibold text-ink">{s.title}</span>
                  <span className="block text-[13px] text-ink-muted">{s.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ol>
      </GlassCard>
      <Card className="h-fit p-5">
        <p className="text-[13px] font-medium text-ink-muted">Academic setup summary</p>
        <p className="mt-1 text-2xl font-semibold text-sapphire">{year?.name ?? "No year"}</p>
        <div className="mt-4 space-y-2 text-sm text-ink">
          <div className="flex justify-between"><span className="text-ink-muted">Classes</span><span className="font-semibold">{classes.length}</span></div>
          <div className="flex justify-between"><span className="text-ink-muted">Sections</span><span className="font-semibold">{sections.length}</span></div>
          <div className="flex justify-between"><span className="text-ink-muted">Subjects</span><span className="font-semibold">{subjects.length}</span></div>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Academic years

function YearsTab({ years }: { years: Year[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", makeCurrent: years.length === 0 });
  const [loading, setLoading] = useState(false);
  const [makeCurrent, setMakeCurrent] = useState<Year | null>(null);
  const createYear = useSchoolMutation(api.academics.createAcademicYear);
  const setCurrent = useSchoolMutation(api.academics.setCurrentAcademicYear);

  const handleCreate = async () => {
    const name = form.name.trim();
    if (!name || !form.startDate || !form.endDate) return toast({ title: "Please fill all fields", tone: "error" });
    if (form.endDate <= form.startDate) return toast({ title: "End date must be after start date", tone: "error" });
    setLoading(true);
    try {
      await createYear({ name, startDate: form.startDate, endDate: form.endDate, status: "planned", makeCurrent: form.makeCurrent });
      toast({ title: "Academic year created", description: form.makeCurrent ? `${name} is now the current year.` : `${name} is ready.` });
      setOpen(false);
      setForm({ name: "", startDate: "", endDate: "", makeCurrent: false });
    } catch (e) {
      toast({ title: "Could not create year", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Academic years" description="Only one year is current at a time. Attendance, admissions, fees and the portals use the current year." action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New year</Button>} />
      <div className="p-5">
        <DataTable
          rows={years}
          getRowId={(y) => y._id}
          empty={<EmptyState title="No academic years yet" />}
          columns={[
            { key: "name", header: "Year", primary: true, cell: (y) => <span className="font-semibold text-ink">{y.name}</span> },
            { key: "dates", header: "Duration", cell: (y) => `${formatDate(y.startDate)} – ${formatDate(y.endDate)}` },
            { key: "status", header: "Status", cell: (y) => (y.isCurrent ? <Badge tone="teal" dot>Current</Badge> : <StatusBadge status={y.status === "planned" ? "upcoming" : y.status === "closed" ? "archived" : y.status} />) },
          ]}
          rowActions={(y) => (!y.isCurrent && y.status !== "closed" ? <Button size="sm" variant="soft" onClick={() => setMakeCurrent(y)}>Make current</Button> : null)}
        />
      </div>

      <Modal open={open} onOpenChange={setOpen} title="Create academic year" size="sm"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={loading} onClick={handleCreate}>Create</Button></>}>
        <div className="space-y-4">
          <FormField label="Name" required hint="e.g. 2027–28"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts" required><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></FormField>
            <FormField label="Ends" required><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></FormField>
          </div>
          <Checkbox label="Make this the current academic year" checked={form.makeCurrent} onChange={(e) => setForm({ ...form, makeCurrent: e.target.checked })} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!makeCurrent}
        onOpenChange={(o) => !o && setMakeCurrent(null)}
        title={`Make ${makeCurrent?.name ?? ""} the current year?`}
        description="Attendance, new admissions, fees and the student portal will use this year from now on. The previous year is not closed automatically."
        confirmLabel="Make current"
        onConfirm={async () => {
          if (!makeCurrent) return;
          try {
            await setCurrent({ academicYearId: makeCurrent._id });
            toast({ title: `${makeCurrent.name} is now the current year` });
          } catch (e) {
            toast({ title: "Could not change the current year", description: errText(e), tone: "error" });
          }
          setMakeCurrent(null);
        }}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ Classes & sections

function ClassesTab({ year, classes, sections, subjects, teachers }: { year: Year; classes: Klass[]; sections: Section[]; subjects: Subject[]; teachers: Teacher[] }) {
  const { toast } = useToast();
  const [classOpen, setClassOpen] = useState(false);
  const [sectionFor, setSectionFor] = useState<Klass | null>(null);
  const [curriculumFor, setCurriculumFor] = useState<Klass | null>(null);
  const setClassTeacher = useSchoolMutation(api.academics.setClassTeacher);
  const sorted = [...classes].sort((a, b) => a.level - b.level);

  const changeClassTeacher = async (section: Section, teacherId: string) => {
    try {
      await setClassTeacher({ sectionId: section._id, teacherId: teacherId ? (teacherId as Id<"teachers">) : null });
      toast({ title: teacherId ? `Class teacher of ${section.displayName} updated` : `${section.displayName} has no class teacher now` });
    } catch (e) {
      toast({ title: "Could not change the class teacher", description: errText(e), tone: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2"><Button onClick={() => setClassOpen(true)}><Plus className="h-4 w-4" /> Add class</Button></div>
      {sorted.length === 0 ? (
        <Card><EmptyState title="No classes yet" description="Create classes to start setting up this academic year." action={<Button onClick={() => setClassOpen(true)}>Add class</Button>} /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sorted.map((c) => {
            const classSections = sections.filter((s) => s.classId === c._id);
            return (
              <Card key={c._id}>
                <CardHeader
                  title={c.name}
                  description={`${classSections.length} section(s) in ${year.name}`}
                  action={
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setCurriculumFor(c)}><BookMarked className="h-3.5 w-3.5" /> Subjects</Button>
                      <Button size="sm" variant="soft" onClick={() => setSectionFor(c)}><Plus className="h-3.5 w-3.5" /> Section</Button>
                    </div>
                  }
                />
                <ul className="grid gap-2.5 p-5 sm:grid-cols-2">
                  {classSections.map((s) => (
                    <li key={s._id} className="rounded-xl border border-line/70 bg-alabaster/50 p-3.5">
                      <p className="text-lg font-semibold text-sapphire">{s.displayName}</p>
                      <p className="text-[12.5px] text-ink-muted">Room: {s.room ?? "—"} · Capacity: {s.capacity ?? "—"}</p>
                      <label className="mt-2 block text-[11.5px] font-medium uppercase tracking-wide text-ink-muted" htmlFor={`ct-${s._id}`}>Class teacher</label>
                      <Select id={`ct-${s._id}`} value={s.classTeacherId ?? ""} onChange={(e) => changeClassTeacher(s, e.target.value)} className="mt-1 h-9 text-[13px]">
                        <option value="">— None —</option>
                        {teachers.map((t) => <option key={t.teacherId} value={t.teacherId}>{t.name}</option>)}
                      </Select>
                    </li>
                  ))}
                  {classSections.length === 0 && <li className="col-span-2 py-2 text-center text-sm text-ink-muted">No sections yet in this class for {year.name}.</li>}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <AddClassModal open={classOpen} onOpenChange={setClassOpen} existingLevels={classes.map((c) => c.level)} />
      {sectionFor && <AddSectionModal year={year} klass={sectionFor} onClose={() => setSectionFor(null)} />}
      {curriculumFor && <CurriculumModal year={year} klass={curriculumFor} subjects={subjects} onClose={() => setCurriculumFor(null)} />}
    </div>
  );
}

function AddClassModal({ open, onOpenChange, existingLevels }: { open: boolean; onOpenChange: (o: boolean) => void; existingLevels: number[] }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [level, setLevel] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const createClass = useSchoolMutation(api.academics.createClass);
  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || level === "") return toast({ title: "Class name and level are required", tone: "error" });
    if (existingLevels.includes(level)) return toast({ title: `A class with level ${level} already exists`, tone: "error" });
    setLoading(true);
    try {
      await createClass({ name: trimmed, level });
      toast({ title: "Class created" });
      onOpenChange(false);
      setName("");
      setLevel("");
    } catch (e) {
      toast({ title: "Could not create class", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add class" size="sm" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={loading} onClick={handleCreate}>Create class</Button></>}>
      <div className="space-y-4">
        <FormField label="Class name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grade 6" /></FormField>
        <FormField label="Level (numeric)" required hint="0–20; one class per level"><Input type="number" min={0} max={20} value={level} onChange={(e) => setLevel(e.target.value === "" ? "" : Number(e.target.value))} /></FormField>
      </div>
    </Modal>
  );
}

function AddSectionModal({ year, klass, onClose }: { year: Year; klass: Klass; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [capacity, setCapacity] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const createSection = useSchoolMutation(api.academics.createSection);
  const handleCreate = async () => {
    if (!name.trim()) return toast({ title: "Section name is required", tone: "error" });
    if (capacity !== "" && (!Number.isInteger(capacity) || capacity < 1)) return toast({ title: "Capacity must be a positive whole number", tone: "error" });
    setLoading(true);
    try {
      await createSection({ academicYearId: year._id, classId: klass._id, name: name.trim().toUpperCase(), room: room.trim() || undefined, capacity: capacity === "" ? undefined : capacity });
      toast({ title: `Section ${klass.level}-${name.trim().toUpperCase()} created` });
      onClose();
    } catch (e) {
      toast({ title: "Could not create section", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Add section to ${klass.name}`} description={year.name} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={handleCreate}>Create section</Button></>}>
      <div className="space-y-4">
        <FormField label="Section name" required hint="e.g. A, B, C"><Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={3} /></FormField>
        <FormField label="Room"><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Optional" /></FormField>
        <FormField label="Capacity"><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Optional" /></FormField>
      </div>
    </Modal>
  );
}

/** The subjects a class studies in the selected year (classSubjects). Subject teachers can only be assigned to these. */
function CurriculumModal({ year, klass, subjects, onClose }: { year: Year; klass: Klass; subjects: Subject[]; onClose: () => void }) {
  const { toast } = useToast();
  const current = useSchoolQuery(api.academics.listClassSubjects, { classId: klass._id, academicYearId: year._id });
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);
  const setClassSubjects = useSchoolMutation(api.academics.setClassSubjects);
  useEffect(() => { if (current && chosen === null) setChosen(new Set(current.map((s) => s.subjectId as string))); }, [current, chosen]);
  const save = async () => {
    if (!chosen) return;
    setLoading(true);
    try {
      const r = await setClassSubjects({ classId: klass._id, academicYearId: year._id, subjectIds: [...chosen] as Id<"subjects">[] });
      toast({ title: "Curriculum saved", description: `${r.added} added · ${r.removed} removed` });
      onClose();
    } catch (e) {
      toast({ title: "Could not save the curriculum", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${klass.name} subjects`} description={`Curriculum for ${year.name}. A subject that still has a teacher assigned cannot be removed.`} size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={loading} disabled={!chosen} onClick={save}>Save</Button></>}>
      {!chosen ? <Spinner /> : subjects.length === 0 ? <EmptyState title="No subjects yet" description="Add subjects in the Subjects tab first." /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {subjects.filter((s) => s.active || chosen.has(s._id)).map((s) => (
            <Checkbox key={s._id} label={`${s.name} (${s.code})`} checked={chosen.has(s._id)} onChange={(e) => {
              const next = new Set(chosen);
              if (e.target.checked) next.add(s._id);
              else next.delete(s._id);
              setChosen(next);
            }} />
          ))}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Subjects

function SubjectsTab({ subjects }: { subjects: Subject[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const createSubject = useSchoolMutation(api.academics.createSubject);
  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedName || !trimmedCode) return toast({ title: "Please fill all fields", tone: "error" });
    setLoading(true);
    try {
      await createSubject({ name: trimmedName, code: trimmedCode });
      toast({ title: "Subject created", description: `${trimmedName} (${trimmedCode}) added.` });
      setOpen(false);
      setName("");
      setCode("");
    } catch (e) {
      toast({ title: "Could not create subject", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Subjects" description="Subjects offered across the school. Add them to each class's curriculum in Classes & sections." action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add subject</Button>} />
      <div className="p-5">
        <DataTable
          rows={[...subjects].sort((a, b) => a.name.localeCompare(b.name))}
          getRowId={(s) => s._id}
          empty={<EmptyState title="No subjects yet" />}
          columns={[
            { key: "name", header: "Subject", primary: true, cell: (s) => <span className="font-semibold text-ink">{s.name}</span> },
            { key: "code", header: "Code", cell: (s) => <span className="font-mono">{s.code}</span> },
            { key: "status", header: "Status", cell: (s) => (s.active ? <Badge tone="teal">Active</Badge> : <Badge tone="lavender">Inactive</Badge>) },
          ]}
        />
      </div>
      <Modal open={open} onOpenChange={setOpen} title="Add subject" size="sm" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={loading} onClick={handleCreate}>Add</Button></>}>
        <div className="space-y-4">
          <FormField label="Subject name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Science" /></FormField>
          <FormField label="Code" required><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="SCI" /></FormField>
        </div>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ Enrollments

function EnrollmentsTab({ year, sections }: { year: Year; sections: Section[] }) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const roster = useSchoolQuery(api.academics.sectionRoster, sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip");
  const unenrolled = useSchoolQuery(api.academics.listUnenrolledStudents, { academicYearId: year._id });
  const enroll = useSchoolMutation(api.academics.enrollStudent);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const startDate = today < year.startDate ? year.startDate : today > year.endDate ? year.endDate : today;

  const enrolSelected = async () => {
    if (!target || selected.size === 0) return;
    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const studentId of selected) {
      try {
        await enroll({ studentId: studentId as Id<"students">, sectionId: target as Id<"sections">, startDate });
        done++;
      } catch (e) {
        failed.push(errText(e));
      }
    }
    setBusy(false);
    setSelected(new Set());
    const section = sections.find((s) => s._id === target);
    if (done) toast({ title: `${done} student${done === 1 ? "" : "s"} enrolled in ${section?.displayName ?? "the section"}`, description: "Roll numbers were updated alphabetically." });
    if (failed.length) toast({ title: `${failed.length} could not be enrolled`, description: failed[0], tone: "error" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Section roster & roll numbers"
          description="Students in roll-number order. Roll numbers are assigned by the system alphabetically (first name, then last name)."
          action={
            <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-48" disabled={sections.length === 0}>
              {sections.map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
            </Select>
          }
        />
        <div className="p-5">
          {!sectionId ? <EmptyState title="No sections available" description="Create a section first." />
            : roster === undefined ? <Spinner />
            : roster.students.length === 0 ? <EmptyState title="No students in this section" description="Enroll students below to populate the roster." />
            : (
              // Server order = roll-number order; rendered as-is (never re-sorted on the client).
              <ul className="divide-y divide-line/60" data-testid="live-roster">
                {roster.students.map((s) => (
                  <li key={s.studentId} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-center text-sm font-bold text-sapphire">{s.rollNo ?? "—"}</span>
                      <div><p className="font-medium text-ink">{s.name}</p><p className="text-[12px] text-ink-muted">Adm: {s.admissionNo}</p></div>
                    </div>
                    <Badge tone="teal">Enrolled</Badge>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Not yet enrolled" description={`Active students with no section in ${year.name}.`} icon={<Users className="h-4 w-4" />} />
        <div className="p-5">
          {unenrolled === undefined ? <Spinner /> : unenrolled.students.length === 0 ? (
            <EmptyState title="Everyone is enrolled" description="Every active student has a section this year." />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Enroll selected into">
                  <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-48">
                    <option value="">Choose a section</option>
                    {sections.map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
                  </Select>
                </FormField>
                <Button loading={busy} disabled={!target || selected.size === 0} onClick={enrolSelected}>Enroll {selected.size || ""}</Button>
                <span className="text-[12.5px] text-ink-muted">Start date {formatDate(startDate)}</span>
              </div>
              {unenrolled.truncated && <p className="text-[12.5px] text-plum">Showing the first {unenrolled.students.length} of {unenrolled.total}.</p>}
              <ul className="grid gap-2 sm:grid-cols-2">
                {unenrolled.students.map((s) => (
                  <li key={s.studentId} className="rounded-xl border border-line/70 px-3 py-2">
                    <Checkbox label={`${s.name} · ${s.admissionNo}`} checked={selected.has(s.studentId)} onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(s.studentId);
                      else next.delete(s.studentId);
                      setSelected(next);
                    }} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Teacher assignments

function AssignmentsTab({ year, sections, teachers }: { year: Year; sections: Section[]; teachers: Teacher[] }) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const section = sections.find((s) => s._id === sectionId) ?? null;
  const assignments = useSchoolQuery(api.academics.listTeacherAssignments, section ? { sectionId: section._id } : "skip");
  const curriculum = useSchoolQuery(api.academics.listClassSubjects, section ? { classId: section.classId, academicYearId: year._id } : "skip");
  const assign = useSchoolMutation(api.academics.assignSubjectTeacher);
  const remove = useSchoolMutation(api.academics.removeTeacherAssignment);

  const rows = useMemo(() => {
    if (!curriculum || !assignments) return undefined;
    const bySubject = new Map(assignments.map((a) => [a.subjectId as string, a]));
    const list = curriculum.map((s) => ({ subjectId: s.subjectId, subjectName: s.name, assignment: bySubject.get(s.subjectId) ?? null }));
    // Assignments whose subject left the curriculum are still shown so they can be removed.
    for (const a of assignments) if (!curriculum.some((s) => s.subjectId === a.subjectId)) list.push({ subjectId: a.subjectId, subjectName: `${a.subjectName ?? "Subject"} (not in curriculum)`, assignment: a });
    return list;
  }, [curriculum, assignments]);

  const change = async (subjectId: Id<"subjects">, teacherId: string, current: { _id: Id<"teacherAssignments"> } | null) => {
    if (!section) return;
    try {
      if (!teacherId) {
        if (current) await remove({ assignmentId: current._id });
        toast({ title: "Assignment removed" });
      } else {
        await assign({ sectionId: section._id, subjectId, teacherId: teacherId as Id<"teachers"> });
        toast({ title: "Subject teacher assigned" });
      }
    } catch (e) {
      toast({ title: "Could not change the assignment", description: errText(e), tone: "error" });
    }
  };

  return (
    <Card>
      <CardHeader
        title="Teacher assignments"
        description={section ? `Class teacher: ${section.classTeacherName ?? "none (set it in Classes & sections)"}. Subject teachers mark marks, set homework and appear in the timetable.` : "Subject teachers for each section."}
        action={
          <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-48" disabled={sections.length === 0}>
            {sections.map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
          </Select>
        }
      />
      <div className="p-5">
        {!section ? <EmptyState title="No sections available" />
          : rows === undefined ? <Spinner />
          : rows.length === 0 ? <EmptyState title="No subjects in this class's curriculum" description="Add subjects to the class in Classes & sections → Subjects, then assign teachers here." />
          : (
            <DataTable
              rows={rows}
              getRowId={(r) => r.subjectId}
              columns={[
                { key: "subject", header: "Subject", primary: true, cell: (r) => <span className="font-semibold text-ink">{r.subjectName}</span> },
                {
                  key: "teacher", header: "Teacher", cell: (r) => (
                    <Select aria-label={`Teacher for ${r.subjectName}`} value={r.assignment?.teacherId ?? ""} onChange={(e) => change(r.subjectId, e.target.value, r.assignment)} className="h-9 w-56 text-[13px]">
                      <option value="">— Unassigned —</option>
                      {teachers.map((t) => <option key={t.teacherId} value={t.teacherId}>{t.name}</option>)}
                    </Select>
                  ),
                },
              ]}
              rowActions={(r) => (r.assignment ? <Button size="sm" variant="ghost" aria-label={`Remove ${r.subjectName} assignment`} onClick={() => change(r.subjectId, "", r.assignment)}><Trash2 className="h-4 w-4" /></Button> : null)}
            />
          )}
      </div>
    </Card>
  );
}
