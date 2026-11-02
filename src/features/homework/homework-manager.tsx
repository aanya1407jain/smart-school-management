"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardList, Lock, MessageSquare, Paperclip, Pencil, Plus, Unlock, Users } from "lucide-react";
import type { HomeworkInput } from "@/lib/services/homework.service";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import {
  Avatar, Badge, Button, Card, CardHeader, Checkbox, Drawer, EmptyState, FilterBar, FilterSelect, FormField, Input, LinkButton, Modal, PageHeader,
  ProgressBar, QueryView, SearchInput, Select, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { addDays, dueLabel, formatDate, formatDateTime, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Area = "admin" | "teacher";

export function HomeworkManager({ area }: { area: Area }) {
  const params = useSearchParams();
  const router = useRouter();
  const opts = useAcademicOptions();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [status, setStatus] = useState("active");
  const [createOpen, setCreateOpen] = useState(params.get("action") === "new");
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  useEffect(() => { if (params.get("action") === "new") setCreateOpen(true); }, [params]);
  const q = useQuery(() => services.homework.list({ search, classId, sectionId, subjectId, status: status as "active" }), [search, classId, sectionId, subjectId, status]);
  const editing = q.data?.find((h) => h.id === editId);

  return (
    <div>
      <PageHeader
        title={area === "admin" ? "Homework & Assignments" : "Homework"}
        description={area === "admin" ? "Every assignment set across the school, with submission rates." : "Set homework for your classes and review submissions. Only students of the chosen section see it."}
        actions={area === "teacher" && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create homework</Button>}
      />
      <Card className="mb-5 p-4">
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search title" className="col-span-2 sm:w-56" label="Search homework" />
          <FilterSelect label="Class" value={classId} onChange={(v) => { setClassId(v); setSectionId(""); }} allLabel="All classes" options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect label="Section" value={sectionId} onChange={setSectionId} allLabel="All sections" options={(opts.data?.sections ?? []).filter((s) => !classId || s.classId === classId).map((s) => ({ value: s.id, label: `Class ${s.label}` }))} />
          <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} allLabel="All subjects" options={(opts.data?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "overdue", label: "Past deadline" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
        </FilterBar>
      </Card>
      <QueryView query={q} loading="cards">
        {(rows) => rows.length === 0 ? (
          <Card><EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No homework assigned yet" description={area === "teacher" ? "Create homework for one of your classes." : "Homework set by teachers appears here."} action={area === "teacher" && <Button onClick={() => setCreateOpen(true)}>Create homework</Button>} /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((h) => (
              <Card key={h.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <Badge tone="teal">{h.subject}</Badge>
                  <div className="flex items-center gap-1.5">
                    <Badge tone="outline">Class {h.sectionLabel}</Badge>
                    {h.status === "closed" && <StatusBadge status="closed" />}
                  </div>
                </div>
                <h3 className="mt-3 font-semibold text-sapphire">{h.title}</h3>
                <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{h.description}</p>
                <p className="mt-2 text-[12.5px] text-ink-soft">{area === "admin" && <>{h.teacher} · </>}Set {formatDate(h.assignedOn)} · <span className={h.isOverdue ? "font-medium text-plum" : ""}>{h.status === "closed" ? `Was due ${formatDate(h.dueDate)}` : dueLabel(h.dueDate)}</span></p>
                {h.attachmentName && <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-muted"><Paperclip className="h-3.5 w-3.5" /> {h.attachmentName}</p>}
                <div className="mt-auto pt-4">
                  <div className="flex items-center gap-2"><ProgressBar value={(h.submitted / Math.max(1, h.total)) * 100} label="Submitted" /><span className="shrink-0 text-[12px] font-medium text-ink-soft">{h.submitted}/{h.total}</span></div>
                  <div className="mt-3 flex gap-2">
                    {area === "teacher" ? (
                      <>
                        <LinkButton href={`/teacher/homework/${h.id}`} size="sm" className="flex-1"><Users className="h-4 w-4" /> Submissions</LinkButton>
                        {h.canEdit && <Button size="sm" variant="outline" onClick={() => setEditId(h.id)} aria-label={`Edit ${h.title}`}><Pencil className="h-4 w-4" /></Button>}
                      </>
                    ) : <Button size="sm" variant="outline" className="flex-1" onClick={() => setViewId(h.id)}>View submissions</Button>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      {area === "teacher" && <HomeworkFormModal open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o && params.get("action")) router.replace("/teacher/homework"); }} />}
      {editing && <HomeworkFormModal open onOpenChange={(o) => !o && setEditId(null)} existing={editing} />}
      <Drawer open={!!viewId} onOpenChange={(o) => !o && setViewId(null)} title="Submissions" className="w-[min(100vw,36rem)]">
        {viewId && <SubmissionsPanel homeworkId={viewId} />}
      </Drawer>
    </div>
  );
}

function HomeworkFormModal({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (o: boolean) => void; existing?: HomeworkInput & { id: string; status: string } }) {
  const { toast } = useToast();
  const assignments = useQuery(() => services.dashboard.getTeacherDashboard(), [], { enabled: open && !existing });
  const [form, setForm] = useState<HomeworkInput>(existing ?? { title: "", description: "", subjectId: "", sectionId: "", dueDate: addDays(todayISO(), 3), attachmentName: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const pairs = assignments.data?.assignments ?? [];

  // Group unique subjects taught by this teacher
  const subjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const p of pairs) {
      if (!map.has(p.subjectId)) {
        map.set(p.subjectId, { id: p.subjectId, name: p.subject });
      }
    }
    return [...map.values()];
  }, [pairs]);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");

  useEffect(() => {
    if (!existing && subjects.length > 0 && !selectedSubjectId) {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId, existing]);

  // Sections that teach the selected subject
  const availableSections = useMemo(() => {
    return pairs.filter((p) => p.subjectId === selectedSubjectId);
  }, [pairs, selectedSubjectId]);

  // Multi-section selection state
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);

  useEffect(() => {
    if (!existing && availableSections.length > 0) {
      setSelectedSectionIds(availableSections.map((s) => s.sectionId));
    }
  }, [availableSections, existing]);

  const toggleSection = (id: string) => {
    setSelectedSectionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedSectionIds(availableSections.map((s) => s.sectionId));
  };

  const clearAll = () => {
    setSelectedSectionIds([]);
  };

  const submit = async () => {
    setBusy(true); setError(null); setErrors({});
    try {
      if (existing) {
        await services.homework.update(existing.id, form);
        toast({ title: "Homework updated" });
      } else {
        if (!selectedSubjectId || selectedSectionIds.length === 0) {
          throw new Error("Please select a subject and at least one section.");
        }
        if (!form.title.trim() || !form.description.trim()) {
          throw new Error("Title and instructions are required.");
        }

        // Create homework for each selected section
        let totalNotified = 0;
        const labels: string[] = [];

        for (const secId of selectedSectionIds) {
          const r = await services.homework.create({
            ...form,
            subjectId: selectedSubjectId,
            sectionId: secId,
          });
          totalNotified += r.notified;
          labels.push(r.sectionLabel);
        }

        toast({
          title: "Homework assigned",
          description: `Assigned to Class ${labels.join(", ")} · ${totalNotified} students notified.`,
        });

        setForm({ title: "", description: "", subjectId: "", sectionId: "", dueDate: addDays(todayISO(), 3), attachmentName: null });
      }
      onOpenChange(false);
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {});
    }
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? "Edit homework" : "Create homework"}
      description={existing ? undefined : "Choose a subject and select one or more sections to assign homework."}
      size="lg"
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={async () => {
                await services.homework.setStatus(existing.id, existing.status === "closed" ? "active" : "closed");
                toast({ title: existing.status === "closed" ? "Homework reopened" : "Homework closed" });
                onOpenChange(false);
              }}
            >
              {existing.status === "closed" ? <><Unlock className="h-4 w-4" /> Reopen</> : <><Lock className="h-4 w-4" /> Close submissions</>}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={submit}>{existing ? "Save changes" : "Assign homework"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Title" required error={errors.title} className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Quadratic Equations — Exercise 4.4" />
        </FormField>

        {!existing && (
          <>
            <FormField label="Subject" required className="sm:col-span-2">
              <Select value={selectedSubjectId} onChange={(e) => setSelectedSubjectId(e.target.value)}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Assign to Sections <span className="text-plum">*</span>
                </span>
                {availableSections.length > 1 && (
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={selectAll}>
                      Select all
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={clearAll}>
                      Clear
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3 rounded-xl border border-line/60 bg-paper-soft/40 p-3">
                {availableSections.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={`Class ${p.sectionLabel} (${p.students} students)`}
                    checked={selectedSectionIds.includes(p.sectionId)}
                    onChange={() => toggleSection(p.sectionId)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <FormField label="Deadline" required error={errors.dueDate}>
          <Input type="date" min={todayISO()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </FormField>

        <FormField label="Attachment" hint="File upload arrives with file storage — the name is saved for now.">
          <Input value={form.attachmentName ?? ""} onChange={(e) => setForm({ ...form, attachmentName: e.target.value || null })} placeholder="e.g. worksheet.pdf" />
        </FormField>

        <FormField label="Instructions" required error={errors.description} className="sm:col-span-2">
          <Textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What should students do? Mention pages, questions and format." />
        </FormField>

        <div className="sm:col-span-2">
          <FormError error={error && !Object.keys(errors).length ? error : null} />
        </div>
      </div>
    </Modal>
  );
}

export function SubmissionsPanel({ homeworkId }: { homeworkId: string }) {
  const { toast } = useToast();
  const q = useQuery(() => services.homework.getSubmissions(homeworkId), [homeworkId]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  return (
    <QueryView query={q} loading="inline">
      {(d) => {
        const submitted = d.rows.filter((r) => r.submission).length;
        return (
          <div className="space-y-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{d.homework.subject} · Class {d.homework.sectionLabel}</p>
              <h2 className="text-lg font-semibold text-sapphire">{d.homework.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{d.homework.description}</p>
              <p className="mt-2 text-[13px] text-ink-soft">Due {formatDate(d.homework.dueDate)} · {submitted}/{d.rows.length} submitted</p>
            </div>
            <ul className="space-y-2.5">
              {d.rows.map((r) => (
                <li key={r.studentId} className={cn("rounded-xl border p-3.5", r.submission ? "border-line/70 bg-white" : "border-dashed border-line bg-alabaster/50")}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5"><Avatar name={r.name} size="sm" /><div><p className="text-sm font-semibold text-ink">{r.name}</p><p className="text-[12px] text-ink-muted">Roll {r.rollNo}{r.submission && ` · ${formatDateTime(r.submission.submittedAt)}`}</p></div></div>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.submission && (
                    <div className="mt-2.5 space-y-2 pl-10">
                      <p className="text-[13px] text-ink-soft">{r.submission.content}</p>
                      {r.submission.attachmentName && <p className="flex items-center gap-1 text-[12px] text-ink-muted"><Paperclip className="h-3.5 w-3.5" /> {r.submission.attachmentName}</p>}
                      {r.submission.feedback && <p className="flex items-start gap-1.5 rounded-lg bg-teal-soft/60 px-2.5 py-1.5 text-[12.5px] text-lagoon"><MessageSquare className="mt-0.5 h-3.5 w-3.5" /> {r.submission.feedback}</p>}
                      {d.canReview && r.submission.status !== "reviewed" && (
                        <div className="flex gap-2">
                          <Input aria-label={`Feedback for ${r.name}`} placeholder="Feedback (optional)" value={feedback[r.studentId] ?? ""} onChange={(e) => setFeedback({ ...feedback, [r.studentId]: e.target.value })} className="h-9" />
                          <Button size="sm" onClick={async () => { await services.homework.review(r.submission!.id, feedback[r.studentId] ?? ""); toast({ title: "Marked as reviewed", description: `${r.name} has been notified.` }); }}><CheckCircle2 className="h-4 w-4" /> Review</Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </QueryView>
  );
}

export function TeacherHomeworkDetail({ homeworkId }: { homeworkId: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/teacher/homework" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> All homework</Link>
      <Card className="p-5 sm:p-6"><SubmissionsPanel homeworkId={homeworkId} /></Card>
    </div>
  );
}