"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, ClipboardList, Layers, Loader2, Lock, MessageSquare, Paperclip, Pencil, Plus, Users,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Avatar, Badge, Button, Card, Drawer, EmptyState, FilterBar, FilterSelect, FormField, Input, LinkButton, Modal, PageHeader,
  ProgressBar, SearchInput, Select, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { addDays, dueLabel, formatDate, formatDateTime, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Area = "admin" | "teacher";
type StatusFilter = "active" | "overdue" | "closed" | "all";

// ------------------------------------------------------------------ Shared helpers

/** Readable message from a Convex error (ConvexError data or a plain Error). */
function errorMessage(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  if (e instanceof Error) {
    return e.message.replace(/^\[CONVEX [^\]]+\]\s*/, "").replace(/^(Uncaught )?(Server Error\s*)?/, "").trim() || "Unexpected error";
  }
  return String(e);
}

/** Field errors carried by a ConvexError, e.g. `{ fieldErrors: { title: "Required" } }`. */
function fieldErrorsOf(e: unknown): Record<string, string> {
  const data = (e as { data?: { fieldErrors?: Record<string, string> } })?.data;
  return data && typeof data === "object" && data.fieldErrors ? data.fieldErrors : {};
}

/** "6-A" → "Class 6-A"; leaves labels that already start with "Class" alone. */
function classLabel(label: string) {
  if (!label) return "—";
  return /^class\b/i.test(label) ? label : `Class ${label}`;
}

/** Text from a field that may be a string or an object with displayName / name. */
function labelOf(value: any, ...fallbacks: any[]): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.displayName ?? value.name ?? "";
  for (const f of fallbacks) if (typeof f === "string" && f) return f;
  return "";
}

// ------------------------------------------------------------------ Normalized shapes
// The only place that knows the exact backend field names. Adjust here if they differ.

type HomeworkItem = {
  id: string;
  title: string;
  description: string;
  assignedOn: string;
  dueDate: string;
  status: string;
  sectionId: string;
  sectionLabel: string;
  classId: string;
  subjectId: string;
  subject: string;
  teacher: string;
  submitted: number;
  reviewed: number;
  total: number;
  attachmentName: string | null;
  isClosed: boolean;
  isOverdue: boolean;
};

function normalizeHomework(h: any, today: string): HomeworkItem {
  const status = String(h.status ?? "active");
  const isClosed = status === "closed";
  const dueDate = String(h.dueDate ?? "");
  return {
    id: String(h.homeworkId ?? h._id),
    title: h.title ?? "",
    description: h.description ?? "",
    assignedOn: h.assignedOn ?? h.createdOn ?? "",
    dueDate,
    status,
    sectionId: String(h.sectionId ?? h.section?.sectionId ?? h.section?._id ?? ""),
    sectionLabel: labelOf(h.section, h.sectionName, h.sectionLabel),
    classId: String(h.classId ?? h.section?.classId ?? ""),
    subjectId: String(h.subjectId ?? h.subject?.subjectId ?? h.subject?._id ?? ""),
    subject: labelOf(h.subject, h.subjectName),
    teacher: labelOf(h.teacher, h.teacherName),
    submitted: Number(h.submitted ?? 0),
    reviewed: Number(h.reviewed ?? 0),
    total: Number(h.total ?? h.studentCount ?? h.students ?? 0),
    attachmentName: h.attachmentName ?? null,
    isClosed,
    isOverdue: !isClosed && !!dueDate && dueDate < today,
  };
}

type TeachingPair = { sectionId: string; sectionName: string; subjectId: string; subjectName: string };

function normalizeTeaching(data: any): TeachingPair[] {
  const list: any[] = Array.isArray(data) ? data : data?.assignments ?? [];
  return list.map((a) => ({
    sectionId: String(a.sectionId),
    sectionName: a.sectionName ?? a.sectionLabel ?? "",
    subjectId: String(a.subjectId),
    subjectName: a.subjectName ?? a.subject ?? "",
  }));
}

function matchesFilters(
  h: HomeworkItem,
  f: { search: string; classId: string; sectionId: string; subjectId: string; status: StatusFilter }
) {
  const term = f.search.trim().toLowerCase();
  if (term && !h.title.toLowerCase().includes(term) && !h.description.toLowerCase().includes(term)) return false;
  if (f.classId && h.classId && h.classId !== f.classId) return false;
  if (f.sectionId && h.sectionId !== f.sectionId) return false;
  if (f.subjectId && h.subjectId !== f.subjectId) return false;
  if (f.status === "active") return !h.isClosed && !h.isOverdue;
  if (f.status === "overdue") return h.isOverdue;
  if (f.status === "closed") return h.isClosed;
  return true;
}

// ------------------------------------------------------------------ Loading / error primitives

function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center", className ?? "h-64")}>
      <Loader2 className="h-7 w-7 animate-spin text-ink-muted" aria-label="Loading" />
    </div>
  );
}

/** Convex useQuery throws server errors during render; this turns them into a clean card. */
class QueryBoundary extends Component<{ title: string; children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <EmptyState title={this.props.title} description={errorMessage(this.state.error)} />
        </Card>
      );
    }
    return this.props.children;
  }
}

// ------------------------------------------------------------------ Manager

export function HomeworkManager({ area }: { area: Area }) {
  return (
    <QueryBoundary title="Could not load homework">
      <HomeworkManagerInner area={area} />
    </QueryBoundary>
  );
}

function HomeworkManagerInner({ area }: { area: Area }) {
  const params = useSearchParams();
  const router = useRouter();
  const isTeacher = area === "teacher";
  const isAdmin = area === "admin";

  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [createOpen, setCreateOpen] = useState(isTeacher && params.get("action") === "new");
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  useEffect(() => {
    if (isTeacher && params.get("action") === "new") setCreateOpen(true);
  }, [params, isTeacher]);

  // ---- Teacher data
  const mine = useQuery(api.homework.listMine, isTeacher ? {} : "skip");
  const teaching = useQuery(api.academics.myTeaching, isTeacher ? {} : "skip");

  // ---- Admin data (filters + section homework)
  const years = useQuery(api.academics.listAcademicYears, isAdmin ? {} : "skip");
  const classes = useQuery(api.academics.listClasses, isAdmin ? {} : "skip");
  const subjects = useQuery(api.academics.listSubjects, isAdmin ? {} : "skip");
  const currentYear = useMemo(() => years?.find((y: any) => y.isCurrent) ?? years?.[0] ?? null, [years]);
  const sections = useQuery(
    api.academics.listSections,
    isAdmin && currentYear ? { academicYearId: currentYear._id } : "skip"
  );
  const sectionHomework = useQuery(
    api.homework.listForSection,
    isAdmin && sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip"
  );

  const today = todayISO();
  const teachingPairs = useMemo(() => normalizeTeaching(teaching), [teaching]);

  // ---- Filter options
  const classOptions = useMemo(
    () => (classes ?? []).map((c: any) => ({ value: String(c._id), label: c.name })),
    [classes]
  );
  const sectionOptions = useMemo(() => {
    if (isAdmin) {
      return (sections ?? [])
        .filter((s: any) => !classId || String(s.classId) === classId)
        .map((s: any) => ({ value: String(s._id), label: classLabel(s.displayName) }));
    }
    const seen = new Map<string, string>();
    for (const p of teachingPairs) if (!seen.has(p.sectionId)) seen.set(p.sectionId, classLabel(p.sectionName));
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [isAdmin, sections, classId, teachingPairs]);
  const subjectOptions = useMemo(() => {
    if (isAdmin) return (subjects ?? []).map((s: any) => ({ value: String(s._id), label: s.name }));
    const seen = new Map<string, string>();
    for (const p of teachingPairs) if (!seen.has(p.subjectId)) seen.set(p.subjectId, p.subjectName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [isAdmin, subjects, teachingPairs]);

  // ---- Rows
  const source = isTeacher ? mine : sectionHomework;
  const allRows = useMemo(
    () => (source ? (source as any[]).map((h) => normalizeHomework(h, today)) : undefined),
    [source, today]
  );
  const rows = useMemo(
    () =>
      allRows
        ?.filter((h) => matchesFilters(h, { search, classId: isAdmin ? "" : classId, sectionId, subjectId, status }))
        .sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0)),
    [allRows, search, classId, sectionId, subjectId, status, isAdmin]
  );
  const editing = allRows?.find((h) => h.id === editId);

  const filtersLoading = isAdmin && (years === undefined || classes === undefined || subjects === undefined || (currentYear && sections === undefined));
  const adminNeedsSection = isAdmin && !sectionId;
  const filtered = !!(search.trim() || subjectId || status !== "all" || (isTeacher && sectionId));

  const closeCreate = (o: boolean) => {
    setCreateOpen(o);
    if (!o && params.get("action")) router.replace("/teacher/homework");
  };

  let body: ReactNode;
  if (filtersLoading) {
    body = <Spinner />;
  } else if (adminNeedsSection) {
    body = (
      <Card>
        <EmptyState
          icon={<Layers className="h-6 w-6" />}
          title={sectionOptions.length ? "Choose a section" : "No sections set up yet"}
          description={
            sectionOptions.length
              ? "Pick a class and section above to see the homework set for it, with submission rates."
              : "Create classes and sections in Academics before homework can be assigned."
          }
          action={!sectionOptions.length && <LinkButton href="/admin/academics?tab=classes">Go to academics</LinkButton>}
        />
      </Card>
    );
  } else if (rows === undefined) {
    body = <Spinner />;
  } else if (rows.length === 0) {
    const nothingAtAll = (allRows?.length ?? 0) === 0;
    body = (
      <Card>
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={nothingAtAll ? "No homework assigned yet" : "No homework matches these filters"}
          description={
            !nothingAtAll && filtered
              ? "Try another status, subject or search term."
              : isTeacher
                ? "Create homework for one of your classes."
                : "Homework set by teachers for this section appears here."
          }
          action={
            !nothingAtAll && filtered ? (
              <Button variant="outline" onClick={() => { setSearch(""); setSubjectId(""); setStatus("all"); if (isTeacher) setSectionId(""); }}>
                Clear filters
              </Button>
            ) : (
              isTeacher && <Button onClick={() => setCreateOpen(true)}>Create homework</Button>
            )
          }
        />
      </Card>
    );
  } else {
    body = (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((h) => (
          <HomeworkCard
            key={h.id}
            h={h}
            area={area}
            onEdit={() => setEditId(h.id)}
            onView={() => setViewId(h.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Homework & Assignments" : "Homework"}
        description={
          isAdmin
            ? "Assignments set for each section, with submission rates."
            : "Set homework for your classes and review submissions. Only students of the chosen section see it."
        }
        actions={isTeacher && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create homework</Button>}
      />

      <Card className="mb-5 p-4">
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search title" className="col-span-2 sm:w-56" label="Search homework" />
          {isAdmin && (
            <FilterSelect
              label="Class"
              value={classId}
              onChange={(v) => { setClassId(v); setSectionId(""); }}
              allLabel="All classes"
              options={classOptions}
            />
          )}
          <FilterSelect
            label="Section"
            value={sectionId}
            onChange={setSectionId}
            allLabel={isAdmin ? "Select a section" : "All sections"}
            options={sectionOptions}
          />
          <FilterSelect label="Subject" value={subjectId} onChange={setSubjectId} allLabel="All subjects" options={subjectOptions} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              { value: "active", label: "Active" },
              { value: "overdue", label: "Past deadline" },
              { value: "closed", label: "Closed" },
              { value: "all", label: "All" },
            ]}
          />
        </FilterBar>
      </Card>

      {body}

      {isTeacher && (
        <HomeworkFormModal open={createOpen} onOpenChange={closeCreate} pairs={teachingPairs} pairsLoading={teaching === undefined} />
      )}
      {isTeacher && editing && (
        <HomeworkFormModal
          key={editing.id}
          open
          onOpenChange={(o) => !o && setEditId(null)}
          existing={editing}
          pairs={teachingPairs}
          pairsLoading={false}
        />
      )}

      <Drawer open={!!viewId} onOpenChange={(o) => !o && setViewId(null)} title="Submissions" className="w-[min(100vw,36rem)]">
        {viewId && (
          <QueryBoundary key={viewId} title="Could not load submissions">
            <SubmissionsPanel homeworkId={viewId} />
          </QueryBoundary>
        )}
      </Drawer>
    </div>
  );
}

function HomeworkCard({ h, area, onEdit, onView }: { h: HomeworkItem; area: Area; onEdit: () => void; onView: () => void }) {
  const pct = (h.submitted / Math.max(1, h.total)) * 100;
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <Badge tone="teal">{h.subject || "Subject"}</Badge>
        <div className="flex items-center gap-1.5">
          <Badge tone="outline">{classLabel(h.sectionLabel)}</Badge>
          {h.isClosed && <StatusBadge status="closed" />}
        </div>
      </div>
      <h3 className="mt-3 font-semibold text-sapphire">{h.title}</h3>
      <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{h.description}</p>
      <p className="mt-2 text-[12.5px] text-ink-soft">
        {area === "admin" && h.teacher && <>{h.teacher} · </>}
        {h.assignedOn && <>Set {formatDate(h.assignedOn)} · </>}
        <span className={h.isOverdue ? "font-medium text-plum" : ""}>
          {h.isClosed ? `Was due ${formatDate(h.dueDate)}` : dueLabel(h.dueDate)}
        </span>
      </p>
      {h.attachmentName && (
        <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-muted"><Paperclip className="h-3.5 w-3.5" /> {h.attachmentName}</p>
      )}
      <div className="mt-auto pt-4">
        <div className="flex items-center gap-2">
          <ProgressBar value={pct} label="Submitted" />
          <span className="shrink-0 text-[12px] font-medium text-ink-soft">{h.submitted}/{h.total}</span>
        </div>
        {h.submitted > 0 && (
          <p className="mt-1 text-[12px] text-ink-muted">{h.reviewed}/{h.submitted} reviewed</p>
        )}
        <div className="mt-3 flex gap-2">
          {area === "teacher" ? (
            <>
              <LinkButton href={`/teacher/homework/${h.id}`} size="sm" className="flex-1"><Users className="h-4 w-4" /> Submissions</LinkButton>
              {!h.isClosed && (
                <Button size="sm" variant="outline" onClick={onEdit} aria-label={`Edit ${h.title}`}><Pencil className="h-4 w-4" /></Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="outline" className="flex-1" onClick={onView}>View submissions</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Create / edit modal

type HomeworkForm = { title: string; description: string; subjectId: string; sectionId: string; dueDate: string };

const blankForm = (): HomeworkForm => ({ title: "", description: "", subjectId: "", sectionId: "", dueDate: addDays(todayISO(), 3) });

function HomeworkFormModal({
  open,
  onOpenChange,
  existing,
  pairs,
  pairsLoading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: HomeworkItem;
  pairs: TeachingPair[];
  pairsLoading: boolean;
}) {
  const { toast } = useToast();
  const createHomework = useMutation(api.homework.create);
  const updateHomework = useMutation(api.homework.update);
  const closeHomework = useMutation(api.homework.close);

  const [form, setForm] = useState<HomeworkForm>(() =>
    existing
      ? { title: existing.title, description: existing.description, subjectId: existing.subjectId, sectionId: existing.sectionId, dueDate: existing.dueDate }
      : blankForm()
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  const pairKey = form.sectionId && form.subjectId ? `${form.sectionId}|${form.subjectId}` : "";
  const selectedPair = pairs.find((p) => p.sectionId === form.sectionId && p.subjectId === form.subjectId);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Enter a title";
    if (!form.description.trim()) e.description = "Add instructions for students";
    if (!form.dueDate) e.dueDate = "Choose a deadline";
    else if (!existing && form.dueDate < todayISO()) e.dueDate = "Deadline can't be in the past";
    if (!existing && (!form.sectionId || !form.subjectId)) e.sectionId = "Choose one of your classes";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (existing) {
        await updateHomework({
          homeworkId: existing.id as Id<"homework">,
          title: form.title.trim(),
          description: form.description.trim(),
          dueDate: form.dueDate,
        });
        toast({ title: "Homework updated" });
      } else {
        await createHomework({
          sectionId: form.sectionId as Id<"sections">,
          subjectId: form.subjectId as Id<"subjects">,
          title: form.title.trim(),
          description: form.description.trim(),
          dueDate: form.dueDate,
        });
        toast({
          title: "Homework assigned",
          description: selectedPair ? `Visible to ${classLabel(selectedPair.sectionName)} only.` : undefined,
        });
        setForm(blankForm());
      }
      onOpenChange(false);
    } catch (e) {
      const fe = fieldErrorsOf(e);
      setErrors(fe);
      setError(new Error(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!existing) return;
    setClosing(true);
    try {
      await closeHomework({ homeworkId: existing.id as Id<"homework"> });
      toast({ title: "Homework closed", description: "Students can no longer submit." });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not close homework", description: errorMessage(e), tone: "error" });
    } finally {
      setClosing(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? "Edit homework" : "Create homework"}
      description={existing ? undefined : "Choose one of your classes. Only students in that section will see it."}
      size="lg"
      footer={
        <>
          {existing && !existing.isClosed && (
            <Button variant="ghost" className="mr-auto" loading={closing} onClick={close}>
              <Lock className="h-4 w-4" /> Close submissions
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={submit} disabled={!existing && !pairsLoading && pairs.length === 0}>
            {existing ? "Save changes" : "Assign homework"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Title" required error={errors.title} className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Quadratic Equations — Exercise 4.4" />
        </FormField>

        {existing ? (
          <div className="sm:col-span-2 flex flex-wrap gap-1.5">
            <Badge tone="teal">{existing.subject}</Badge>
            <Badge tone="outline">{classLabel(existing.sectionLabel)}</Badge>
          </div>
        ) : (
          <FormField label="Class & subject" required error={errors.sectionId ?? errors.subjectId} className="sm:col-span-2">
            {pairsLoading ? (
              <div className="flex h-10 items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading your classes…</div>
            ) : pairs.length === 0 ? (
              <p className="text-sm text-plum">You aren't assigned to any class yet. Ask the office to assign you a subject and section.</p>
            ) : (
              <Select
                value={pairKey}
                onChange={(e) => {
                  const [sectionId, subjectId] = e.target.value.split("|");
                  setForm({ ...form, sectionId: sectionId ?? "", subjectId: subjectId ?? "" });
                }}
              >
                <option value="">Select one of your classes</option>
                {pairs.map((p) => (
                  <option key={`${p.sectionId}|${p.subjectId}`} value={`${p.sectionId}|${p.subjectId}`}>
                    {classLabel(p.sectionName)} · {p.subjectName}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )}

        <FormField label="Deadline" required error={errors.dueDate}>
          <Input
            type="date"
            min={existing ? undefined : todayISO()}
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </FormField>
        <div className="hidden sm:block" />

        <FormField label="Instructions" required error={errors.description} className="sm:col-span-2">
          <Textarea
            rows={5}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What should students do? Mention pages, questions and format."
          />
        </FormField>
        <div className="sm:col-span-2"><FormError error={error && !Object.keys(errors).length ? error : null} /></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Submissions

type SubmissionRow = {
  studentId: string;
  name: string;
  rollNo: string | number | null;
  status: string;
  submission: {
    id: string;
    content: string;
    submittedAt: number | string | null;
    attachmentName: string | null;
    feedback: string | null;
    status: string;
  } | null;
};

function normalizeSubmissions(d: any) {
  const hw = d?.homework ?? d ?? {};
  const rawRows: any[] = d?.rows ?? d?.students ?? d?.submissions ?? [];
  const rows: SubmissionRow[] = rawRows.map((r) => {
    const s = r.submission ?? (r.submissionId ? r : null);
    const submission = s
      ? {
          id: String(s.submissionId ?? s._id),
          content: s.content ?? s.text ?? "",
          submittedAt: s.submittedAt ?? null,
          attachmentName: s.attachmentName ?? null,
          feedback: s.feedback ?? null,
          status: String(s.status ?? "submitted"),
        }
      : null;
    return {
      studentId: String(r.studentId),
      name: r.name ?? r.studentName ?? "",
      rollNo: r.rollNo ?? null,
      status: String(r.status ?? submission?.status ?? "pending"),
      submission,
    };
  });
  return {
    homework: {
      title: hw.title ?? "",
      description: hw.description ?? "",
      dueDate: hw.dueDate ?? "",
      subject: labelOf(hw.subject, hw.subjectName),
      sectionLabel: labelOf(hw.section, hw.sectionName, hw.sectionLabel),
    },
    canReview: d?.canReview ?? true,
    rows,
  };
}

export function SubmissionsPanel({ homeworkId }: { homeworkId: string }) {
  const { toast } = useToast();
  const raw = useQuery(api.homework.submissions, { homeworkId: homeworkId as Id<"homework"> });
  const reviewSubmission = useMutation(api.homework.review);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);

  const d = useMemo(() => (raw === undefined || raw === null ? raw : normalizeSubmissions(raw)), [raw]);

  if (d === undefined) return <Spinner className="h-40" />;
  if (d === null) {
    return <EmptyState title="Homework not found" description="It may have been removed, or you don't have access to it." />;
  }

  const submitted = d.rows.filter((r) => r.submission).length;

  const review = async (r: SubmissionRow) => {
    if (!r.submission) return;
    setReviewing(r.studentId);
    try {
      await reviewSubmission({
        submissionId: r.submission.id as Id<"homeworkSubmissions">,
        feedback: (feedback[r.studentId] ?? "").trim(),
      });
      setFeedback((x) => {
        const c = { ...x };
        delete c[r.studentId];
        return c;
      });
      toast({ title: "Marked as reviewed", description: `${r.name} has been notified.` });
    } catch (e) {
      toast({ title: "Could not review submission", description: errorMessage(e), tone: "error" });
    } finally {
      setReviewing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">
          {d.homework.subject}{d.homework.sectionLabel && ` · ${classLabel(d.homework.sectionLabel)}`}
        </p>
        <h2 className="text-lg font-semibold text-sapphire">{d.homework.title}</h2>
        {d.homework.description && <p className="mt-1 text-sm text-ink-muted">{d.homework.description}</p>}
        <p className="mt-2 text-[13px] text-ink-soft">
          {d.homework.dueDate && <>Due {formatDate(d.homework.dueDate)} · </>}{submitted}/{d.rows.length} submitted
        </p>
      </div>

      {d.rows.length === 0 ? (
        <EmptyState title="No students in this section" description="Students enrolled in the section will appear here." />
      ) : (
        <ul className="space-y-2.5">
          {d.rows.map((r) => (
            <li
              key={r.studentId}
              className={cn("rounded-xl border p-3.5", r.submission ? "border-line/70 bg-white" : "border-dashed border-line bg-alabaster/50")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={r.name} size="sm" />
                  <div>
                    <p className="text-sm font-semibold text-ink">{r.name}</p>
                    <p className="text-[12px] text-ink-muted">
                      Roll {r.rollNo ?? "—"}
                      {r.submission?.submittedAt && ` · ${formatDateTime(r.submission.submittedAt as any)}`}
                    </p>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.submission && (
                <div className="mt-2.5 space-y-2 pl-10">
                  {r.submission.content && <p className="text-[13px] text-ink-soft">{r.submission.content}</p>}
                  {r.submission.attachmentName && (
                    <p className="flex items-center gap-1 text-[12px] text-ink-muted"><Paperclip className="h-3.5 w-3.5" /> {r.submission.attachmentName}</p>
                  )}
                  {r.submission.feedback && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-teal-soft/60 px-2.5 py-1.5 text-[12.5px] text-lagoon">
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5" /> {r.submission.feedback}
                    </p>
                  )}
                  {d.canReview && r.submission.status !== "reviewed" && (
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Feedback for ${r.name}`}
                        placeholder="Feedback (optional)"
                        value={feedback[r.studentId] ?? ""}
                        onChange={(e) => setFeedback({ ...feedback, [r.studentId]: e.target.value })}
                        className="h-9"
                      />
                      <Button size="sm" loading={reviewing === r.studentId} disabled={!!reviewing && reviewing !== r.studentId} onClick={() => review(r)}>
                        <CheckCircle2 className="h-4 w-4" /> Review
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TeacherHomeworkDetail({ homeworkId }: { homeworkId: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/teacher/homework" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All homework
      </Link>
      <Card className="p-5 sm:p-6">
        <QueryBoundary key={homeworkId} title="Could not load submissions">
          <SubmissionsPanel homeworkId={homeworkId} />
        </QueryBoundary>
      </Card>
    </div>
  );
}
