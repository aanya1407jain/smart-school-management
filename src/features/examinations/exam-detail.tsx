"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Megaphone, Pencil, PenLine, PlayCircle, RotateCcw } from "lucide-react";
import type { ExamPaper } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, FilterBar, FilterSelect, FormField, GlassCard, Input, Modal,
  PageHeader, ProgressBar, QueryView, Select, StatusBadge, Tabs, TabsContent, TabsList, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { formatClock, formatDate, formatWeekday } from "@/lib/utils/dates";
import { ResultSheet } from "./result-sheet";

export function ExamDetail({ examId, area }: { examId: string; area: "admin" | "teacher" }) {
  const { toast } = useToast();
  const q = useQuery(() => services.exams.get(examId), [examId]);
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [editPaper, setEditPaper] = useState<(ExamPaper & { subject: string; className: string }) | null>(null);
  const [confirm, setConfirm] = useState<null | "publish" | "start" | "marks" | "reopen">(null);
  const [busy, setBusy] = useState(false);
  const [resultSection, setResultSection] = useState("");

  return (
    <QueryView query={q}>
      {(d) => {
        const e = d.exam;
        const papers = d.papers.filter((p) => (!classFilter || p.classId === classFilter) && (!subjectFilter || p.subjectId === subjectFilter));
        const classes = Array.from(new Map(d.papers.map((p) => [p.classId, p.className])).entries());
        const subjects = Array.from(new Map(d.papers.map((p) => [p.subjectId, p.subject])).entries());
        const sectionOptions = Array.from(new Map(d.papers.flatMap((p) => p.sections.map((s) => [s.sectionId, s.label] as const))).entries()).sort((a, b) => parseInt(a[1]) - parseInt(b[1]) || a[1].localeCompare(b[1]));
        const activeSection = resultSection || sectionOptions[0]?.[0] || "";
        const marksHref = (paperId: string, sectionId: string) => `/${area}/examinations/marks?paper=${paperId}&section=${sectionId}`;
        return (
          <div className="space-y-5">
            <PageHeader
              eyebrow={`${e.term} · ${formatDate(e.startDate)} – ${formatDate(e.endDate)}`}
              title={<span className="flex flex-wrap items-center gap-3">{e.name} <StatusBadge status={e.status} /></span>}
              description={area === "admin" ? "Workflow: Schedule → Exam in progress → Marks entry → Publish results." : "Enter marks for the subjects and sections you teach."}
              actions={area === "admin" && (
                <>
                  {e.status === "scheduled" && <Button variant="outline" onClick={() => setConfirm("start")}><PlayCircle className="h-4 w-4" /> Start exam</Button>}
                  {(e.status === "scheduled" || e.status === "in_progress") && <Button variant="outline" onClick={() => setConfirm("marks")}><PenLine className="h-4 w-4" /> Open marks entry</Button>}
                  {e.status === "published" && <Button variant="outline" onClick={() => setConfirm("reopen")}><RotateCcw className="h-4 w-4" /> Reopen marks entry</Button>}
                  {e.status !== "published" && <Button onClick={() => setConfirm("publish")} disabled={!!d.progress?.pending.length}><Megaphone className="h-4 w-4" /> Publish results</Button>}
                </>
              )}
            />

            {d.progress && (
              <GlassCard className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="lg:w-72">
                    <p className="text-[13px] text-ink-muted">Marks entry progress</p>
                    <p className="text-2xl font-semibold text-sapphire">{d.progress.complete}/{d.progress.total} <span className="text-sm font-medium text-ink-muted">paper–section sheets</span></p>
                    <ProgressBar className="mt-2" value={d.progress.percentage} label="Marks entry progress" />
                  </div>
                  <div className="flex-1">
                    {d.progress.pending.length === 0 ? (
                      <p className="flex items-center gap-2 text-sm text-lagoon"><CheckCircle2 className="h-5 w-5" /> {e.status === "published" ? "Results are published and visible to students." : "All marks entered — ready to publish."}</p>
                    ) : (
                      <>
                        <p className="mb-2 text-[13px] font-medium text-ink-soft">Waiting for marks ({d.progress.pending.length})</p>
                        <ul className="flex flex-wrap gap-2">
                          {d.progress.pending.slice(0, 10).map((p) => (
                            <li key={`${p.paperId}-${p.sectionId}`}>
                              <Link href={marksHref(p.paperId, p.sectionId)} className="inline-flex items-center gap-1.5 rounded-full border border-mauve/40 bg-blush/25 px-3 py-1 text-[12.5px] text-plum hover:bg-blush/45">
                                {p.subject} {p.label}{p.teacher && <span className="text-ink-muted">· {p.teacher}</span>}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              </GlassCard>
            )}

            <Tabs defaultValue="schedule">
              <TabsList items={[{ value: "schedule", label: "Date sheet & marks" }, { value: "results", label: "Results" }]} />
              <TabsContent value="schedule">
                <Card className="p-4 sm:p-5">
                  <FilterBar>
                    <FilterSelect label="Class" value={classFilter} onChange={setClassFilter} allLabel="All classes" options={classes.map(([value, label]) => ({ value, label }))} />
                    <FilterSelect label="Subject" value={subjectFilter} onChange={setSubjectFilter} allLabel="All subjects" options={subjects.map(([value, label]) => ({ value, label }))} />
                  </FilterBar>
                  <div className="mt-4">
                    <DataTable
                      caption="Date sheet"
                      rows={papers}
                      getRowId={(p) => p.id}
                      empty={<EmptyState title="No papers match these filters" />}
                      columns={[
                        { key: "date", header: "Date", primary: true, cell: (p) => <div><p className="font-semibold text-ink">{formatDate(p.date)}</p><p className="text-[12px] text-ink-muted">{formatWeekday(p.date)} · {formatClock(p.startTime)}–{formatClock(p.endTime)}</p></div> },
                        { key: "class", header: "Class", cell: (p) => p.className },
                        { key: "subject", header: "Subject", cell: (p) => <span className="font-medium text-ink">{p.subject}</span> },
                        { key: "max", header: "Max / pass", cell: (p) => `${p.maxMarks} / ${p.passMarks}` },
                        {
                          key: "sections", header: "Marks by section", mobileLabel: "Sections",
                          cell: (p) => (
                            <div className="flex flex-wrap gap-1.5">
                              {p.sections.map((s) => {
                                const label = `${s.label} ${s.entered}/${s.total}`;
                                const tone = s.complete ? "teal" : s.entered ? "lavender" : "outline";
                                return s.canEnter && e.status !== "scheduled" ? (
                                  <Link key={s.sectionId} href={marksHref(p.id, s.sectionId)} className="rounded-full focus-visible:shadow-focus"><Badge tone={tone} className="cursor-pointer hover:ring-lagoon/40">{label}</Badge></Link>
                                ) : <Badge key={s.sectionId} tone={tone}>{label}</Badge>;
                              })}
                            </div>
                          ),
                        },
                      ]}
                      rowActions={area === "admin" && e.status !== "published" ? (p) => <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.subject} paper for ${p.className}`} onClick={() => setEditPaper(p)}><Pencil className="h-4 w-4" /></Button> : undefined}
                    />
                  </div>
                </Card>
              </TabsContent>
              <TabsContent value="results">
                <Card>
                  <CardHeader title="Class result sheet" description={e.status === "published" ? "Published — students can see these results." : "Preview — not yet visible to students."} action={<Select aria-label="Section" value={activeSection} onChange={(ev) => setResultSection(ev.target.value)} className="w-32">{sectionOptions.map(([id, label]) => <option key={id} value={id}>Class {label}</option>)}</Select>} />
                  <div className="p-5">{activeSection ? <ResultSheet examId={e.id} sectionId={activeSection} /> : <EmptyState title="No sections" />}</div>
                </Card>
              </TabsContent>
            </Tabs>

            {editPaper && <EditPaperModal paper={editPaper} onClose={() => setEditPaper(null)} />}
            <ConfirmDialog
              open={!!confirm}
              onOpenChange={(o) => !o && setConfirm(null)}
              title={confirm === "publish" ? "Publish results?" : confirm === "start" ? "Mark exam as in progress?" : confirm === "reopen" ? "Reopen marks entry?" : "Open marks entry?"}
              description={confirm === "publish" ? "Grades are calculated from the entered marks. Students and guardians will be notified and can view their results immediately." : confirm === "reopen" ? "Results will be hidden from students until you publish again." : "Teachers will be able to enter marks for their subjects and sections."}
              confirmLabel={confirm === "publish" ? "Publish results" : "Confirm"}
              loading={busy}
              onConfirm={async () => {
                setBusy(true);
                try {
                  if (confirm === "publish") await services.exams.publish(e.id);
                  else await services.exams.setStatus(e.id, confirm === "start" ? "in_progress" : "marks_entry");
                  toast({ title: confirm === "publish" ? "Results published" : "Exam status updated", description: confirm === "publish" ? "Students and guardians have been notified." : undefined });
                } catch (err) {
                  toast({ title: "Action failed", description: (err as Error).message, tone: "error" });
                }
                setBusy(false);
                setConfirm(null);
              }}
            />
          </div>
        );
      }}
    </QueryView>
  );
}

function EditPaperModal({ paper, onClose }: { paper: ExamPaper & { subject: string; className: string }; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ date: paper.date, startTime: paper.startTime, endTime: paper.endTime, maxMarks: paper.maxMarks });
  const m = useMutation(services.exams.updatePaper);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${paper.subject} · ${paper.className}`} description="Adjust the date sheet entry." size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={async () => { if (await m.mutate(paper.id, form)) { toast({ title: "Paper updated" }); onClose(); } }}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" className="col-span-2"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></FormField>
        <FormField label="Starts"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></FormField>
        <FormField label="Ends"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></FormField>
        <FormField label="Max marks" error={m.fieldErrors.maxMarks} className="col-span-2"><Input type="number" value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: Number(e.target.value) })} /></FormField>
        <div className="col-span-2"><FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} /></div>
      </div>
    </Modal>
  );
}

