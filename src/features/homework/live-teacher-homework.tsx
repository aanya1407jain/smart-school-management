"use client";
/**
 * LIVE teacher homework: list, set, edit and review submissions (Academics).
 */
import { useState } from "react";
import Link from "next/link";
import { ClipboardList, Plus, Save } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { AttachmentList, UploadButton } from "@/features/shared/attachments";
import { getAppError } from "@/lib/convex/errors";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

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
