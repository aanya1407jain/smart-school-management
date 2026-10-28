"use client";
/**
 * Academics' parts of the Academics setup workspace (contributed, see
 * src/modules/academics/contributions.tsx): the curriculum pacing overview,
 * school subjects, each class's curriculum and subject-teacher assignments.
 */
import { SyllabusProgressTracker } from "./syllabus-tracker";
import { useEffect, useMemo, useState } from "react";
import { BookMarked, Plus, Trash2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, Modal, Select, useToast } from "@/components/ui";
import { NeedYear, Spinner, errText, useSectionSelection, type Klass, type Section, type Teacher, type Year } from "@/features/academics/workspace-kit";
import type { AcademicsSetupCtx } from "@/lib/contributions/types";

type Subject = FunctionReturnType<typeof api.subjects.listSubjects>[number];

export function PacingOverviewTab() {
  return <SyllabusProgressTracker readOnly={true} />;
}

export function SubjectsSetupTab({ ctx }: { ctx: AcademicsSetupCtx }) {
  const subjects = useSchoolQuery(api.subjects.listSubjects, {});
  if (!subjects) return <Spinner />;
  return <SubjectsTab subjects={subjects} autoOpen={ctx.action === "add-subject"} />;
}

export function AssignmentsSetupTab({ ctx }: { ctx: AcademicsSetupCtx }) {
  return ctx.year ? <AssignmentsTab year={ctx.year} sections={ctx.sections} teachers={ctx.teachers} /> : <NeedYear />;
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

/** The subjects a class studies in the selected year (classSubjects). Subject teachers can only be assigned to these. */
function CurriculumModal({ year, klass, subjects, onClose }: { year: Year; klass: Klass; subjects: Subject[]; onClose: () => void }) {
  const { toast } = useToast();
  const current = useSchoolQuery(api.subjects.listClassSubjects, { classId: klass._id, academicYearId: year._id });
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);
  const setClassSubjects = useSchoolMutation(api.subjects.setClassSubjects);
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

function SubjectsTab({ subjects, autoOpen = false }: { subjects: Subject[]; autoOpen?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const createSubject = useSchoolMutation(api.subjects.createSubject);
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

function AssignmentsTab({ year, sections, teachers }: { year: Year; sections: Section[]; teachers: Teacher[] }) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const section = sections.find((s) => s._id === sectionId) ?? null;
  const assignments = useSchoolQuery(api.subjects.listTeacherAssignments, section ? { sectionId: section._id } : "skip");
  const curriculum = useSchoolQuery(api.subjects.listClassSubjects, section ? { classId: section.classId, academicYearId: year._id } : "skip");
  const assign = useSchoolMutation(api.subjects.assignSubjectTeacher);
  const remove = useSchoolMutation(api.subjects.removeTeacherAssignment);

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
