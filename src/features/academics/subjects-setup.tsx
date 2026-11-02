"use client";
/**
 * Academics' parts of the Academics setup workspace (contributed, see
 * src/modules/academics/contributions.tsx): the curriculum pacing overview,
 * school subjects, each class's curriculum and subject-teacher assignments.
 *
 * Subjects are a school-wide catalogue; which classes study them is the
 * per-year curriculum (classSubjects), with elective / stream / credits per
 * class. The Subjects tab shows both views: all subjects with their classes,
 * or one class's curriculum.
 */
import { SyllabusProgressTracker } from "./syllabus-tracker";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/features/auth/session-provider";
import { BookMarked, Pencil, Plus, Trash2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, Modal, Select, useToast } from "@/components/ui";
import { NeedYear, Spinner, errText, useSectionSelection, type Klass, type Section, type Teacher, type Year } from "@/features/academics/workspace-kit";
import type { AcademicsSetupCtx } from "@/lib/contributions/types";
import { cn } from "@/lib/utils/cn";
import { ClassChips, ClassFilter, KindBadge } from "./curriculum-ui";

type Subject = FunctionReturnType<typeof api.subjects.listSubjects>[number];
type CurriculumRow = FunctionReturnType<typeof api.subjects.listCurriculum>[number];

/**
 * Pacing overview. Chapter tracking isn't stored yet, so live schools get an
 * honest empty state; the sample subjects are shown to demo accounts only.
 */
export function PacingOverviewTab() {
  const { dataSource } = useSession();
  if (dataSource === "live") {
    return (
      <Card>
        <EmptyState
          icon={<BookMarked className="h-6 w-6" />}
          title="Curriculum pacing isn't tracking yet"
          description="Once teachers log chapters for their subjects, coverage and pacing for each class will appear here."
        />
      </Card>
    );
  }
  return <SyllabusProgressTracker readOnly={true} />;
}

export function SubjectsSetupTab({ ctx }: { ctx: AcademicsSetupCtx }) {
  const subjects = useSchoolQuery(api.subjects.listSubjects, {});
  const curriculum = useSchoolQuery(api.subjects.listCurriculum, ctx.year ? { academicYearId: ctx.year._id } : "skip");
  if (!subjects || (ctx.year && !curriculum)) return <Spinner />;
  return <SubjectsTab subjects={subjects} curriculum={curriculum ?? []} classes={ctx.classes} year={ctx.year} autoOpen={ctx.action === "add-subject"} />;
}

export function AssignmentsSetupTab({ ctx }: { ctx: AcademicsSetupCtx }) {
  return ctx.year ? <AssignmentsTab year={ctx.year} classes={ctx.classes} sections={ctx.sections} teachers={ctx.teachers} /> : <NeedYear />;
}

/** "Subjects" button on a class card: edit the class's curriculum for the year. */
export function CurriculumAction({ year, klass }: { year: Year; klass: Klass }) {
  const [open, setOpen] = useState(false);
  const subjects = useSchoolQuery(api.subjects.listSubjects, open ? {} : "skip");
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><BookMarked className="h-3.5 w-3.5" /> Subjects</Button>
      {open && (subjects ? <CurriculumModal year={year} klass={klass} subjects={subjects} onClose={() => setOpen(false)} /> : null)}
    </>
  );
}

/** On a class card: the subjects the class studies this year, as chips. */
export function ClassCurriculumSummary({ year, klass }: { year: Year; klass: Klass }) {
  // The same two subscriptions for every card (Convex shares identical queries).
  const curriculum = useSchoolQuery(api.subjects.listCurriculum, { academicYearId: year._id });
  const subjects = useSchoolQuery(api.subjects.listSubjects, {});
  const rows = useMemo(() => {
    if (!curriculum || !subjects) return undefined;
    const byId = new Map(subjects.map((s) => [s._id as string, s]));
    return curriculum.filter((r) => r.classId === klass._id).flatMap((r) => { const s = byId.get(r.subjectId); return s ? [{ ...r, name: s.name }] : []; })
      .sort((a, b) => Number(a.elective) - Number(b.elective) || a.name.localeCompare(b.name));
  }, [curriculum, subjects, klass._id]);
  if (!rows) return null;
  const credits = rows.reduce((a, r) => a + (r.credits ?? 0), 0);
  return (
    <div className="border-b border-line px-5 py-3">
      <p className="mb-1.5 text-[12px] font-medium text-ink-muted">
        {rows.length === 0 ? "No subjects yet" : `${rows.length} subject${rows.length === 1 ? "" : "s"}`}
        {rows.some((r) => r.elective) && ` · ${rows.filter((r) => r.elective).length} elective`}
        {credits > 0 && ` · ${credits} credits`}
      </p>
      {rows.length > 0 && <ClassChips items={rows.map((r) => ({ id: r.subjectId, name: r.name, elective: r.elective, stream: r.stream }))} />}
    </div>
  );
}

type Draft = { elective: boolean; stream: string; credits: string };

/**
 * The subjects a class studies in the selected year (classSubjects), with how
 * it studies each: core or elective, an optional stream (e.g. PCM / Commerce
 * for senior classes) and an optional credit weight. Subject teachers can only
 * be assigned to these subjects.
 */
function CurriculumModal({ year, klass, subjects, onClose }: { year: Year; klass: Klass; subjects: Subject[]; onClose: () => void }) {
  const { toast } = useToast();
  const current = useSchoolQuery(api.subjects.listClassSubjects, { classId: klass._id, academicYearId: year._id });
  const [chosen, setChosen] = useState<Map<string, Draft> | null>(null);
  const [loading, setLoading] = useState(false);
  const setClassSubjects = useSchoolMutation(api.subjects.setClassSubjects);
  useEffect(() => {
    if (current && chosen === null) {
      setChosen(new Map(current.map((s) => [s.subjectId as string, { elective: s.elective, stream: s.stream ?? "", credits: s.credits === null ? "" : String(s.credits) }])));
    }
  }, [current, chosen]);
  const patch = (id: string, p: Partial<Draft>) => setChosen((m) => {
    const next = new Map(m);
    next.set(id, { ...next.get(id)!, ...p });
    return next;
  });
  const save = async () => {
    if (!chosen) return;
    const entries = [...chosen.entries()];
    const bad = entries.find(([, d]) => d.credits.trim() !== "" && !Number.isFinite(Number(d.credits)));
    if (bad) return toast({ title: "Credits must be a number", tone: "error" });
    setLoading(true);
    try {
      const r = await setClassSubjects({
        classId: klass._id, academicYearId: year._id,
        subjectIds: entries.map(([id]) => id as Id<"subjects">),
        options: entries.map(([id, d]) => ({
          subjectId: id as Id<"subjects">,
          ...(d.elective ? { elective: true } : {}),
          ...(d.stream.trim() ? { stream: d.stream.trim() } : {}),
          ...(d.credits.trim() !== "" ? { credits: Number(d.credits) } : {}),
        })),
      });
      toast({ title: "Curriculum saved", description: `${r.added} added · ${r.removed} removed${r.changed ? ` · ${r.changed} updated` : ""}` });
      onClose();
    } catch (e) {
      toast({ title: "Could not save the curriculum", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  const shown = subjects.filter((s) => s.active || chosen?.has(s._id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${klass.name} subjects`}
      description={`Curriculum for ${year.name}. Mark electives and, for senior classes, the stream (e.g. PCM, PCB, Commerce). A subject that still has a teacher assigned cannot be removed.`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={loading} disabled={!chosen} onClick={save}>Save</Button></>}>
      {!chosen ? <Spinner /> : subjects.length === 0 ? <EmptyState title="No subjects yet" description="Add subjects in the Subjects tab first." /> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {shown.map((s) => {
            const d = chosen.get(s._id);
            return (
              <li key={s._id} className={cn("flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3", d && "bg-emerald-50/30")}>
                <div className="min-w-0 flex-1">
                  <Checkbox label={<span>{s.name} <span className="font-mono text-[12px] text-ink-muted">{s.code}</span></span>} checked={!!d} onChange={(e) => {
                    const next = new Map(chosen);
                    if (e.target.checked) next.set(s._id, { elective: false, stream: "", credits: "" });
                    else next.delete(s._id);
                    setChosen(next);
                  }} />
                </div>
                {d && (
                  <div className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
                    <Select aria-label={`${s.name}: core or elective`} value={d.elective ? "elective" : "core"} onChange={(e) => patch(s._id, { elective: e.target.value === "elective" })} className="h-8 w-28 text-[13px]">
                      <option value="core">Core</option>
                      <option value="elective">Elective</option>
                    </Select>
                    <Input aria-label={`${s.name}: stream`} value={d.stream} onChange={(e) => patch(s._id, { stream: e.target.value })} maxLength={24} placeholder="All streams" className="h-8 w-28 text-[13px]" />
                    <Input aria-label={`${s.name}: credits`} type="number" min={0} max={20} step={0.5} value={d.credits} onChange={(e) => patch(s._id, { credits: e.target.value })} placeholder="Credits" className="h-8 w-24 text-[13px]" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Subjects

function SubjectsTab({ subjects, curriculum, classes, year, autoOpen = false }: { subjects: Subject[]; curriculum: CurriculumRow[]; classes: Klass[]; year: Year | null; autoOpen?: boolean }) {
  const sortedClasses = useMemo(() => [...classes].sort((a, b) => a.level - b.level), [classes]);
  const [filter, setFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(autoOpen);
  useEffect(() => { if (autoOpen) setAddOpen(true); }, [autoOpen]);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [curriculumFor, setCurriculumFor] = useState<Klass | null>(null);
  const klass = sortedClasses.find((c) => c._id === filter) ?? null;

  const className = useMemo(() => new Map(sortedClasses.map((c) => [c._id as string, c.name])), [sortedClasses]);
  const levelOf = useMemo(() => new Map(sortedClasses.map((c) => [c._id as string, c.level])), [sortedClasses]);
  const bySubject = useMemo(() => {
    const m = new Map<string, CurriculumRow[]>();
    for (const r of curriculum) m.set(r.subjectId, [...(m.get(r.subjectId) ?? []), r]);
    return m;
  }, [curriculum]);
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s._id as string, s])), [subjects]);
  const classRows = klass
    ? curriculum.filter((r) => r.classId === klass._id).flatMap((r) => { const s = subjectById.get(r.subjectId); return s ? [{ ...r, subject: s }] : []; }).sort((a, b) => Number(a.elective) - Number(b.elective) || a.subject.name.localeCompare(b.subject.name))
    : [];
  const credits = classRows.reduce((a, r) => a + (r.credits ?? 0), 0);

  return (
    <Card>
      <CardHeader
        title="Subjects"
        description={year ? `What each class studies in ${year.name}. Choose a class to see its curriculum, electives and streams.` : "Subjects offered across the school. Choose a current academic year to map them to classes."}
        action={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add subject</Button>}
      />
      {year && sortedClasses.length > 0 && (
        <div className="border-b border-line px-5 pb-3">
          <ClassFilter classes={sortedClasses.map((c) => ({ id: c._id, name: c.name }))} value={filter} onChange={setFilter} />
        </div>
      )}

      {klass && year ? (
        <div className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="figures text-[13px] text-ink-muted">
              <b className="font-semibold text-ink">{klass.name}</b> · {classRows.length} subject{classRows.length === 1 ? "" : "s"}
              {classRows.some((r) => r.elective) && ` · ${classRows.filter((r) => r.elective).length} elective`}
              {credits > 0 && ` · ${credits} credits`}
            </p>
            <Button size="sm" variant="outline" onClick={() => setCurriculumFor(klass)}><Pencil className="h-3.5 w-3.5" /> Edit {klass.name} curriculum</Button>
          </div>
          <DataTable
            rows={classRows}
            getRowId={(r) => r.subjectId}
            empty={<EmptyState title={`${klass.name} has no subjects yet`} description="Pick the subjects this class studies, and mark electives or streams." action={<Button onClick={() => setCurriculumFor(klass)}>Choose subjects</Button>} />}
            columns={[
              { key: "name", header: "Subject", primary: true, cell: (r) => <span className="font-semibold text-ink">{r.subject.name} <span className="ml-1 font-mono text-[12px] font-normal text-ink-muted">{r.subject.code}</span></span> },
              { key: "type", header: "Type", cell: (r) => <KindBadge elective={r.elective} stream={r.stream} /> },
              { key: "credits", header: "Credits", cell: (r) => <span className="figures">{r.credits ?? "—"}</span> },
            ]}
          />
        </div>
      ) : (
        <div className="p-5">
          <DataTable
            rows={[...subjects].sort((a, b) => a.name.localeCompare(b.name))}
            getRowId={(s) => s._id}
            empty={<EmptyState title="No subjects yet" action={<Button onClick={() => setAddOpen(true)}>Add subject</Button>} />}
            columns={[
              { key: "name", header: "Subject", primary: true, cell: (s) => <span className="font-semibold text-ink">{s.name}</span> },
              { key: "code", header: "Code", cell: (s) => <span className="font-mono">{s.code}</span> },
              ...(year ? [{
                key: "classes", header: `Classes (${year.name})`, cell: (s: Subject) => (
                  <ClassChips items={(bySubject.get(s._id) ?? []).filter((r) => className.has(r.classId)).sort((a, b) => (levelOf.get(a.classId) ?? 0) - (levelOf.get(b.classId) ?? 0)).map((r) => ({ id: r.classId, name: className.get(r.classId)!, elective: r.elective, stream: r.stream }))} />
                ),
              }] : []),
              { key: "status", header: "Status", cell: (s) => (s.active ? <Badge tone="teal">Active</Badge> : <Badge tone="lavender">Inactive</Badge>) },
            ]}
            rowActions={year ? (s) => <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" /> Classes</Button> : undefined}
          />
        </div>
      )}

      <AddSubjectModal open={addOpen} onOpenChange={setAddOpen} year={year} classes={sortedClasses} preselect={klass?._id ?? null} />
      {editing && year && <SubjectClassesModal subject={editing} year={year} classes={sortedClasses} current={(bySubject.get(editing._id) ?? []).map((r) => r.classId as string)} onClose={() => setEditing(null)} />}
      {curriculumFor && year && <CurriculumModal year={year} klass={curriculumFor} subjects={subjects} onClose={() => setCurriculumFor(null)} />}
    </Card>
  );
}

/** Applicable classes as a checkbox grid with "select all". */
function ClassPicker({ classes, value, onChange, disabled }: { classes: Klass[]; value: Set<string>; onChange: (v: Set<string>) => void; disabled?: boolean }) {
  const all = classes.length > 0 && classes.every((c) => value.has(c._id));
  return (
    <fieldset disabled={disabled}>
      <div className="mb-2 flex items-center justify-between">
        <legend className="text-[13px] font-medium text-ink-soft">Applicable classes</legend>
        {classes.length > 1 && (
          <button type="button" className="text-[12.5px] font-semibold text-emerald-800 hover:underline" onClick={() => onChange(all ? new Set() : new Set(classes.map((c) => c._id)))}>
            {all ? "Clear" : "Select all"}
          </button>
        )}
      </div>
      {classes.length === 0 ? <p className="text-[13px] text-ink-muted">No classes yet.</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {classes.map((c) => (
            <Checkbox key={c._id} label={c.name} checked={value.has(c._id)} onChange={(e) => {
              const next = new Set(value);
              if (e.target.checked) next.add(c._id);
              else next.delete(c._id);
              onChange(next);
            }} />
          ))}
        </div>
      )}
    </fieldset>
  );
}

function AddSubjectModal({ open, onOpenChange, year, classes, preselect }: { open: boolean; onOpenChange: (o: boolean) => void; year: Year | null; classes: Klass[]; preselect: string | null }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [classIds, setClassIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const createSubject = useSchoolMutation(api.subjects.createSubject);
  useEffect(() => { if (open) setClassIds(new Set(preselect ? [preselect] : [])); }, [open, preselect]);
  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedName || !trimmedCode) return toast({ title: "Please fill all fields", tone: "error" });
    setLoading(true);
    try {
      await createSubject({
        name: trimmedName, code: trimmedCode,
        ...(year && classIds.size ? { academicYearId: year._id, classIds: [...classIds] as Id<"classes">[] } : {}),
      });
      toast({ title: "Subject created", description: classIds.size ? `${trimmedName} added to ${classIds.size} class${classIds.size === 1 ? "" : "es"}.` : `${trimmedName} (${trimmedCode}) added.` });
      onOpenChange(false);
      setName("");
      setCode("");
    } catch (e) {
      toast({ title: "Could not create subject", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add subject" description={year ? `Classes are for ${year.name}. You can mark electives and streams from each class's curriculum.` : undefined} size="md"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={loading} onClick={handleCreate}>Add subject</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Subject name" required className="col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics" /></FormField>
          <FormField label="Code" required><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="PHY" /></FormField>
        </div>
        {year ? <ClassPicker classes={classes} value={classIds} onChange={setClassIds} /> : <p className="text-[13px] text-ink-muted">Make an academic year current to offer the subject to classes.</p>}
      </div>
    </Modal>
  );
}

/** Edit which classes study a subject this year. */
function SubjectClassesModal({ subject, year, classes, current, onClose }: { subject: Subject; year: Year; classes: Klass[]; current: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const [classIds, setClassIds] = useState<Set<string>>(() => new Set(current));
  const [loading, setLoading] = useState(false);
  const setSubjectClasses = useSchoolMutation(api.subjects.setSubjectClasses);
  const save = async () => {
    setLoading(true);
    try {
      const r = await setSubjectClasses({ subjectId: subject._id, academicYearId: year._id, classIds: [...classIds] as Id<"classes">[] });
      toast({ title: `${subject.name} classes saved`, description: `${r.added} added · ${r.removed} removed` });
      onClose();
    } catch (e) {
      toast({ title: "Could not save the classes", description: errText(e), tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${subject.name} · classes`} description={`Which classes study ${subject.name} in ${year.name}. A class that still has a teacher for it cannot be removed.`} size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={save}>Save</Button></>}>
      <ClassPicker classes={classes} value={classIds} onChange={setClassIds} />
    </Modal>
  );
}

// ------------------------------------------------------------------ Teacher assignments

function AssignmentsTab({ year, classes, sections, teachers }: { year: Year; classes: Klass[]; sections: Section[]; teachers: Teacher[] }) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const section = sections.find((s) => s._id === sectionId) ?? null;
  const klass = section ? classes.find((c) => c._id === section.classId) ?? null : null;
  const assignments = useSchoolQuery(api.subjects.listTeacherAssignments, section ? { sectionId: section._id } : "skip");
  const curriculum = useSchoolQuery(api.subjects.listClassSubjects, section ? { classId: section.classId, academicYearId: year._id } : "skip");
  const assign = useSchoolMutation(api.subjects.assignSubjectTeacher);
  const remove = useSchoolMutation(api.subjects.removeTeacherAssignment);

  const rows = useMemo(() => {
    if (!curriculum || !assignments) return undefined;
    const bySubject = new Map(assignments.map((a) => [a.subjectId as string, a]));
    const list = curriculum.map((s) => ({ subjectId: s.subjectId, subjectName: s.name, elective: s.elective, stream: s.stream, inCurriculum: true, assignment: bySubject.get(s.subjectId) ?? null }));
    // Assignments whose subject left the curriculum are still shown so they can be removed.
    for (const a of assignments) if (!curriculum.some((s) => s.subjectId === a.subjectId)) list.push({ subjectId: a.subjectId, subjectName: a.subjectName ?? "Subject", elective: false, stream: null, inCurriculum: false, assignment: a });
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
        description={section ? `Class teacher: ${section.classTeacherName ?? "none (set it in Classes & sections)"}. Only ${klass?.name ?? "this class"}'s subjects are listed; subject teachers mark marks, set homework and appear in the timetable.` : "Subject teachers for each section."}
        action={
          <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-48" disabled={sections.length === 0}>
            {sections.map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
          </Select>
        }
      />
      <div className="p-5">
        {!section ? <EmptyState title="No sections available" />
          : rows === undefined ? <Spinner />
          : rows.length === 0 ? <EmptyState title={`${klass?.name ?? "This class"} has no subjects yet`} description="Choose the class's subjects in the Subjects tab (or Classes & sections → Subjects), then assign teachers here." />
          : (
            <DataTable
              rows={rows}
              getRowId={(r) => r.subjectId}
              columns={[
                { key: "subject", header: "Subject", primary: true, cell: (r) => <span className="font-semibold text-ink">{r.subjectName}</span> },
                { key: "type", header: "Type", cell: (r) => (r.inCurriculum ? <KindBadge elective={r.elective} stream={r.stream} /> : <Badge tone="lavender">Not in curriculum</Badge>) },
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
