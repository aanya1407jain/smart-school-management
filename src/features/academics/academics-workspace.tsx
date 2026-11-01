"use client";
/**
 * Academics workspace (Core shell): school structure — academic years,
 * classes, sections and class teachers — with the year setup cockpit.
 *  - Demo personas: the internal demo workspace (DemoSlot "academics.workspace").
 *  - School accounts (live): Convex records via the school-aware hooks.
 * Subjects, curriculum, subject teachers and pacing (Academics) and student
 * enrollment (Students) are tabs contributed by those modules when they are
 * shipped in the build (src/lib/contributions); the cockpit reads their
 * figures through academics.setupStatus (providers).
 *
 * Every action is enforced on the server (academics:manage / students:write,
 * school isolation, one class teacher per year, curriculum before assignment).
 */
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookMarked, ChevronDown, Plus, School } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { useSession } from "@/features/auth/session-provider";
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, EmptyState, FormField, Input, Modal, PageHeader, Select, StatusBadge, Tabs, TabsContent, TabsList, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { SetupCockpit, type CockpitStep } from "./setup-cockpit";
import { NeedYear, Spinner, errText, type Klass, type Section, type Teacher, type Year } from "@/features/academics/workspace-kit";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { contributionsTo, type AcademicsSetupCtx } from "@/lib/contributions";

export function AcademicsWorkspace() {
  const { dataSource } = useSession();
  return (
    <div className="space-y-6">
      {dataSource === "live" ? <LiveAcademicsWorkspace /> : <DemoSlot id="academics.workspace" />}
    </div>
  );
}

type SetupTab = { value: string; label: string; order: number; count?: number; Content: ComponentType<{ ctx: AcademicsSetupCtx }> };

function LiveAcademicsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const { hasModule } = useSession();
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const parts = contributionsTo("academicsSetup", hasModule);

  const years = useSchoolQuery(api.academics.listAcademicYears, {});
  const classes = useSchoolQuery(api.academics.listClasses, {});
  const teachers = useSchoolQuery(api.academics.listTeachers, {});
  // Module figures for the cockpit (subjects: Academics; enrollment: Students), null when not shipped / enabled.
  const status = useSchoolQuery(api.academics.setupStatus, {});

  // The year being viewed: the chosen one, else the school's current year, else none (no invented fallback).
  const activeYear = useMemo<Year | null>(() => {
    if (!years || years.length === 0) return null;
    return years.find((y) => y._id === selectedYearId) ?? years.find((y) => y.isCurrent) ?? null;
  }, [years, selectedYearId]);
  const sections = useSchoolQuery(api.academics.listSections, activeYear ? { academicYearId: activeYear._id } : "skip");
  const action = params.get("action");

  const sectionList = sections ?? [];
  const counts: Record<string, number | undefined> = { subjects: status?.subjects ?? undefined, enrollments: status?.enrollment?.enrolled ?? undefined };
  const tabs: SetupTab[] = [
    { value: "years", label: "Academic years", order: 10, count: years?.length, Content: () => <YearsTab years={years ?? []} /> },
    { value: "classes", label: "Classes & sections", order: 20, count: sectionList.length, Content: ({ ctx }: { ctx: AcademicsSetupCtx }) => (ctx.year ? <ClassesTab year={ctx.year} classes={classes ?? []} sections={ctx.sections} teachers={ctx.teachers} autoOpen={ctx.action === "add-class"} /> : <NeedYear />) },
    ...parts.flatMap((c) => c.tabs.map((t) => ({ ...t, count: counts[t.value] }))),
  ].sort((a, b) => a.order - b.order);
  const has = (t: string) => tabs.some((x) => x.value === t);
  const [tab, setTab] = useState(params.get("tab") ?? "");
  const current = has(tab) ? tab : tabs[0].value;

  useEffect(() => {
    const t = params.get("tab");
    if (t) setTab(t);
  }, [params]);

  const changeTab = (t: string, extra = "") => {
    setTab(t);
    router.replace(`/admin/academics?tab=${t}${extra}`, { scroll: false });
  };
  // Stepper / command-bar navigation: open the tab and bring it into view.
  const openTab = (t: string, extra = "") => {
    changeTab(t, extra);
    requestAnimationFrame(() => document.getElementById("academics-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (!years || !classes || !teachers || status === undefined || (activeYear && sections === undefined)) return <Spinner />;

  const assigned = sectionList.filter((sec) => sec.classTeacherId).length;
  const enrollment = status.enrollment;
  const steps: CockpitStep[] = [
    { tab: "years", key: "years", title: "Academic year", metric: null, detail: activeYear ? `${activeYear.name}${activeYear.isCurrent ? " (current)" : ""} · ${formatDate(activeYear.startDate)} – ${formatDate(activeYear.endDate)}` : "No current academic year", done: years.some((y) => y.isCurrent) },
    { tab: "classes", key: "classes", title: "Classes", metric: String(classes.length), detail: `${classes.length} class${classes.length === 1 ? "" : "es"} created`, done: classes.length > 0 },
    { tab: "classes", key: "sections", title: "Sections", metric: String(sectionList.length), detail: activeYear ? `${sectionList.length} sections in ${activeYear.name}` : "—", done: sectionList.length > 0 },
    ...(status.subjects !== null && has("subjects") ? [{ tab: "subjects", key: "subjects", title: "Subjects", metric: String(status.subjects), detail: `${status.subjects} school subjects`, done: status.subjects > 0 }] : []),
    ...(enrollment && has("enrollments") ? [{ tab: "enrollments", key: "enrollments", title: "Enrollments", metric: String(enrollment.enrolled), detail: "Students placed in sections; roll numbers follow automatically", done: enrollment.enrolled > 0 && enrollment.notEnrolled === 0 }] : []),
    { tab: has("assignments") ? "assignments" : "classes", key: "assignments", title: has("assignments") ? "Teacher assignments" : "Class teachers", metric: sectionList.length ? `${Math.round((assigned / sectionList.length) * 100)}%` : null, detail: has("assignments") ? "Class teachers and subject teachers" : "A class teacher for every section", done: sectionList.length > 0 && assigned === sectionList.length },
  ];
  const ctx: AcademicsSetupCtx = { year: activeYear, sections: sectionList, teachers, action };
  const Current = tabs.find((t) => t.value === current)!;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Academic Operations & Curriculum"
        description="Manage class structures, teacher assignments, and real-time curriculum pacing."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {years.length > 0 && (
              <Select aria-label="Academic year" title="Academic year" value={activeYear?._id ?? ""} onChange={(e) => setSelectedYearId(e.target.value)} className="w-56">
                {!activeYear && <option value="">Choose a year</option>}
                {years.map((y) => <option key={y._id} value={y._id}>{`${y.name}${y.isCurrent ? " (current)" : ""}`}</option>)}
              </Select>
            )}
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button><Plus className="h-4 w-4" /> {has("subjects") ? "Add class / subject" : "Add class"} <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden /></Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem onSelect={() => openTab("classes", "&action=add-class")} className={cn(!activeYear && "pointer-events-none opacity-50")}><School className="h-4 w-4" /> Add class</DropdownItem>
                {has("subjects") && <DropdownItem onSelect={() => openTab("subjects", "&action=add-subject")}><BookMarked className="h-4 w-4" /> Add subject</DropdownItem>}
              </DropdownContent>
            </DropdownMenu>
          </div>
        }
      />

      {!activeYear && (
        <div role="status" className="rounded-xl border border-blush bg-blush/30 px-4 py-3 text-[13px] text-plum">
          {years.length === 0
            ? "No academic year exists yet. Create one in Academic years and make it current to start setting up classes and sections."
            : "The school has no current academic year. Choose a year above, or make one current in Academic years."}
        </div>
      )}

      <SetupCockpit
        steps={steps}
        onStep={(t) => openTab(t)}
        coverage={{
          pct: sectionList.length ? (assigned / sectionList.length) * 100 : null,
          caption: sectionList.length === 0 ? "No sections yet" : assigned === sectionList.length ? `All ${sectionList.length} sections have a class teacher` : `${assigned} of ${sectionList.length} sections have a class teacher`,
        }}
        enrollment={enrollment ? { enrolled: enrollment.enrolled, active: enrollment.activeRecords, caption: `${enrollment.activeRecords ? Math.round((enrollment.enrolled / enrollment.activeRecords) * 100) : 0}% of active students placed in ${enrollment.academicYear}` } : null}
      />

      <div id="academics-tabs" className="scroll-mt-20">
        <Tabs value={current} onValueChange={(t) => changeTab(t)}>
          <TabsList items={tabs.map(({ value, label, count }) => ({ value, label, ...(count !== undefined ? { count } : {}) }))} />
          <TabsContent value={current}><Current.Content ctx={ctx} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

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

function ClassesTab({ year, classes, sections, teachers, autoOpen = false }: { year: Year; classes: Klass[]; sections: Section[]; teachers: Teacher[]; autoOpen?: boolean }) {
  const { toast } = useToast();
  const [classOpen, setClassOpen] = useState(autoOpen);
  useEffect(() => { if (autoOpen) setClassOpen(true); }, [autoOpen]);
  const [sectionFor, setSectionFor] = useState<Klass | null>(null);
  // Class actions contributed by modules (Academics: the class curriculum).
  const { hasModule } = useSession();
  const classActions = contributionsTo("academicsSetup", hasModule).flatMap((c) => (c.ClassAction ? [c.ClassAction] : []));
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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sorted.map((c) => {
            const classSections = sections.filter((s) => s.classId === c._id);
            return (
              <Card key={c._id}>
                <CardHeader
                  title={c.name}
                  description={`${classSections.length} section(s) in ${year.name}`}
                  action={
                    <div className="flex gap-1.5">
                      {classActions.map((A, i) => <A key={i} year={year} klass={c} />)}
                      <Button size="sm" variant="soft" onClick={() => setSectionFor(c)}><Plus className="h-3.5 w-3.5" /> Section</Button>
                    </div>
                  }
                />
                <ul className="grid grid-cols-1 gap-2.5 p-5 sm:grid-cols-2">
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
                  {classSections.length === 0 && <li className="col-span-full py-2 text-center text-sm text-ink-muted">No sections yet in this class for {year.name}.</li>}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <AddClassModal open={classOpen} onOpenChange={setClassOpen} existingLevels={classes.map((c) => c.level)} />
      {sectionFor && <AddSectionModal year={year} klass={sectionFor} onClose={() => setSectionFor(null)} />}
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
