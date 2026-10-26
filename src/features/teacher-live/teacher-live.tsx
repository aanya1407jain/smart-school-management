"use client";
/**
 * LIVE teacher screens for school-created teacher accounts (session
 * `dataSource === "live"`): timetable, my classes, homework and marks entry.
 * Every value comes from Convex and every action is checked on the server
 * (persisted subject-teacher assignments, class-teacher ownership, school
 * isolation). Demo personas keep the demo-data screens.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, CalendarDays, ClipboardList, Lock, Plus, Save, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import {
  Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, LinkButton, LoadingState, Modal, PageHeader, ProgressBar, Select, StatCard, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { formatDate, formatLongDate, greeting, todayISO } from "@/lib/utils/dates";
import { useSession } from "@/features/auth/session-provider";
import { AttachmentList, UploadButton } from "@/features/shared/attachments";
import { getAppError } from "@/lib/convex/errors";
import { TimetableGrid, daysWithLessons } from "@/features/timetable/timetable-grid";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// ------------------------------------------------------------------ timetable
export function LiveTeacherTimetable() {
  const t = useSchoolQuery(api.timetable.myTimetable, {});
  if (t === undefined) return <LoadingState variant="table" label="Loading timetable" />;
  const periods = [...t.periods].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.index - b.index);
  return (
    <div>
      <PageHeader title="My Timetable" description={`${t.lessons.length} lesson${t.lessons.length === 1 ? "" : "s"} a week, from the school's published timetable.`} />
      {t.lessons.length === 0 ? <Card><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No lessons scheduled" description="The school has not placed any of your lessons in the timetable yet." /></Card> : (
        <Card className="p-4 sm:p-5" data-testid="live-teacher-timetable">
          <TimetableGrid
            caption="My weekly timetable"
            days={daysWithLessons(t.lessons.map((l) => l.dayOfWeek))}
            periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
            lessonAt={(d, gp) => {
              const l = t.lessons.find((x) => x.dayOfWeek === d && x.periodId === gp.key);
              return l ? { subject: l.subject, detail: [`Class ${l.section}`, l.room].filter(Boolean).join(" · ") } : undefined;
            }}
          />
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ my classes
export function LiveMyClasses() {
  const teaching = useSchoolQuery(api.academics.myTeaching, {});
  const sectionIds = useMemo(() => {
    if (!teaching) return [];
    const ids = new Map<string, string>();
    for (const c of teaching.classTeacherOf) ids.set(c.sectionId, c.displayName);
    for (const a of teaching.assignments) ids.set(a.sectionId, a.sectionName);
    return [...ids.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [teaching]);
  const [sectionId, setSectionId] = useState("");
  useEffect(() => { if (!sectionIds.some((s) => s.id === sectionId)) setSectionId(sectionIds[0]?.id ?? ""); }, [sectionIds, sectionId]);
  const roster = useSchoolQuery(api.academics.sectionRoster, sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip");
  if (teaching === undefined) return <LoadingState variant="cards" label="Loading your classes" />;
  return (
    <div className="space-y-5">
      <PageHeader title="My Classes" description="Sections you own as class teacher and the subjects you teach, from the school's assignments." />
      {sectionIds.length === 0 ? <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No classes assigned" description="The school office has not assigned you a section or subject yet." /></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teaching.classTeacherOf.map((c) => <Card key={c.sectionId} className="p-4"><p className="text-[12px] font-semibold uppercase tracking-wide text-plum">Class teacher</p><p className="text-lg font-semibold text-sapphire">{c.displayName}</p><p className="text-[12.5px] text-ink-muted">You mark this section&apos;s attendance.</p></Card>)}
            {teaching.assignments.map((a) => <Card key={a._id} className="p-4"><p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Subject teacher</p><p className="text-lg font-semibold text-sapphire">{a.subjectName}</p><p className="text-[12.5px] text-ink-muted">Class {a.sectionName}</p></Card>)}
          </div>
          <Card>
            <CardHeader title="Roster" description="Roll-number order (assigned by the school)." action={<Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-44">{sectionIds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>} />
            <div className="p-5">
              {roster === undefined ? <LoadingState variant="table" /> : roster.students.length === 0 ? <EmptyState title="No students in this section" /> : (
                <ul className="divide-y divide-line/60">
                  {roster.students.map((s) => (
                    <li key={s.studentId} className="flex items-center gap-3 py-2.5">
                      <span className="w-8 text-center text-sm font-bold text-sapphire">{s.rollNo ?? "—"}</span>
                      <Link href={`/teacher/students/${s.studentId}`} className="font-medium text-ink hover:text-lagoon">{s.name}</Link>
                      <span className="text-[12px] text-ink-muted">{s.admissionNo}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ homework
export function LiveTeacherHomework() {
  const { toast } = useToast();
  const list = useSchoolQuery(api.homework.listMine, {});
  const teaching = useSchoolQuery(api.academics.myTeaching, {});
  const close = useSchoolMutation(api.homework.close);
  const [open, setOpen] = useState(false);
  if (list === undefined || teaching === undefined) return <LoadingState variant="table" label="Loading homework" />;
  const today = todayISO();
  return (
    <div>
      <PageHeader title="Homework" description="Homework you set for the sections and subjects you teach." actions={<Button onClick={() => setOpen(true)} disabled={teaching.assignments.length === 0}><Plus className="h-4 w-4" /> New homework</Button>} />
      {teaching.assignments.length === 0 && <div role="status" className="mb-4 rounded-xl border border-blush bg-blush/30 px-4 py-3 text-[13px] text-plum">You have no subject assignments, so you cannot set homework yet. Ask the school office to assign your subjects.</div>}
      <Card>
        <DataTable
          caption="Homework"
          rows={list}
          getRowId={(h) => h.homeworkId}
          empty={<EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No homework yet" description="Homework you set appears here with its submissions." />}
          columns={[
            { key: "t", header: "Homework", primary: true, cell: (h) => <Link href={`/teacher/homework/${h.homeworkId}`} className="font-semibold text-ink hover:text-lagoon">{h.title}</Link> },
            { key: "c", header: "Class", cell: (h) => `${h.section} · ${h.subject}` },
            { key: "d", header: "Due", cell: (h) => <span className={h.status === "active" && h.dueDate < today ? "text-plum" : undefined}>{formatDate(h.dueDate)}</span> },
            { key: "n", header: "Submitted", cell: (h) => `${h.submitted}/${h.students} · ${h.reviewed} reviewed` },
            { key: "s", header: "Status", cell: (h) => <StatusBadge status={h.status === "active" ? "active" : "closed"} /> },
          ]}
          rowActions={(h) => (h.status === "active" ? <Button size="sm" variant="ghost" onClick={async () => { try { await close({ homeworkId: h.homeworkId }); toast({ title: "Homework closed" }); } catch (e) { toast({ title: "Could not close", description: errText(e), tone: "error" }); } }}>Close</Button> : null)}
        />
      </Card>
      {open && <NewHomeworkModal assignments={teaching.assignments} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewHomeworkModal({ assignments, onClose }: { assignments: { _id: string; sectionId: Id<"sections">; sectionName: string; subjectId: Id<"subjects">; subjectName: string }[]; onClose: () => void }) {
  const { toast } = useToast();
  const create = useSchoolMutation(api.homework.create);
  const [slot, setSlot] = useState(assignments[0]?._id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const a = assignments.find((x) => x._id === slot);
    if (!a || !title.trim() || !description.trim() || !dueDate) return setError("Choose a class and fill in the title, instructions and due date.");
    if (dueDate < todayISO()) return setError("The due date cannot be in the past.");
    setBusy(true);
    setError(null);
    try {
      await create({ sectionId: a.sectionId, subjectId: a.subjectId, title: title.trim(), description: description.trim(), dueDate });
      toast({ title: "Homework set", description: `Class ${a.sectionName} was notified.` });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New homework" size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Set homework</Button></>}>
      <div className="space-y-4">
        <FormField label="Class and subject" required><Select value={slot} onChange={(e) => setSlot(e.target.value)}>{assignments.map((a) => <option key={a._id} value={a._id}>{a.sectionName} · {a.subjectName}</option>)}</Select></FormField>
        <FormField label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></FormField>
        <FormField label="Instructions" required><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <FormField label="Due date" required><Input type="date" min={todayISO()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

export function LiveTeacherHomeworkDetail({ homeworkId }: { homeworkId: string }) {
  const { toast } = useToast();
  const data = useSchoolQuery(api.homework.submissions, { homeworkId: homeworkId as Id<"homework"> });
  const review = useSchoolMutation(api.homework.review);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  if (data === undefined) return <LoadingState variant="table" label="Loading submissions" />;
  const h = data.homework;
  const submitted = data.students.filter((s) => s.submission).length;
  return (
    <div className="space-y-5">
      <PageHeader title={h.title} description={`Class ${h.section} · ${h.subject} · due ${formatDate(h.dueDate)} · ${submitted}/${data.students.length} submitted`} actions={<Link href="/teacher/homework" className="text-[13px] font-medium text-lagoon hover:underline">All homework</Link>} />
      <Card className="space-y-3 p-5">
        <p className="whitespace-pre-line text-sm text-ink-soft">{h.description}</p>
        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Attachments for students</p>
          <AttachmentList ownerType="homework" ownerId={h.homeworkId} canRemove={h.status === "active"} emptyText="No files attached." />
          {h.status === "active" && <div className="mt-2"><UploadButton ownerType="homework" ownerId={h.homeworkId} kind="homework_attachment" /></div>}
        </div>
        {h.status === "active" && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit homework</Button></div>}
      </Card>
      {editing && <EditHomeworkModal homework={h} onClose={() => setEditing(false)} />}
      <Card>
        <CardHeader title="Submissions" description="Students in roll-number order; missing work is shown too." />
        <ul className="divide-y divide-line/60">
          {data.students.map((s) => (
            <li key={s.studentId} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-8 text-sm font-bold text-sapphire">{s.rollNo ?? "—"}</span>
                <span className="font-medium text-ink">{s.name}</span>
                {s.submission ? <StatusBadge status={s.submission.status} /> : <Badge tone="neutral">Not submitted</Badge>}
              </div>
              {s.submission?.content && <p className="mt-1.5 whitespace-pre-line pl-10 text-[13px] text-ink-soft">{s.submission.content}</p>}
              {s.submission && s.submission.attachmentFileIds.length > 0 && <div className="mt-1.5 pl-10"><AttachmentList ownerType="submission" ownerId={s.submission.submissionId} compact /></div>}
              {s.submission && (s.submission.status === "reviewed" ? (
                <p className="mt-1.5 pl-10 text-[12.5px] text-lagoon">Feedback: {s.submission.feedback}</p>
              ) : (
                <div className="mt-2 flex gap-2 pl-10">
                  <Input aria-label={`Feedback for ${s.name}`} placeholder="Feedback" value={feedback[s.studentId] ?? ""} onChange={(e) => setFeedback({ ...feedback, [s.studentId]: e.target.value })} />
                  <Button size="sm" disabled={!(feedback[s.studentId] ?? "").trim()} onClick={async () => {
                    try { await review({ submissionId: s.submission!.submissionId, feedback: feedback[s.studentId] }); toast({ title: "Feedback saved", description: `${s.name} was notified.` }); } catch (e) { toast({ title: "Could not save feedback", description: errText(e), tone: "error" }); }
                  }}>Review</Button>
                </div>
              ))}
            </li>
          ))}
          {data.students.length === 0 && <li className="p-5"><EmptyState title="No students in this section" /></li>}
        </ul>
      </Card>
    </div>
  );
}

function EditHomeworkModal({ homework, onClose }: { homework: { homeworkId: Id<"homework">; title: string; description: string; dueDate: string; assignedOn: string }; onClose: () => void }) {
  const { toast } = useToast();
  const update = useSchoolMutation(api.homework.update);
  const [title, setTitle] = useState(homework.title);
  const [description, setDescription] = useState(homework.description);
  const [dueDate, setDueDate] = useState(homework.dueDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!title.trim() || !description.trim() || !dueDate) return setError("Title, instructions and due date are required.");
    setBusy(true);
    setError(null);
    try {
      await update({ homeworkId: homework.homeworkId, title: title.trim(), description: description.trim(), dueDate });
      toast({ title: "Homework updated" });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Edit homework" size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></>}>
      <div className="space-y-4">
        <FormField label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></FormField>
        <FormField label="Instructions" required><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <FormField label="Due date" required hint="Cannot be earlier than the day it was set."><Input type="date" min={homework.assignedOn} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ examinations & marks
export function LiveTeacherExams() {
  const exams = useSchoolQuery(api.exams.list, {});
  if (exams === undefined) return <LoadingState variant="table" label="Loading examinations" />;
  return (
    <div>
      <PageHeader title="Examinations" description="Examinations of the classes you teach. Marks can be entered while an exam is in progress or open for marks entry." />
      <Card>
        <DataTable
          caption="Examinations"
          rows={exams}
          getRowId={(e) => e.examId}
          empty={<EmptyState icon={<BookOpenCheck className="h-6 w-6" />} title="No examinations" description="Examinations for your classes appear here." />}
          columns={[
            { key: "n", header: "Examination", primary: true, cell: (e) => <span className="font-semibold text-ink">{e.name}</span> },
            { key: "d", header: "Dates", cell: (e) => `${formatDate(e.startDate)} – ${formatDate(e.endDate)}` },
            { key: "s", header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
          ]}
          rowActions={(e) => (e.status === "in_progress" || e.status === "marks_entry" ? <Link href={`/teacher/examinations/marks?examId=${e.examId}`} className="text-[13px] font-medium text-lagoon hover:underline">Enter marks</Link> : null)}
        />
      </Card>
    </div>
  );
}

export function LiveMarksEntry({ area = "teacher" }: { area?: "teacher" | "admin" }) {
  const params = useSearchParams();
  const router = useRouter();
  const base = area === "admin" ? "/admin/examinations/marks" : "/teacher/examinations/marks";
  const exams = useSchoolQuery(api.exams.list, {});
  const open = useMemo(() => (exams ?? []).filter((e) => e.status === "in_progress" || e.status === "marks_entry"), [exams]);
  const examId = params.get("examId") ?? open[0]?.examId ?? "";
  const exam = useSchoolQuery(api.exams.get, examId ? { examId: examId as Id<"exams"> } : "skip");
  const teaching = useSchoolQuery(api.academics.myTeaching, area === "teacher" ? {} : "skip");
  const sections = useSchoolQuery(api.academics.listSections, area === "teacher" ? {} : "skip");
  const progress = useSchoolQuery(api.exams.progress, area === "admin" && examId ? { examId: examId as Id<"exams"> } : "skip");
  // Teachers: papers matching their persisted subject assignments. Admins (marks:enter:any): every paper × section.
  const slots = useMemo(() => {
    const out: { key: string; examSubjectId: Id<"examSubjects">; sectionId: Id<"sections">; label: string }[] = [];
    if (area === "admin") {
      for (const r of progress?.rows ?? []) out.push({ key: `${r.examSubjectId}:${r.sectionId}`, examSubjectId: r.examSubjectId, sectionId: r.sectionId, label: `${r.section} · ${r.subject} (${r.entered}/${r.total})` });
      return out;
    }
    if (!exam || !teaching || !sections) return out;
    const classOf = new Map(sections.map((s) => [s._id as string, s.classId as string]));
    for (const a of teaching.assignments) {
      const paper = exam.papers.find((p) => p.subjectId === a.subjectId && p.classId === classOf.get(a.sectionId));
      if (paper) out.push({ key: `${paper.examSubjectId}:${a.sectionId}`, examSubjectId: paper.examSubjectId, sectionId: a.sectionId, label: `${a.sectionName} · ${paper.subject}` });
    }
    return out;
  }, [area, progress, exam, teaching, sections]);
  const wanted = params.get("paper") && params.get("section") ? `${params.get("paper")}:${params.get("section")}` : "";
  const [slotKey, setSlotKey] = useState(wanted);
  useEffect(() => { if (!slots.some((s) => s.key === slotKey)) setSlotKey(slots.find((s) => s.key === wanted)?.key ?? slots[0]?.key ?? ""); }, [slots, slotKey, wanted]);
  const slot = slots.find((s) => s.key === slotKey);

  const loading = exams === undefined || (examId && exam === undefined) || (area === "teacher" ? teaching === undefined || sections === undefined : examId && progress === undefined);
  if (loading) return <LoadingState variant="table" label="Loading marks entry" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Marks entry" description={area === "admin" ? "Enter or correct marks for any paper and section of an exam that is open for marks entry." : "Only papers of the subjects you are assigned to teach in each section are listed."} />
      {open.length === 0 ? <Card><EmptyState icon={<Lock className="h-6 w-6" />} title="No examination is open for marks entry" description={area === "admin" ? "Start an exam from Examinations to open marks entry." : undefined} /></Card> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Examination" value={examId} onChange={(e) => router.replace(`${base}?examId=${e.target.value}`)} className="w-64">{open.map((e) => <option key={e.examId} value={e.examId}>{e.name}</option>)}</Select>
            <Select aria-label="Paper" value={slotKey} onChange={(e) => setSlotKey(e.target.value)} className="w-72" disabled={slots.length === 0}>{slots.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
          </div>
          {!slot ? <Card><EmptyState title="Nothing to mark in this examination" description={area === "admin" ? "Add papers to the exam first." : "None of this exam's papers are for a subject you teach."} /></Card> : <MarksSheet key={slot.key} examSubjectId={slot.examSubjectId} sectionId={slot.sectionId} />}
        </>
      )}
    </div>
  );
}

function MarksSheet({ examSubjectId, sectionId }: { examSubjectId: Id<"examSubjects">; sectionId: Id<"sections"> }) {
  const { toast } = useToast();
  const sheet = useSchoolQuery(api.exams.marksSheet, { examSubjectId, sectionId });
  const save = useSchoolMutation(api.exams.enterMarks);
  const [rows, setRows] = useState<Record<string, { marks: string; absent: boolean }>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!sheet) return;
    setRows((cur) => {
      const next = { ...cur };
      for (const s of sheet.students) if (!next[s.studentId]) next[s.studentId] = { marks: s.marks === null ? "" : String(s.marks), absent: s.isAbsent };
      return next;
    });
  }, [sheet]);
  if (sheet === undefined) return <LoadingState variant="table" />;
  const max = sheet.paper.maxMarks;
  const invalidRow = (r: { marks: string; absent: boolean }) => !r.absent && r.marks !== "" && (!(Number(r.marks) >= 0 && Number(r.marks) <= max) || (Number(r.marks) * 2) % 1 !== 0);
  const submit = async () => {
    const entries = sheet.students
      .map((s) => ({ s, r: rows[s.studentId] }))
      .filter(({ r }) => r && (r.absent || r.marks !== ""))
      .map(({ s, r }) => ({ studentId: s.studentId, isAbsent: r.absent, ...(r.absent ? {} : { marks: Number(r.marks) }) }));
    if (entries.length === 0) return toast({ title: "Enter at least one mark", tone: "error" });
    if (sheet.students.some((s) => rows[s.studentId] && invalidRow(rows[s.studentId]))) return toast({ title: `Marks must be 0–${max} in steps of 0.5`, tone: "error" });
    setBusy(true);
    try {
      const r = await save({ examSubjectId, sectionId, entries });
      toast({ title: "Marks saved", description: `${r.changed} change${r.changed === 1 ? "" : "s"} saved.` });
    } catch (e) {
      toast({ title: "Could not save marks", description: errText(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title={`${sheet.section.displayName} · ${sheet.paper.subject}`} description={`Maximum ${max} · pass ${sheet.paper.passMarks}${sheet.canEnter ? "" : " · read-only (entry not open or not your subject)"}`}
        action={sheet.canEnter && <Button loading={busy} onClick={submit}><Save className="h-4 w-4" /> Save marks</Button>} />
      <div className="p-5">
        {sheet.students.length > 0 && (() => {
          // Class grading completion: a mark or "absent" counts as entered.
          const done = sheet.students.filter((s) => { const r = rows[s.studentId]; return !!r && (r.absent || r.marks !== ""); }).length;
          const pct = (done / sheet.students.length) * 100;
          return (
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/50 px-3 py-2 ring-1 ring-inset ring-line/60">
              <span className="figures text-[12.5px] font-semibold text-ink-soft">{done}/{sheet.students.length} graded</span>
              <ProgressBar value={pct} label="Grading completion" className="flex-1" />
              <span className="figures w-10 text-right text-[12px] font-semibold text-lagoon">{Math.round(pct)}%</span>
            </div>
          );
        })()}
        {sheet.students.length === 0 ? <EmptyState title="No students in this section" /> : (
          <ul className="divide-y divide-line/60">
            {sheet.students.map((s) => {
              const r = rows[s.studentId] ?? { marks: "", absent: false };
              return (
                <li key={s.studentId} className="-mx-2 flex flex-wrap items-center gap-3 rounded-xl px-2 py-2.5 transition-colors focus-within:bg-teal-soft/40 hover:bg-teal-soft/25">
                  <span className="mono-id w-8 text-center font-bold text-sapphire">{s.rollNo ?? "—"}</span>
                  <span className="min-w-40 flex-1 font-medium text-ink">{s.name}</span>
                  <Input aria-label={`Marks for ${s.name}`} type="number" min={0} max={max} step={0.5} className={`figures w-28 font-semibold ${invalidRow(r) ? "border-plum" : ""}`} disabled={!sheet.canEnter || r.absent} value={r.marks}
                    onChange={(e) => setRows({ ...rows, [s.studentId]: { ...r, marks: e.target.value } })} />
                  <Checkbox label="Absent" checked={r.absent} disabled={!sheet.canEnter} onChange={(e) => setRows({ ...rows, [s.studentId]: { marks: e.target.checked ? "" : r.marks, absent: e.target.checked } })} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ dashboard (landing page)
/** The live teacher landing page: today's work from Convex for the signed-in teacher only. */
export function LiveTeacherDashboard() {
  const { user, hasModule } = useSession();
  // Panels follow the school's module entitlements; a disabled module's query is not called.
  const A = hasModule("attendance"), AC = hasModule("academics"), AD = hasModule("administration");
  const d = useSchoolQuery(api.dashboards.teacherOverview, {});
  const notices = useSchoolQuery(api.notices.feed, AD ? {} : "skip");
  if (d === undefined) return <LoadingState variant="cards" label="Loading your day" />;
  const pendingRegisters = A && d.isWorkingDay ? d.classTeacherOf.filter((s) => s.registerMarked === false) : [];
  const toReview = d.homeworkToReview.reduce((a, h) => a + h.pending, 0);
  const marksLeft = d.marksTasks.reduce((a, t) => a + (t.total - t.entered), 0);
  const nothingAssigned = d.classTeacherOf.length === 0 && d.assignments.length === 0;
  return (
    <div className="space-y-6" data-testid="live-teacher-dashboard">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(d.today)}</p>
          <h1 className="mt-1 text-[28px] font-semibold text-sapphire">{greeting()}{user?.displayName ? `, ${user.displayName}` : ""}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {d.classTeacherOf.length > 0 ? <>Class teacher of <strong className="text-ink">{d.classTeacherOf.map((s) => s.displayName).join(", ")}</strong> · </> : null}
            {d.assignments.length} subject assignment{d.assignments.length === 1 ? "" : "s"}
            {!d.isWorkingDay && " · Not a school day"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {AC && <LinkButton href="/teacher/homework" variant="outline"><Plus className="h-4 w-4" /> Homework</LinkButton>}
          {A && <LinkButton href="/teacher/attendance"><CalendarDays className="h-4 w-4" /> {d.classTeacherOf.length ? "Mark attendance" : "View attendance"}</LinkButton>}
        </div>
      </div>

      {!d.hasTeacherRecord || nothingAssigned ? (
        <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No classes assigned yet" description="Once the school office assigns you a section or subjects in Academics, your registers, lessons, homework and marks tasks appear here." /></Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {A && <StatCard label="Registers to mark today" value={pendingRegisters.length} hint={d.isWorkingDay ? (d.classTeacherOf.length ? `${d.classTeacherOf.length - pendingRegisters.length}/${d.classTeacherOf.length} marked` : "You are not a class teacher") : "Not a school day"} icon={<CalendarDays className="h-5 w-5" />} tone="sapphire" href="/teacher/attendance" />}
        {AC && <StatCard label="Lessons today" value={d.todayLessons.length} hint={d.todayLessons.length ? `First at ${clock(d.todayLessons[0].startTime)}` : "None scheduled"} icon={<BookOpenCheck className="h-5 w-5" />} tone="teal" href="/teacher/timetable" />}
        {AC && <StatCard label="Submissions to review" value={toReview} hint={`${d.homeworkToReview.length} homework item${d.homeworkToReview.length === 1 ? "" : "s"}`} icon={<ClipboardList className="h-5 w-5" />} tone="purple" href="/teacher/homework" />}
        {AC && <StatCard label="Marks to enter" value={marksLeft} hint={`${d.marksTasks.length} paper${d.marksTasks.length === 1 ? "" : "s"} open`} icon={<Save className="h-5 w-5" />} tone="lavender" href="/teacher/examinations/marks" />}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {AC && <Card>
          <CardHeader title="Today's lessons" description={d.isWorkingDay ? "From the school's published timetable." : "No lessons on non-working days."} />
          <div className="p-5 pt-2">
            {d.todayLessons.length === 0 ? <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No lessons scheduled today" description="Lessons appear here once the school places them in the timetable." /> : (
              <ul className="divide-y divide-line/60">
                {d.todayLessons.map((l) => (
                  <li key={l.entryId} className="flex items-center gap-3 py-2.5">
                    <span className="w-28 shrink-0 text-[12.5px] text-ink-muted">{clock(l.startTime)}–{clock(l.endTime)}</span>
                    <span className="font-medium text-ink">{l.subject}</span>
                    <span className="text-[12.5px] text-ink-muted">Class {l.section}{l.room ? ` · ${l.room}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>}
        {A && <Card>
          <CardHeader title="Attendance registers" description="Sections you own as class teacher." />
          <div className="p-5 pt-2">
            {d.classTeacherOf.length === 0 ? <EmptyState title="You are not a class teacher" description="Only a section's class teacher marks its register." /> : (
              <ul className="divide-y divide-line/60">
                {d.classTeacherOf.map((s) => (
                  <li key={s.sectionId} className="flex items-center justify-between gap-3 py-2.5">
                    <span><span className="font-medium text-ink">Class {s.displayName}</span> <span className="text-[12.5px] text-ink-muted">· {s.students} students</span></span>
                    {s.registerMarked ? <Badge tone="teal">Marked today</Badge> : d.isWorkingDay ? <Link href={`/teacher/attendance?section=${s.sectionId}`} className="text-[13px] font-medium text-lagoon hover:underline">Mark now</Link> : <Badge tone="neutral">No school today</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>}
        {AC && <Card>
          <CardHeader title="Homework to review" description="Your open homework with submissions waiting for feedback." />
          <div className="p-5 pt-2">
            {d.homeworkToReview.length === 0 ? <EmptyState title="Nothing waiting for review" /> : (
              <ul className="divide-y divide-line/60">
                {d.homeworkToReview.map((h) => (
                  <li key={h.homeworkId} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/teacher/homework/${h.homeworkId}`} className="min-w-0"><span className="block truncate font-medium text-ink hover:text-lagoon">{h.title}</span><span className="text-[12px] text-ink-muted">Class {h.section} · {h.subject} · due {formatDate(h.dueDate)}</span></Link>
                    <Badge tone="lavender">{h.pending} to review</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>}
        {AC && <Card>
          <CardHeader title="Marks to enter" description="Papers you are assigned to, in exams open for marks entry." />
          <div className="p-5 pt-2">
            {d.marksTasks.length === 0 ? <EmptyState title="No marks pending" /> : (
              <ul className="divide-y divide-line/60">
                {d.marksTasks.map((t) => (
                  <li key={`${t.examSubjectId}:${t.sectionId}`} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/teacher/examinations/marks?examId=${t.examId}`} className="min-w-0"><span className="block font-medium text-ink hover:text-lagoon">{t.label}</span><span className="text-[12px] text-ink-muted">{t.examName}</span></Link>
                    <span className="text-[12.5px] text-ink-soft">{t.entered}/{t.total} entered</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>}
      </div>

      {AD && <Card>
        <CardHeader title="Recent notices" action={<Link href="/teacher/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
        <div className="p-5 pt-2">
          {notices === undefined ? <LoadingState variant="inline" /> : notices.length === 0 ? <EmptyState title="No notices" /> : (
            <ul className="divide-y divide-line/60">
              {notices.slice(0, 4).map((n) => (
                <li key={n.noticeId} className="py-2.5"><p className="font-medium text-ink">{n.title}</p><p className="text-[12px] text-ink-muted">{formatDate(n.publishDate)} · {n.audienceLabel}</p></li>
              ))}
            </ul>
          )}
        </div>
      </Card>}
    </div>
  );
}
