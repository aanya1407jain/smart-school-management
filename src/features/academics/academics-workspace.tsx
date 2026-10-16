"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookMarked, CalendarRange, Check, ChevronRight, GraduationCap,
  Layers, Plus, School, UserCheck, Loader2
} from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Badge, Button, Card, CardHeader, DataTable,
  EmptyState, FormField, GlassCard, Input, Modal, PageHeader,
  Select, StatusBadge, Tabs, TabsContent, TabsList, useToast,
} from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

// Must match the backend validator:
// v.union(v.literal("planned"), v.literal("active"), v.literal("closed"))
type AcademicYearStatus = "planned" | "active" | "closed";
const NEW_YEAR_STATUS: AcademicYearStatus = "planned";

// Locale-aware, case-insensitive A→Z comparison for names
const nameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function AcademicsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();

  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [tab, setTab] = useState(params.get("tab") ?? "setup");

  // Real Convex queries
  const years = useQuery(api.academics.listAcademicYears);
  const classes = useQuery(api.academics.listClasses);
  const subjects = useQuery(api.academics.listSubjects);

  const activeYear = useMemo(() => {
    if (!years || years.length === 0) return null;
    if (selectedYearId) return years.find((y) => y._id === selectedYearId) ?? years[0];
    return years.find((y) => y.isCurrent) ?? years[0];
  }, [years, selectedYearId]);

  const sections = useQuery(
    api.academics.listSections,
    activeYear ? { academicYearId: activeYear._id } : "skip"
  );

  useEffect(() => {
    const t = params.get("tab");
    if (t) setTab(t);
  }, [params]);

  const changeTab = (t: string) => {
    setTab(t);
    router.replace(`/admin/academics?tab=${t}`, { scroll: false });
  };

  if (!years || !classes || !subjects || (activeYear && sections === undefined)) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ink-muted" />
      </div>
    );
  }

  const currentYearObj = activeYear ?? {
    _id: "" as Id<"academicYears">,
    name: "2026–27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    isCurrent: true,
  };

  return (
    <div>
      <PageHeader
        title="Academics"
        description="Set up the academic year: classes, sections, subjects, enrollments and teacher assignments."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="ay" className="text-[13px] text-ink-muted">Academic year</label>
            <Select
              id="ay"
              value={currentYearObj._id}
              onChange={(e) => setSelectedYearId(e.target.value)}
              className="w-52"
            >
              {years.map((y) => (
                <option key={y._id} value={y._id}>
                  {y.name}{y.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList
          items={[
            { value: "setup", label: "Setup overview" },
            { value: "years", label: "Academic years", count: years.length },
            { value: "classes", label: "Classes & sections", count: sections?.length ?? 0 },
            { value: "subjects", label: "Subjects", count: subjects.length },
            { value: "enrollments", label: "Enrollments" },
            { value: "assignments", label: "Teacher assignments" },
          ]}
        />
        <TabsContent value="setup">
          <SetupOverview
            years={years}
            year={currentYearObj}
            classes={classes}
            sections={sections ?? []}
            subjects={subjects}
            go={changeTab}
          />
        </TabsContent>
        <TabsContent value="years">
          <YearsTab years={years} />
        </TabsContent>
        <TabsContent value="classes">
          <ClassesTab
            year={currentYearObj}
            classes={classes}
            sections={sections ?? []}
            subjects={subjects}
          />
        </TabsContent>
        <TabsContent value="subjects">
          <SubjectsTab subjects={subjects} />
        </TabsContent>
        <TabsContent value="enrollments">
          <EnrollmentsTab
            year={currentYearObj}
            classes={classes}
            sections={sections ?? []}
          />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentsTab
            year={currentYearObj}
            classes={classes}
            sections={sections ?? []}
            subjects={subjects}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ Helpers

/**
 * Keeps a selected section id valid as the sections list changes
 * (e.g. when switching academic years). Falls back to the first section.
 */
function useSectionSelection(sections: any[]) {
  const [sectionId, setSectionId] = useState<string>(sections[0]?._id ?? "");

  useEffect(() => {
    const stillExists = sections.some((s) => s._id === sectionId);
    if (!stillExists) setSectionId(sections[0]?._id ?? "");
  }, [sections, sectionId]);

  return [sectionId, setSectionId] as const;
}

// ------------------------------------------------------------------ Setup Overview

function SetupOverview({
  years,
  year,
  classes,
  sections,
  subjects,
  go,
}: {
  years: any[];
  year: any;
  classes: any[];
  sections: any[];
  subjects: any[];
  go: (t: string) => void;
}) {
  const steps = [
    {
      tab: "years",
      Icon: CalendarRange,
      title: "Academic year",
      detail: `${year.name} · ${formatDate(year.startDate)} – ${formatDate(year.endDate)}`,
      done: years.length > 0,
    },
    {
      tab: "classes",
      Icon: School,
      title: "Classes",
      detail: `${classes.length} classes created`,
      done: classes.length > 0,
    },
    {
      tab: "classes",
      Icon: Layers,
      title: "Sections",
      detail: `${sections.length} sections in ${year.name}`,
      done: sections.length > 0,
    },
    {
      tab: "subjects",
      Icon: BookMarked,
      title: "Subjects",
      detail: `${subjects.length} school subjects`,
      done: subjects.length > 0,
    },
    {
      tab: "enrollments",
      Icon: GraduationCap,
      title: "Enroll students",
      detail: "Manage section enrollments and roll numbers",
      done: sections.length > 0,
    },
    {
      tab: "assignments",
      Icon: UserCheck,
      title: "Assign teachers",
      detail: "Class teachers and subject teachers",
      done: sections.some((s) => s.classTeacherId),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <GlassCard className="p-6 lg:col-span-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-sapphire">Year setup workflow</h2>
            <p className="text-sm text-ink-muted">
              Each step builds on the previous one. Changes flow straight to teachers&apos; and students&apos; views.
            </p>
          </div>
          <Badge tone={doneCount === steps.length ? "teal" : "lavender"}>
            {doneCount}/{steps.length} complete
          </Badge>
        </div>
        <ol className="mt-6 space-y-2">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button
                onClick={() => go(s.tab)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-white/80 bg-white/60 p-3.5 text-left transition-all hover:bg-white hover:shadow-soft"
              >
                <span
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                    s.done ? "bg-lagoon text-white" : "bg-heather/25 text-ink-soft"
                  )}
                >
                  {s.done ? <Check className="h-5 w-5" /> : <s.Icon className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                    Step {i + 1}
                  </span>
                  <span className="block font-semibold text-ink">{s.title}</span>
                  <span className="block text-[13px] text-ink-muted">{s.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ol>
      </GlassCard>

      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Academic Setup Summary</p>
          <p className="mt-1 text-2xl font-semibold text-sapphire">{year.name}</p>
          <div className="mt-4 space-y-2 text-sm text-ink">
            <div className="flex justify-between">
              <span className="text-ink-muted">Classes</span>
              <span className="font-semibold">{classes.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">Sections</span>
              <span className="font-semibold">{sections.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">Subjects</span>
              <span className="font-semibold">{subjects.length}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Years Tab

function YearsTab({ years }: { years: any[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "2027–28",
    startDate: "2027-04-01",
    endDate: "2028-03-31",
  });
  const [loading, setLoading] = useState(false);
  const createYearMutation = useMutation(api.academics.createAcademicYear);

  const handleCreate = async () => {
    const name = form.name.trim();
    if (!name || !form.startDate || !form.endDate) {
      toast({ title: "Please fill all fields", tone: "error" });
      return;
    }
    if (form.endDate <= form.startDate) {
      toast({ title: "End date must be after start date", tone: "error" });
      return;
    }

    setLoading(true);
    try {
      await createYearMutation({
        name,
        startDate: form.startDate,
        endDate: form.endDate,
        status: NEW_YEAR_STATUS, // "planned"
      });
      toast({ title: "Academic year created", description: `${name} is ready.` });
      setOpen(false);
      setForm({ name: "", startDate: "", endDate: "" });
    } catch (e: any) {
      toast({ title: "Could not create year", description: e?.message || String(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Academic years"
        description="Only one year is current at a time."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New year
          </Button>
        }
      />
      <div className="p-5">
        <DataTable
          rows={years}
          getRowId={(y) => y._id}
          columns={[
            {
              key: "name",
              header: "Year",
              primary: true,
              cell: (y) => <span className="font-semibold text-ink">{y.name}</span>,
            },
            {
              key: "dates",
              header: "Duration",
              cell: (y) => `${formatDate(y.startDate)} – ${formatDate(y.endDate)}`,
            },
            {
              key: "status",
              header: "Status",
              cell: (y) => (y.isCurrent ? <Badge tone="teal" dot>Current</Badge> : <StatusBadge status={y.status} />),
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create academic year"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={loading} onClick={handleCreate}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" required hint="e.g. 2027–28">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts" required>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </FormField>
            <FormField label="Ends" required>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </FormField>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ Classes & Sections Tab

function ClassesTab({
  year,
  classes,
  sections,
  subjects,
}: {
  year: any;
  classes: any[];
  sections: any[];
  subjects: any[];
}) {
  const { toast } = useToast();
  const [classOpen, setClassOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button onClick={() => setClassOpen(true)}>
          <Plus className="h-4 w-4" /> Add class
        </Button>
      </div>

      {classes.length === 0 ? (
        <Card>
          <EmptyState
            title={`No classes for ${year.name} yet`}
            description="Create classes to start setting up this academic year."
            action={<Button onClick={() => setClassOpen(true)}>Add class</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {classes.map((c) => {
            const classSections = sections.filter((s) => s.classId === c._id);
            return (
              <Card key={c._id}>
                <CardHeader
                  title={c.name}
                  description={`${classSections.length} section(s)`}
                  action={
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={() => {
                        setSelectedClassId(c._id);
                        setSectionOpen(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" /> Section
                    </Button>
                  }
                />
                <ul className="grid gap-2.5 p-5 sm:grid-cols-3">
                  {classSections.map((s) => (
                    <li key={s._id} className="rounded-xl border border-line/70 bg-alabaster/50 p-3.5">
                      <p className="text-lg font-semibold text-sapphire">{s.displayName}</p>
                      <p className="text-[12.5px] text-ink-muted">
                        Room: {s.room ?? "—"} · Cap: {s.capacity ?? 40}
                      </p>
                      <p className="mt-1.5 truncate text-[12.5px] text-ink-soft">
                        {s.classTeacherName ? (
                          <span>Teacher: {s.classTeacherName}</span>
                        ) : (
                          <span className="text-plum">No class teacher</span>
                        )}
                      </p>
                    </li>
                  ))}
                  {classSections.length === 0 && (
                    <li className="col-span-3 py-2 text-center text-sm text-ink-muted">
                      No sections yet in this class.
                    </li>
                  )}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <AddClassModal
        open={classOpen}
        onOpenChange={setClassOpen}
        onDone={() => toast({ title: "Class created successfully" })}
      />

      <AddSectionModal
        open={sectionOpen}
        onOpenChange={setSectionOpen}
        academicYearId={year._id}
        classId={selectedClassId as Id<"classes">}
        onDone={() => {
          setSectionOpen(false);
          toast({ title: "Section created successfully" });
        }}
      />
    </div>
  );
}

function AddClassModal({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("Grade 6");
  const [level, setLevel] = useState(6);
  const [loading, setLoading] = useState(false);
  const createClassMutation = useMutation(api.academics.createClass);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Class name is required", tone: "error" });
      return;
    }
    setLoading(true);
    try {
      await createClassMutation({ name: trimmed, level });
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not create class", description: e?.message || String(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add class"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={loading} onClick={handleCreate}>Create class</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Class Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grade 6" />
        </FormField>
        <FormField label="Level (numeric)" required>
          <Input type="number" min={0} max={12} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        </FormField>
      </div>
    </Modal>
  );
}

function AddSectionModal({
  open,
  onOpenChange,
  academicYearId,
  classId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  academicYearId: Id<"academicYears">;
  classId: Id<"classes">;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("A");
  const [room, setRoom] = useState("Room 101");
  const [capacity, setCapacity] = useState(40);
  const [loading, setLoading] = useState(false);
  const createSectionMutation = useMutation(api.academics.createSection);

  const handleCreate = async () => {
    if (!classId || !academicYearId) {
      toast({ title: "Select an academic year and class first", tone: "error" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Section name is required", tone: "error" });
      return;
    }
    setLoading(true);
    try {
      await createSectionMutation({
        academicYearId,
        classId,
        name: name.trim().toUpperCase(),
        room,
        capacity,
      });
      onDone();
    } catch (e: any) {
      toast({ title: "Could not create section", description: e?.message || String(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add Section"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={loading} onClick={handleCreate}>Create Section</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="Section Name" required hint="e.g. A, B, C">
          <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={2} />
        </FormField>
        <FormField label="Room">
          <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room 101" />
        </FormField>
        <FormField label="Capacity">
          <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Subjects Tab

function SubjectsTab({ subjects }: { subjects: any[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const createSubjectMutation = useMutation(api.academics.createSubject);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedName || !trimmedCode) {
      toast({ title: "Please fill all fields", tone: "error" });
      return;
    }
    setLoading(true);
    try {
      await createSubjectMutation({ name: trimmedName, code: trimmedCode });
      toast({ title: "Subject created", description: `${trimmedName} (${trimmedCode}) added.` });
      setOpen(false);
      setName("");
      setCode("");
    } catch (e: any) {
      toast({ title: "Could not create subject", description: e?.message || String(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Subjects"
        description="Subjects offered across the school"
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add subject
          </Button>
        }
      />
      <div className="p-5">
        <DataTable
          rows={subjects}
          getRowId={(s) => s._id}
          columns={[
            {
              key: "name",
              header: "Subject",
              primary: true,
              cell: (s) => <span className="font-semibold text-ink">{s.name}</span>,
            },
            {
              key: "code",
              header: "Code",
              cell: (s) => <span className="font-mono">{s.code}</span>,
            },
            {
              key: "status",
              header: "Status",
              cell: (s) => (s.active ? <Badge tone="teal">Active</Badge> : <Badge tone="mauve">Inactive</Badge>),
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add Subject"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={loading} onClick={handleCreate}>Add</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Subject Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Science" />
          </FormField>
          <FormField label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="SCI" />
          </FormField>
        </div>
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ Enrollments Tab

function EnrollmentsTab({
  year,
  classes,
  sections,
}: {
  year: any;
  classes: any[];
  sections: any[];
}) {
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const rosterData = useQuery(
    api.academics.sectionRoster,
    sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip"
  );

  // Alphabetical A→Z by student name (case/accent-insensitive),
  // tie-broken by admission number for a stable order.
  const sortedStudents = useMemo(() => {
    const students = rosterData?.students ?? [];
    return [...students].sort((a, b) => {
      const byName = nameCollator.compare((a.name ?? "").trim(), (b.name ?? "").trim());
      if (byName !== 0) return byName;
      return nameCollator.compare(String(a.admissionNo ?? ""), String(b.admissionNo ?? ""));
    });
  }, [rosterData?.students]);

  return (
    <Card>
      <CardHeader
        title="Section Roster & Roll Numbers"
        description="Enrolled students in alphabetical order (A to Z)."
        action={
          <Select
            aria-label="Section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="w-48"
            disabled={sections.length === 0}
          >
            {sections.map((s) => (
              <option key={s._id} value={s._id}>
                {s.displayName}
              </option>
            ))}
          </Select>
        }
      />
      <div className="p-5">
        {!sectionId ? (
          <EmptyState title="No sections available" description="Create a section first." />
        ) : rosterData === undefined ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
          </div>
        ) : sortedStudents.length === 0 ? (
          <EmptyState title="No students in this section" description="Admit students to this section to populate the roster." />
        ) : (
          <ul className="divide-y divide-line/60">
            {sortedStudents.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-8 text-center text-sm font-bold text-sapphire">
                    {s.rollNo ?? "—"}
                  </span>
                  <div>
                    <p className="font-medium text-ink">{s.name}</p>
                    <p className="text-[12px] text-ink-muted">Adm: {s.admissionNo}</p>
                  </div>
                </div>
                <Badge tone="teal">Enrolled</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Assignments Tab

function AssignmentsTab({
  year,
  classes,
  sections,
  subjects,
}: {
  year: any;
  classes: any[];
  sections: any[];
  subjects: any[];
}) {
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const assignments = useQuery(
    api.academics.listTeacherAssignments,
    sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip"
  );

  return (
    <Card>
      <CardHeader
        title="Teacher Assignments"
        description="Assigned teachers for each section."
        action={
          <Select
            aria-label="Section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="w-48"
            disabled={sections.length === 0}
          >
            {sections.map((s) => (
              <option key={s._id} value={s._id}>
                {s.displayName}
              </option>
            ))}
          </Select>
        }
      />
      <div className="p-5">
        {!sectionId ? (
          <EmptyState title="No sections available" />
        ) : assignments === undefined ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
          </div>
        ) : assignments.length === 0 ? (
          <EmptyState title="No teacher assignments yet" description="Assign teachers to subjects in this section." />
        ) : (
          <DataTable
            rows={assignments}
            getRowId={(a) => a._id}
            columns={[
              {
                key: "subject",
                header: "Subject",
                cell: (a) => <span className="font-semibold text-ink">{a.subjectName}</span>,
              },
              {
                key: "teacher",
                header: "Teacher",
                cell: (a) => a.teacherName ?? <span className="text-plum">Unassigned</span>,
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
