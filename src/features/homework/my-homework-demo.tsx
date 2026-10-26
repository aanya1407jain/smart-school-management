"use client";
import { useState } from "react";
import { CheckCircle2, ClipboardList, MessageSquare, Paperclip, Send } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import { Badge, Button, Card, EmptyState, FilterBar, FilterSelect, FormField, Input, Modal, PageHeader, QueryView, Segmented, StatusBadge, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { dueLabel, formatDate, formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Filter = "todo" | "submitted" | "reviewed" | "all";

export function MyHomeworkDemo() {
  const studentId = useActiveStudentId();
  const { user } = useSession();
  const opts = useAcademicOptions();
  const [status, setStatus] = useState<Filter>("todo");
  const [subjectId, setSubjectId] = useState("");
  const [submitId, setSubmitId] = useState<string | null>(null);
  const q = useQuery(() => services.homework.getStudentHomework(studentId!, { status, subjectId }), [studentId, status, subjectId], { enabled: !!studentId });
  const target = q.data?.find((h) => h.id === submitId);

  return (
    <div>
      <PageHeader title="My Homework" description="Homework set for your class. Submit before the deadline — your teacher is notified instantly." />
      <Card className="mb-5 p-4">
        <FilterBar>
          <Segmented<Filter> label="Status" value={status} onChange={setStatus} className="col-span-2 sm:col-span-1" options={[{ value: "todo", label: "To do" }, { value: "submitted", label: "Submitted" }, { value: "reviewed", label: "Reviewed" }, { value: "all", label: "All" }]} />
          <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} allLabel="All subjects" options={(opts.data?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </FilterBar>
      </Card>
      <QueryView query={q} loading="cards">
        {(rows) => rows.length === 0 ? (
          <Card><EmptyState icon={<ClipboardList className="h-6 w-6" />} title={status === "todo" ? "Nothing due — you're all caught up" : "No homework assigned yet"} /></Card>
        ) : (
          <ul className="space-y-3">
            {rows.map((h) => (
              <li key={h.id}>
                <Card className={cn("p-5", h.status === "overdue" && "border-purple/30")}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Badge tone="teal">{h.subject}</Badge><StatusBadge status={h.status} /></div>
                      <h2 className="mt-2 font-semibold text-sapphire">{h.title}</h2>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{h.description}</p>
                      <p className="mt-2 text-[12.5px] text-ink-muted">{h.teacher} · set {formatDate(h.assignedOn)} · deadline {formatDate(h.dueDate)}</p>
                      {h.attachmentName && <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-muted"><Paperclip className="h-3.5 w-3.5" /> {h.attachmentName}</p>}
                      {h.submission && (
                        <div className="mt-3 rounded-xl bg-alabaster p-3 text-[13px]">
                          <p className="flex items-center gap-1.5 font-medium text-ink"><CheckCircle2 className="h-4 w-4 text-lagoon" /> Submitted {formatDateTime(h.submission.submittedAt)}</p>
                          <p className="mt-1 text-ink-soft">{h.submission.content}</p>
                          {h.submission.feedback && <p className="mt-2 flex items-start gap-1.5 text-lagoon"><MessageSquare className="mt-0.5 h-3.5 w-3.5" /> {h.submission.feedback}</p>}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <span className={cn("text-sm font-semibold", h.status === "overdue" ? "text-plum" : "text-ink-soft")}>{h.submission ? "Done" : dueLabel(h.dueDate)}</span>
                      {h.homeworkStatus === "active" && (h.status === "pending" || h.status === "overdue" || h.status === "submitted" || h.status === "late") && (
                        <Button size="sm" variant={h.submission ? "outline" : "primary"} onClick={() => setSubmitId(h.id)}><Send className="h-4 w-4" /> {h.submission ? "Resubmit" : "Submit"}</Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      {target && studentId && <SubmitModal homeworkId={target.id} title={target.title} studentId={studentId} onClose={() => setSubmitId(null)} late={target.status === "overdue"} />}
    </div>
  );
}

function SubmitModal({ homeworkId, title, studentId, onClose, late }: { homeworkId: string; title: string; studentId: string; onClose: () => void; late: boolean }) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [attachment, setAttachment] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await services.homework.submit(homeworkId, studentId, content, attachment || null);
      toast({ title: r.status === "late" ? "Submitted late" : "Homework submitted", description: "Your teacher has been notified." });
      onClose();
    } catch (e) { setError(e as Error); }
    setBusy(false);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Submit homework" description={title} size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}><Send className="h-4 w-4" /> Submit</Button></>}>
      <div className="space-y-4">
        {late && <p className="rounded-xl bg-blush/40 px-3 py-2 text-[13px] text-plum">The deadline has passed — this will be marked as a late submission.</p>}
        <FormField label="Your answer or note" hint="Describe what you've done, or paste your answer."><Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></FormField>
        <FormField label="Attachment name" hint="File upload arrives with file storage."><Input value={attachment} onChange={(e) => setAttachment(e.target.value)} placeholder="e.g. exercise-4-3.pdf" /></FormField>
        <FormError error={error} />
      </div>
    </Modal>
  );
}
