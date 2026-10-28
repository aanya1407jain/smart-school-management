"use client";
/**
 * LIVE examinations for school-created admin accounts (exams:manage /
 * exams:publish): create and edit exams, schedule subject papers, move the
 * exam through its lifecycle (draft → scheduled → in progress → marks entry),
 * watch marks-entry progress, publish results and print report cards.
 * Every rule is enforced in convex/exams.ts; this screen shows its messages.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpenCheck, CheckCircle2, FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, ProgressBar, Select, StatusBadge, useToast,
} from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";
import { ReportCardModal, type ReportCardData } from "./report-card";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
type Exam = FunctionReturnType<typeof api.exams.get>;
type Paper = Exam["papers"][number];

const NEXT_STATUS: Record<string, { to: "scheduled" | "in_progress" | "marks_entry"; label: string; help: string } | undefined> = {
  draft: { to: "scheduled", label: "Mark as scheduled", help: "Papers and dates are final; teachers can see the schedule." },
  scheduled: { to: "in_progress", label: "Start exam", help: "Teachers can start entering marks." },
  in_progress: { to: "marks_entry", label: "Open marks entry", help: "All papers are written; finish marks entry, then publish." },
};

// ------------------------------------------------------------------ list
export function LiveExamsAdmin() {
  const exams = useSchoolQuery(api.exams.list, {});
  const classes = useSchoolQuery(api.academics.listClasses, {});
  const [open, setOpen] = useState(false);
  if (exams === undefined || classes === undefined) return <LoadingState variant="table" label="Loading examinations" />;
  const className = new Map(classes.map((c) => [c._id as string, c.name]));
  return (
    <div>
      <PageHeader title="Examinations" description="Create exams, schedule subject papers, follow marks entry and publish results." actions={<Button onClick={() => setOpen(true)} disabled={classes.length === 0}><Plus className="h-4 w-4" /> New exam</Button>} />
      <Card>
        <DataTable
          caption="Examinations this academic year"
          rows={exams}
          getRowId={(e) => e.examId}
          empty={<EmptyState icon={<BookOpenCheck className="h-6 w-6" />} title="No examinations yet" description={classes.length ? "Create the first exam of the year." : "Create classes in Academics first."} />}
          columns={[
            { key: "n", header: "Examination", primary: true, cell: (e) => <Link href={`/admin/examinations/${e.examId}`} className="font-semibold text-ink hover:text-lagoon">{e.name}</Link> },
            { key: "c", header: "Classes", cell: (e) => e.classIds.map((c) => className.get(c) ?? "—").join(", ") },
            { key: "d", header: "Dates", cell: (e) => `${formatDate(e.startDate)} – ${formatDate(e.endDate)}` },
            { key: "s", header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
          ]}
        />
      </Card>
      {open && <ExamFormModal classes={classes} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ExamFormModal({ classes, exam, onClose }: { classes: { _id: Id<"classes">; name: string; level: number }[]; exam?: Exam; onClose: () => void }) {
  const { toast } = useToast();
  const create = useSchoolMutation(api.exams.create);
  const update = useSchoolMutation(api.exams.update);
  const [name, setName] = useState(exam?.name ?? "");
  const [term, setTerm] = useState(exam?.term ?? "");
  const [classIds, setClassIds] = useState<string[]>(exam?.classIds ?? []);
  const [startDate, setStart] = useState(exam?.startDate ?? "");
  const [endDate, setEnd] = useState(exam?.endDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim() || !startDate || !endDate || classIds.length === 0) return setError("Name, classes and dates are required.");
    if (startDate > endDate) return setError("The exam must end on or after its start date.");
    setBusy(true);
    setError(null);
    try {
      const args = { name: name.trim(), term: term.trim(), classIds: classIds as Id<"classes">[], startDate, endDate };
      if (exam) await update({ examId: exam.examId, ...args });
      else await create(args);
      toast({ title: exam ? "Exam updated" : "Exam created" });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={exam ? "Edit exam" : "New exam"} size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{exam ? "Save changes" : "Create exam"}</Button></>}>
      <div className="space-y-4">
        <FormField label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Half-Yearly Examination" /></FormField>
        <FormField label="Term" hint="Optional"><Input value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} placeholder="e.g. Term 1" /></FormField>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Classes <span className="text-plum">*</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...classes].sort((a, b) => a.level - b.level).map((c) => (
              <Checkbox key={c._id} label={c.name} checked={classIds.includes(c._id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c._id] : classIds.filter((x) => x !== c._id))} />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Starts" required><Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="Ends" required><Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEnd(e.target.value)} /></FormField>
        </div>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ detail
export function LiveExamDetail({ examId }: { examId: string }) {
  const { toast } = useToast();
  const exam = useSchoolQuery(api.exams.get, { examId: examId as Id<"exams"> });
  const progress = useSchoolQuery(api.exams.progress, { examId: examId as Id<"exams"> });
  const classes = useSchoolQuery(api.academics.listClasses, {});
  const setStatus = useSchoolMutation(api.exams.setStatus);
  const removePaper = useSchoolMutation(api.exams.removePaper);
  const publish = useSchoolMutation(api.exams.publish);
  const [editing, setEditing] = useState(false);
  const [paperForm, setPaperForm] = useState<Paper | "new" | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "status" | null>(null);
  const [busy, setBusy] = useState(false);
  if (exam === undefined || progress === undefined || classes === undefined) return <LoadingState variant="table" label="Loading exam" />;
  const className = new Map(classes.map((c) => [c._id as string, c.name]));
  const locked = exam.status === "published";
  const next = NEXT_STATUS[exam.status];
  const canEnterMarks = exam.status === "in_progress" || exam.status === "marks_entry";
  const done = progress.rows.filter((r) => r.entered >= r.total).length;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast({ title: ok }); setConfirm(null); } catch (e) { toast({ title: "Not done", description: errText(e), tone: "error" }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5" data-testid="live-exam-detail">
      <Link href="/admin/examinations" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> All examinations</Link>
      <PageHeader
        title={exam.name}
        description={`${exam.term ? `${exam.term} · ` : ""}${formatDate(exam.startDate)} – ${formatDate(exam.endDate)} · ${exam.classIds.map((c) => className.get(c) ?? "—").join(", ")}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={exam.status} />
            {!locked && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
            {next && <Button variant="outline" onClick={() => setConfirm("status")}>{next.label}</Button>}
            {canEnterMarks && <Button onClick={() => setConfirm("publish")} disabled={!progress.ready}><Send className="h-4 w-4" /> Publish results</Button>}
          </div>
        }
      />

      <Card>
        <CardHeader title="Papers" description={locked ? "Published exams cannot be changed." : "One paper per class and subject. Subjects must be in the class curriculum."} action={!locked && <Button size="sm" onClick={() => setPaperForm("new")}><Plus className="h-4 w-4" /> Add paper</Button>} />
        <DataTable
          caption="Exam papers"
          rows={exam.papers}
          getRowId={(p) => p.examSubjectId}
          empty={<EmptyState title="No papers yet" description="Add a paper for each class and subject before starting the exam." />}
          columns={[
            { key: "c", header: "Class", cell: (p) => className.get(p.classId) ?? "—" },
            { key: "s", header: "Subject", primary: true, cell: (p) => <span className="font-medium text-ink">{p.subject}</span> },
            { key: "d", header: "Date & time", cell: (p) => `${formatDate(p.date)} · ${p.startTime}–${p.endTime}` },
            { key: "m", header: "Max / pass", cell: (p) => `${p.maxMarks} / ${p.passMarks}` },
          ]}
          rowActions={(p) => (locked ? null : (
            <div className="flex gap-1">
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.subject} paper`} onClick={() => setPaperForm(p)}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${p.subject} paper`} onClick={() => run(() => removePaper({ examSubjectId: p.examSubjectId }), "Paper removed")}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        />
      </Card>

      <Card>
        <CardHeader title="Marks entry progress" description={progress.rows.length ? `${done}/${progress.rows.length} sheets complete${progress.ready && !locked ? " — ready to publish" : ""}` : "Papers × sections appear here."} />
        <div className="p-5 pt-2">
          {progress.rows.length === 0 ? <EmptyState title="Nothing to track yet" /> : (
            <ul className="divide-y divide-line/60">
              {progress.rows.map((r) => (
                <li key={`${r.examSubjectId}:${r.sectionId}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-48 font-medium text-ink">{r.subject} · Class {r.section}</span>
                  <div className="min-w-[10rem] flex-1"><ProgressBar value={r.total ? (r.entered / r.total) * 100 : 100} label={`${r.subject} ${r.section} marks`} /></div>
                  <span className="w-16 text-right text-[12.5px] text-ink-soft">{r.entered}/{r.total}</span>
                  {canEnterMarks && <Link href={`/admin/examinations/marks?examId=${exam.examId}&paper=${r.examSubjectId}&section=${r.sectionId}`} className="text-[13px] font-medium text-lagoon hover:underline">{r.entered >= r.total ? "Review" : "Enter marks"}</Link>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {locked && <PublishedResults exam={exam} />}

      {editing && <ExamFormModal classes={classes} exam={exam} onClose={() => setEditing(false)} />}
      {paperForm && <PaperFormModal exam={exam} paper={paperForm === "new" ? undefined : paperForm} classes={classes.filter((c) => exam.classIds.includes(c._id))} onClose={() => setPaperForm(null)} />}
      {confirm === "status" && next && (
        <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title={next.label} description={`${next.help} An exam cannot move back to an earlier stage.`} confirmLabel={next.label} loading={busy} onConfirm={() => run(() => setStatus({ examId: exam.examId, status: next.to }), "Exam status updated")} />
      )}
      {confirm === "publish" && (
        <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title="Publish results" description="Results are calculated from the entered marks, students are notified once, and marks are locked. This cannot be undone." confirmLabel="Publish results" loading={busy} onConfirm={() => run(() => publish({ examId: exam.examId }), "Results published")} />
      )}
    </div>
  );
}

function PaperFormModal({ exam, paper, classes, onClose }: { exam: Exam; paper?: Paper; classes: { _id: Id<"classes">; name: string }[]; onClose: () => void }) {
  const { toast } = useToast();
  const upsert = useSchoolMutation(api.exams.upsertPaper);
  const [classId, setClassId] = useState<string>(paper?.classId ?? classes[0]?._id ?? "");
  const subjects = useSchoolQuery(api.subjects.listClassSubjects, classId ? { classId: classId as Id<"classes"> } : "skip");
  const [subjectId, setSubjectId] = useState<string>(paper?.subjectId ?? "");
  const [date, setDate] = useState(paper?.date ?? exam.startDate);
  const [startTime, setStartTime] = useState(paper?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(paper?.endTime ?? "12:00");
  const [maxMarks, setMax] = useState(String(paper?.maxMarks ?? 100));
  const [passMarks, setPass] = useState(String(paper?.passMarks ?? 33));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!paper && subjects && !subjects.some((s) => s.subjectId === subjectId)) setSubjectId(subjects[0]?.subjectId ?? ""); }, [subjects, subjectId, paper]);
  const save = async () => {
    const max = Number(maxMarks);
    const pass = Number(passMarks);
    if (!classId || !subjectId) return setError("Choose a class and a subject from its curriculum.");
    if (!Number.isInteger(max) || max < 1 || max > 1000) return setError("Maximum marks must be a whole number from 1 to 1000.");
    if (!(pass >= 0 && pass <= max)) return setError("Pass marks must be between 0 and the maximum.");
    if (startTime >= endTime) return setError("The paper must end after it starts.");
    setBusy(true);
    setError(null);
    try {
      await upsert({ examId: exam.examId, classId: classId as Id<"classes">, subjectId: subjectId as Id<"subjects">, date, startTime, endTime, maxMarks: max, passMarks: pass });
      toast({ title: paper ? "Paper updated" : "Paper added" });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={paper ? `Edit ${paper.subject} paper` : "Add paper"} size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{paper ? "Save paper" : "Add paper"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Class" required><Select value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId(""); }} disabled={!!paper}>{classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></FormField>
        <FormField label="Subject" required hint={subjects?.length === 0 ? "This class has no curriculum yet (Academics)." : undefined}>
          <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!!paper || !subjects?.length}>{(subjects ?? []).map((s) => <option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}</Select>
        </FormField>
        <FormField label="Date" required><Input type="date" value={date} min={exam.startDate} max={exam.endDate} onChange={(e) => setDate(e.target.value)} /></FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Starts" required><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></FormField>
          <FormField label="Ends" required><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></FormField>
        </div>
        <FormField label="Maximum marks" required><Input type="number" min={1} max={1000} value={maxMarks} onChange={(e) => setMax(e.target.value)} /></FormField>
        <FormField label="Pass marks" required><Input type="number" min={0} step="0.5" value={passMarks} onChange={(e) => setPass(e.target.value)} /></FormField>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-plum">{error}</p>}
    </Modal>
  );
}

function PublishedResults({ exam }: { exam: Exam }) {
  const sections = useSchoolQuery(api.academics.listSections, { academicYearId: exam.academicYearId });
  const school = useSchoolQuery(api.schools.current, {});
  const examSections = useMemo(() => (sections ?? []).filter((s) => exam.classIds.includes(s.classId)), [sections, exam.classIds]);
  const [sectionId, setSectionId] = useState("");
  useEffect(() => { if (!sectionId && examSections[0]) setSectionId(examSections[0]._id); }, [examSections, sectionId]);
  const rows = useSchoolQuery(api.exams.sectionResults, sectionId ? { examId: exam.examId, sectionId: sectionId as Id<"sections"> } : "skip");
  const [card, setCard] = useState<ReportCardData | null>(null);
  const section = examSections.find((s) => s._id === sectionId);
  return (
    <Card>
      <CardHeader title="Published results" description="Ranked within each section. Open a report card to print it." action={<Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-40">{examSections.map((s) => <option key={s._id} value={s._id}>Class {s.displayName}</option>)}</Select>} />
      {rows === undefined ? <LoadingState variant="table" /> : (
        <DataTable
          caption="Section results"
          rows={rows}
          getRowId={(r) => r.studentId}
          empty={<EmptyState title="No results for this section" />}
          columns={[
            { key: "r", header: "Rank", cell: (r) => r.rank ?? "—" },
            { key: "n", header: "Student", primary: true, cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: "t", header: "Total", cell: (r) => `${r.totalMarks}/${r.maxMarks}` },
            { key: "p", header: "%", cell: (r) => r.percentage.toFixed(2) },
            { key: "g", header: "Grade", cell: (r) => r.grade ?? "—" },
            { key: "s", header: "Result", cell: (r) => (r.passed ? <Badge tone="teal"><CheckCircle2 className="h-3 w-3" /> Passed</Badge> : <Badge tone="plum">Not passed</Badge>) },
          ]}
          rowActions={(r) => (
            <Button size="sm" variant="outline" onClick={() => setCard({
              schoolName: school?.school.name ?? "", studentName: r.name, admissionNo: r.admissionNo, classLabel: section?.displayName ?? null,
              examName: exam.name, term: exam.term, startDate: exam.startDate,
              subjects: r.subjects.map((x) => ({ subjectId: x.subjectId as string, subject: x.subject, marks: x.marks, isAbsent: x.isAbsent, maxMarks: x.maxMarks, grade: x.grade, passed: x.passed })),
              totalMarks: r.totalMarks, maxMarks: r.maxMarks, percentage: r.percentage, grade: r.grade, rank: r.rank, sectionSize: rows.length,
            })}><FileText className="h-4 w-4" /> Report card</Button>
          )}
        />
      )}
      <ReportCardModal open={!!card} onOpenChange={(o) => !o && setCard(null)} data={card} />
    </Card>
  );
}
