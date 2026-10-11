"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, CalendarDays, Megaphone, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { Notice, NoticeAudienceScope, NoticePriority, NoticeType } from "@/types/domain";
import type { NoticeInput } from "@/lib/services/notices.service";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, EmptyState, FilterBar,
  FilterSelect, FormField, Input, Modal, PageHeader, QueryView, SearchInput, Select, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { AUDIENCE_LABELS, NOTICE_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/constants/labels";
import { formatDate, formatLongDate, todayISO } from "@/lib/utils/dates";
import { NoticeListItem } from "./notice-list-item";

type NoticeView = Notice & { audienceLabel: string; author: string; isUpcoming: boolean };

function useNoticeFilters(withAudience: boolean) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [audience, setAudience] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { search, type: (type || "all") as NoticeType | "all", priority: (priority || "all") as NoticePriority | "all", audience: (audience || "all") as NoticeAudienceScope | "all", status: (status || "all") as Notice["status"] | "all", from: from || undefined, to: to || undefined };
  const bar = (
    <FilterBar>
      <SearchInput value={search} onChange={setSearch} placeholder="Search notices" className="col-span-2 sm:w-56" label="Search notices" />
      <FilterSelect label="Type" value={type} onChange={setType} allLabel="All types" options={Object.entries(NOTICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
      {withAudience && <FilterSelect label="Audience" value={audience} onChange={setAudience} allLabel="All audiences" options={Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))} />}
      <FilterSelect label="Priority" value={priority} onChange={setPriority} allLabel="Any priority" options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} />
      {withAudience && <FilterSelect label="Status" value={status} onChange={setStatus} allLabel="Any status" options={[{ value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />}
      <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" />
      <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="sm:w-40" />
    </FilterBar>
  );
  return { filters, bar, deps: [search, type, priority, audience, status, from, to] };
}

// ------------------------------------------------------------------ Admin

export function NoticesManager() {
  const { toast } = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const { filters, bar, deps } = useNoticeFilters(true);
  const q = useQuery(() => services.notices.list(filters), deps);
  const [compose, setCompose] = useState<NoticeView | "new" | null>(params.get("action") === "new" ? "new" : null);
  const [del, setDel] = useState<NoticeView | null>(null);
  const [view, setView] = useState<NoticeView | null>(null);
  useEffect(() => { if (params.get("action") === "new") setCompose("new"); }, [params]);

  return (
    <div>
      <PageHeader title="Notices & Events" description="School-wide and class-specific notices, events and holidays. Each notice only reaches its audience." actions={<Button onClick={() => setCompose("new")}><Plus className="h-4 w-4" /> New notice</Button>} />
      <Card className="mb-5 p-4">{bar}</Card>
      <QueryView query={q} loading="table">
        {(rows) => rows.length === 0 ? <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No notices found" action={<Button onClick={() => setCompose("new")}>Post a notice</Button>} /></Card> : (
          <Card>
            <ul className="divide-y divide-line/60 px-5">
              {rows.map((n) => (
                  <NoticeListItem
                    key={n.id}
                    className="py-4"
                    notice={n}
                    onClick={() => setView(n)}
                    actions={
                      <DropdownMenu>
                        <DropdownTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${n.title}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownTrigger>
                        <DropdownContent>
                          <DropdownItem onSelect={() => setCompose(n)}><Pencil className="h-4 w-4" /> Edit</DropdownItem>
                          {n.status !== "archived" && <DropdownItem onSelect={async () => { await services.notices.archive(n.id); toast({ title: "Notice archived" }); }}><Archive className="h-4 w-4" /> Archive</DropdownItem>}
                          <DropdownItem tone="danger" onSelect={() => setDel(n)}><Trash2 className="h-4 w-4" /> Delete</DropdownItem>
                        </DropdownContent>
                      </DropdownMenu>
                    }
                  />
              ))}
            </ul>
          </Card>
        )}
      </QueryView>
      {compose && <ComposeModal existing={compose === "new" ? undefined : compose} onClose={() => { setCompose(null); if (params.get("action")) router.replace("/admin/notices"); }} />}
      <NoticeDetail notice={view} onClose={() => setView(null)} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete notice?" description={`"${del?.title}" will be removed for everyone. This cannot be undone.`} tone="danger" confirmLabel="Delete" onConfirm={async () => { if (del) { await services.notices.remove(del.id); toast({ title: "Notice deleted" }); } setDel(null); }} />
    </div>
  );
}

function ComposeModal({ existing, onClose }: { existing?: NoticeView; onClose: () => void }) {
  const { toast } = useToast();
  const opts = useAcademicOptions();
  const [form, setForm] = useState<NoticeInput>(existing
    ? { title: existing.title, body: existing.body, type: existing.type, audience: existing.audience, publishDate: existing.publishDate, eventDate: existing.eventDate, priority: existing.priority, status: existing.status === "archived" ? "published" : existing.status }
    : { title: "", body: "", type: "notice", audience: { scope: "school" }, publishDate: todayISO(), eventDate: null, priority: "normal", status: "published" });
  const reach = useQuery(() => services.notices.previewReach(form.audience), [JSON.stringify(form.audience)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const setScope = (scope: NoticeAudienceScope) => setForm({ ...form, audience: { scope, classIds: scope === "classes" ? [] : undefined, sectionIds: scope === "sections" ? [] : undefined } });
  const toggle = (key: "classIds" | "sectionIds", id: string, on: boolean) => {
    const list = form.audience[key] ?? [];
    setForm({ ...form, audience: { ...form.audience, [key]: on ? [...list, id] : list.filter((x) => x !== id) } });
  };
  const save = async (status: "draft" | "published") => {
    setBusy(true); setError(null); setErrors({});
    try {
      if (existing) { await services.notices.update(existing.id, { ...form, status }); toast({ title: "Notice updated" }); }
      else {
        const r = await services.notices.create({ ...form, status });
        toast({ title: status === "draft" ? "Draft saved" : "Notice published", description: status === "published" ? `Delivered to ${r.reached} accounts.` : undefined });
      }
      onClose();
    } catch (e) { setError(e as Error); setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}); }
    setBusy(false);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit notice" : "New notice"} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" onClick={() => save("draft")} disabled={busy}>Save draft</Button><Button loading={busy} onClick={() => save("published")}><Megaphone className="h-4 w-4" /> Publish</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Title" required error={errors.title} className="sm:col-span-2"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
        <FormField label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as NoticeType })}>{Object.entries(NOTICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
        <FormField label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as NoticePriority })}>{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
        <FormField label="Publish on" required error={errors.publishDate}><Input type="date" value={form.publishDate} onChange={(e) => setForm({ ...form, publishDate: e.target.value })} /></FormField>
        <FormField label={form.type === "notice" ? "Relevant date (optional)" : "Event / holiday date"} required={form.type !== "notice"} error={errors.eventDate}><Input type="date" value={form.eventDate ?? ""} onChange={(e) => setForm({ ...form, eventDate: e.target.value || null })} /></FormField>
        <FormField label="Audience" required error={errors.audience} className="sm:col-span-2">
          <Select value={form.audience.scope} onChange={(e) => setScope(e.target.value as NoticeAudienceScope)}>{Object.entries(AUDIENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </FormField>
        {form.audience.scope === "classes" && (
          <div className="flex flex-wrap gap-4 sm:col-span-2">{(opts.data?.classes ?? []).map((c) => <Checkbox key={c.id} label={c.name} checked={form.audience.classIds?.includes(c.id) ?? false} onChange={(e) => toggle("classIds", c.id, e.target.checked)} />)}</div>
        )}
        {form.audience.scope === "sections" && (
          <div className="grid grid-cols-3 gap-2 sm:col-span-2 sm:grid-cols-5">{(opts.data?.sections ?? []).map((s) => <Checkbox key={s.id} label={s.label} checked={form.audience.sectionIds?.includes(s.id) ?? false} onChange={(e) => toggle("sectionIds", s.id, e.target.checked)} />)}</div>
        )}
        <p className="flex items-center gap-2 rounded-xl bg-teal-soft/60 px-3 py-2 text-[13px] text-lagoon sm:col-span-2">
          <Users className="h-4 w-4" /> Will reach {reach.data ? `${reach.data.studentAccounts} student/guardian accounts and ${reach.data.teachers} teachers` : "…"}. Everyone else won&apos;t see it.
        </p>
        <FormField label="Description" required error={errors.body} className="sm:col-span-2"><Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></FormField>
        <div className="sm:col-span-2"><FormError error={error && !Object.keys(errors).length ? error : null} /></div>
      </div>
    </Modal>
  );
}

function NoticeDetail({ notice, onClose }: { notice: NoticeView | null; onClose: () => void }) {
  return (
    <Modal open={!!notice} onOpenChange={(o) => !o && onClose()} title={notice?.title ?? ""} size="md">
      {notice && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2"><Badge tone="teal">{NOTICE_TYPE_LABELS[notice.type]}</Badge><StatusBadge status={notice.priority} /><Badge tone="outline">{notice.audienceLabel}</Badge>{notice.status !== "published" && <StatusBadge status={notice.status} />}</div>
          {notice.eventDate && <p className="flex items-center gap-2 text-sm font-medium text-sapphire"><CalendarDays className="h-4 w-4" /> {formatLongDate(notice.eventDate)}</p>}
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{notice.body}</p>
          <p className="text-[12.5px] text-ink-muted">Posted {formatDate(notice.publishDate)} by {notice.author}</p>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Teacher / Student board

export function NoticeBoard() {
  const { filters, bar, deps } = useNoticeFilters(false);
  const q = useQuery(() => services.notices.list(filters), deps);
  const [view, setView] = useState<NoticeView | null>(null);
  return (
    <div>
      <PageHeader title="Notices" description="Announcements, events and holidays relevant to you." />
      <Card className="mb-5 p-4">{bar}</Card>
      <QueryView query={q} loading="table">
        {(rows) => {
          const upcoming = rows.filter((n) => n.isUpcoming && n.type !== "notice");
          return rows.length === 0 ? <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No notices for you right now" /></Card> : (
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <Card>
                <ul className="divide-y divide-line/60 px-5">{rows.map((n) => <NoticeListItem key={n.id} className="py-4" notice={n} onClick={() => setView(n)} />)}</ul>
              </Card>
              <Card className="h-fit p-5">
                <p className="mb-3 text-sm font-semibold text-sapphire">Upcoming events & holidays</p>
                {upcoming.length === 0 ? <p className="text-sm text-ink-muted">Nothing scheduled.</p> : (
                  <ul className="space-y-3">
                    {upcoming.sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? "")).map((n) => (
                      <li key={n.id} className="flex items-start gap-3">
                        <div className="grid w-12 shrink-0 rounded-xl bg-sapphire py-1.5 text-center text-white">
                          <span className="text-[10px] font-semibold uppercase">{new Date(`${n.eventDate}T00:00:00`).toLocaleString("en-IN", { month: "short" })}</span>
                          <span className="text-lg font-semibold leading-none">{Number(n.eventDate!.slice(8))}</span>
                        </div>
                        <div className="min-w-0"><p className="text-sm font-semibold text-ink">{n.title}</p><p className="text-[12px] text-ink-muted">{NOTICE_TYPE_LABELS[n.type]}</p></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </QueryView>
      <NoticeDetail notice={view} onClose={() => setView(null)} />
    </div>
  );
}
