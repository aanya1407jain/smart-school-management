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
  Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// ------------------------------------------------------------------ timetable
export function LiveTeacherTimetable() {
  const t = useSchoolQuery(api.timetable.myTimetable, {});
  if (t === undefined) return <LoadingState variant="table" label="Loading timetable" />;
  const days = [...new Set(t.lessons.map((l) => l.dayOfWeek))].sort((a, b) => a - b);
  const periods = [...t.periods].sort((a, b) => a.index - b.index);
  return (
    <div>
      <PageHeader title="My Timetable" description={`${t.lessons.length} lesson${t.lessons.length === 1 ? "" : "s"} a week, from the school's published timetable.`} />
      {t.lessons.length === 0 ? <Card><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No lessons scheduled" description="The school has not placed any of your lessons in the timetable yet." /></Card> : (
        <Card className="overflow-x-auto" data-testid="live-teacher-timetable">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><th className="px-3 py-2.5 text-left text-[12px] font-semibold text-ink-muted">Period</th>{days.map((d) => <th key={d} className="px-3 py-2.5 text-left text-[12px] font-semibold text-ink-muted">{WEEKDAYS[d]}</th>)}</tr></thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.periodId} className="border-t border-line/50 align-top">
                  <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-ink">{p.label}<span className="block text-[11.5px] font-normal text-ink-muted">{clock(p.startTime)}–{clock(p.endTime)}</span></th>
                  {days.map((d) => {
                    const l = t.lessons.find((x) => x.dayOfWeek === d && x.periodId === p.periodId);
                    return <td key={d} className="px-3 py-2.5">{p.isBreak ? <span className="text-ink-muted">Break</span> : l ? <><p className="font-semibold text-ink">{l.subject}</p><p className="text-[11.5px] text-ink-muted">Class {l.section}{l.room ? ` · ${l.room}` : ""}</p></> : <span className="text-ink-muted">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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
  if (data === undefined) return <LoadingState variant="table" label="Loading submissions" />;
  const h = data.homework;
  const submitted = data.students.filter((s) => s.submission).length;
  return (
    <div className="space-y-5">
      <PageHeader title={h.title} description={`Class ${h.section} · ${h.subject} · due ${formatDate(h.dueDate)} · ${submitted}/${data.students.length} submitted`} actions={<Link href="/teacher/homework" className="text-[13px] font-medium text-lagoon hover:underline">All homework</Link>} />
      <Card className="p-5"><p className="whitespace-pre-line text-sm text-ink-soft">{h.description}</p></Card>
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

export function LiveMarksEntry() {
  const params = useSearchParams();
  const router = useRouter();
  const exams = useSchoolQuery(api.exams.list, {});
  const open = useMemo(() => (exams ?? []).filter((e) => e.status === "in_progress" || e.status === "marks_entry"), [exams]);
  const examId = params.get("examId") ?? open[0]?.examId ?? "";
  const exam = useSchoolQuery(api.exams.get, examId ? { examId: examId as Id<"exams"> } : "skip");
  const teaching = useSchoolQuery(api.academics.myTeaching, {});
  const sections = useSchoolQuery(api.academics.listSections, {});
  // Papers this teacher can mark: a paper of the exam whose class + subject matches one of their persisted assignments.
  const slots = useMemo(() => {
    if (!exam || !teaching || !sections) return [];
    const classOf = new Map(sections.map((s) => [s._id as string, s.classId as string]));
    const out: { key: string; examSubjectId: Id<"examSubjects">; sectionId: Id<"sections">; label: string }[] = [];
    for (const a of teaching.assignments) {
      const paper = exam.papers.find((p) => p.subjectId === a.subjectId && p.classId === classOf.get(a.sectionId));
      if (paper) out.push({ key: `${paper.examSubjectId}:${a.sectionId}`, examSubjectId: paper.examSubjectId, sectionId: a.sectionId, label: `${a.sectionName} · ${paper.subject}` });
    }
    return out;
  }, [exam, teaching, sections]);
  const [slotKey, setSlotKey] = useState("");
  useEffect(() => { if (!slots.some((s) => s.key === slotKey)) setSlotKey(slots[0]?.key ?? ""); }, [slots, slotKey]);
  const slot = slots.find((s) => s.key === slotKey);

  if (exams === undefined || teaching === undefined || sections === undefined || (examId && exam === undefined)) return <LoadingState variant="table" label="Loading marks entry" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Marks entry" description="Only papers of the subjects you are assigned to teach in each section are listed." />
      {open.length === 0 ? <Card><EmptyState icon={<Lock className="h-6 w-6" />} title="No examination is open for marks entry" /></Card> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Examination" value={examId} onChange={(e) => router.replace(`/teacher/examinations/marks?examId=${e.target.value}`)} className="w-64">{open.map((e) => <option key={e.examId} value={e.examId}>{e.name}</option>)}</Select>
            <Select aria-label="Paper" value={slotKey} onChange={(e) => setSlotKey(e.target.value)} className="w-64" disabled={slots.length === 0}>{slots.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
          </div>
          {!slot ? <Card><EmptyState title="Nothing to mark in this examination" description="None of this exam's papers are for a subject you teach." /></Card> : <MarksSheet key={slot.key} examSubjectId={slot.examSubjectId} sectionId={slot.sectionId} />}
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
        {sheet.students.length === 0 ? <EmptyState title="No students in this section" /> : (
          <ul className="divide-y divide-line/60">
            {sheet.students.map((s) => {
              const r = rows[s.studentId] ?? { marks: "", absent: false };
              return (
                <li key={s.studentId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-8 text-center text-sm font-bold text-sapphire">{s.rollNo ?? "—"}</span>
                  <span className="min-w-40 flex-1 font-medium text-ink">{s.name}</span>
                  <Input aria-label={`Marks for ${s.name}`} type="number" min={0} max={max} step={0.5} className={`w-28 ${invalidRow(r) ? "border-plum" : ""}`} disabled={!sheet.canEnter || r.absent} value={r.marks}
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
