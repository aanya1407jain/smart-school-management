"use client";
/**
 * LIVE teacher examinations and marks entry (also the admin marks page) (Examinations).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, Lock, Save } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { Button, Card, CardHeader, Checkbox, DataTable, EmptyState, Input, LoadingState, PageHeader, ProgressBar, Select, StatusBadge, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";
import { getAppError } from "@/lib/convex/errors";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

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
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-inset ring-line/60">
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
