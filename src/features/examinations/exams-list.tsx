"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, Plus } from "lucide-react";
import type { ExamStatus } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import {
  Button, Card, Checkbox, EmptyState, FilterBar, FilterSelect, FormField, Input, Modal, PageHeader, ProgressBar, QueryView, SearchInput, Select, StatusBadge, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { formatDate, addDays, todayISO } from "@/lib/utils/dates";
import { EXAM_TYPE_LABELS } from "@/lib/constants/labels";

export function ExamsList() {
  const router = useRouter();
  const params = useSearchParams();
  const opts = useAcademicOptions();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(params.get("action") === "new");
  useEffect(() => { if (params.get("action") === "new") setOpen(true); }, [params]);
  const q = useQuery(() => services.exams.list({ search, classId, status: (status || "all") as ExamStatus | "all" }), [search, classId, status]);

  return (
    <div>
      <PageHeader title="Examinations & Results" description="Create exams, publish date sheets, track marks entry and publish results." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Create examination</Button>} />
      <Card className="mb-5 p-4">
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search exams" className="col-span-2 sm:w-64" label="Search exams" />
          <FilterSelect label="Class" value={classId} onChange={setClassId} allLabel="All classes" options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect label="Status" value={status} onChange={setStatus} allLabel="All statuses" options={[{ value: "scheduled", label: "Scheduled" }, { value: "in_progress", label: "In progress" }, { value: "marks_entry", label: "Marks entry" }, { value: "published", label: "Published" }]} />
        </FilterBar>
      </Card>
      <QueryView query={q} loading="cards">
        {(rows) => rows.length === 0 ? <Card><EmptyState title="No upcoming examinations" description="Create an examination to publish its date sheet." action={<Button onClick={() => setOpen(true)}>Create examination</Button>} /></Card> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((e) => (
              <button key={e.id} onClick={() => router.push(`/admin/examinations/${e.id}`)} className="glass group rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift">
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-soft text-lagoon"><BookOpenCheck className="h-5 w-5" /></span>
                  <StatusBadge status={e.status} />
                </div>
                <h2 className="mt-3 text-base font-semibold text-sapphire">{e.name}</h2>
                <p className="text-[13px] text-ink-muted">{e.term} · {EXAM_TYPE_LABELS[e.type]}</p>
                <p className="mt-2 text-sm text-ink-soft">{formatDate(e.startDate)} – {formatDate(e.endDate)}</p>
                <p className="text-[12.5px] text-ink-muted">{e.classNames.join(", ")} · {e.paperCount} papers</p>
                {e.progress && (e.status === "marks_entry" || e.status === "in_progress" || e.status === "published") && (
                  <div className="mt-3 flex items-center gap-2">
                    <ProgressBar value={e.progress.percentage} label="Marks entry" />
                    <span className="text-[12px] font-medium text-ink-soft">{e.progress.complete}/{e.progress.total}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </QueryView>
      <CreateExamModal open={open} onOpenChange={setOpen} onCreated={(id) => router.push(`/admin/examinations/${id}`)} />
    </div>
  );
}

function CreateExamModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const opts = useAcademicOptions();
  const [form, setForm] = useState({ name: "Pre-Board Examination", term: "Term 2" as "Term 1" | "Term 2", type: "annual" as "unit_test" | "half_yearly" | "annual" | "practical", classIds: [] as string[], startDate: addDays(todayISO(), 21), maxMarks: 80, startTime: "09:30", endTime: "12:30" });
  const m = useMutation(services.exams.create);
  useEffect(() => { if (opts.data && !form.classIds.length) setForm((f) => ({ ...f, classIds: opts.data!.classes.filter((c) => c.grade >= 10).map((c) => c.id) })); }, [opts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Create examination" description="A date sheet is generated automatically — one paper per subject, one per day (Sundays skipped). You can adjust it afterwards." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} onClick={async () => { const r = await m.mutate(form); if (r) { toast({ title: "Examination created", description: "Date sheet published to teachers and students." }); onOpenChange(false); onCreated(r.id); } }}>Create & publish schedule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Exam name" required error={m.fieldErrors.name} className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
        <FormField label="Term"><Select value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value as typeof form.term })}><option>Term 1</option><option>Term 2</option></Select></FormField>
        <FormField label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>{Object.entries(EXAM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
        <FormField label="First paper on" required error={m.fieldErrors.startDate}><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></FormField>
        <FormField label="Maximum marks per paper" required error={m.fieldErrors.maxMarks}><Input type="number" min={1} max={200} value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: Number(e.target.value) })} /></FormField>
        <FormField label="Starts at"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></FormField>
        <FormField label="Ends at" error={m.fieldErrors.endTime}><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13px] font-medium text-ink-soft">Classes <span className="text-plum">*</span></legend>
          <div className="flex flex-wrap gap-4">{(opts.data?.classes ?? []).map((c) => <Checkbox key={c.id} label={c.name} checked={form.classIds.includes(c.id)} onChange={(e) => setForm({ ...form, classIds: e.target.checked ? [...form.classIds, c.id] : form.classIds.filter((x) => x !== c.id) })} />)}</div>
          {m.fieldErrors.classIds && <p className="mt-1 text-[12.5px] text-plum">{m.fieldErrors.classIds}</p>}
        </fieldset>
        <div className="sm:col-span-2"><FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} /></div>
      </div>
    </Modal>
  );
}
