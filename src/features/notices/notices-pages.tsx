"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  CalendarDays,
  Eye,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import type { Notice, NoticeAudienceScope, NoticePriority, NoticeType } from "@/types/domain";
import type { NoticeInput } from "@/lib/services/notices.service";
import { services } from "@/lib/services";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useSession } from "@/features/auth/session-provider";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  EmptyState,
  FilterBar,
  FilterSelect,
  FormField,
  Input,
  Modal,
  PageHeader,
  QueryView,
  SearchInput,
  Select,
  StatusBadge,
  Textarea,
  useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { AUDIENCE_LABELS, NOTICE_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/constants/labels";
import { formatDate, formatLongDate, todayISO } from "@/lib/utils/dates";
import { NoticeListItem } from "./notice-list-item";

export function toConvexAudience(audience: Notice["audience"]) {
  if (audience.scope === "school") {
    return { kind: "all" as const };
  }
  if (audience.scope === "teachers") {
    return { kind: "roles" as const, roles: ["teacher" as const] };
  }
  if (audience.scope === "students") {
    return { kind: "roles" as const, roles: ["student" as const] };
  }
  if (audience.scope === "classes") {
    return { kind: "classes" as const, classIds: ((audience.classIds ?? []) as unknown) as Id<"classes">[] };
  }
  if (audience.scope === "sections") {
    return { kind: "sections" as const, sectionIds: ((audience.sectionIds ?? []) as unknown) as Id<"sections">[] };
  }
  return { kind: "all" as const };
}

export function fromConvexAudience(audience: any): Notice["audience"] {
  if (!audience || audience.kind === "all") {
    return { scope: "school" };
  }
  if (audience.kind === "roles") {
    if (audience.roles?.includes("teacher") && !audience.roles?.includes("student")) {
      return { scope: "teachers" };
    }
    if (audience.roles?.includes("student") && !audience.roles?.includes("teacher")) {
      return { scope: "students" };
    }
    return { scope: "school" };
  }
  if (audience.kind === "classes") {
    return { scope: "classes", classIds: audience.classIds };
  }
  if (audience.kind === "sections") {
    return { scope: "sections", sectionIds: audience.sectionIds };
  }
  return { scope: "school" };
}

type NoticeView = Notice & { audienceLabel: string; author: string; isUpcoming: boolean };

/** A notice from Convex (notices.listManaged / notices.feed) as the shared notice UI shows it. */
type LiveNotice = FunctionReturnType<typeof api.notices.feed>[number];
function liveNoticeView(n: LiveNotice, today: string): NoticeView {
  return {
    id: n.noticeId,
    title: n.title,
    body: n.body,
    type: n.type as NoticeType,
    audience: fromConvexAudience(n.audience),
    audienceLabel: n.audienceLabel,
    publishDate: n.publishDate,
    eventDate: n.eventDate ?? null,
    priority: n.priority as NoticePriority,
    status: n.status,
    author: n.authorName ?? "School office",
    isUpcoming: !!n.eventDate && n.eventDate >= today,
    createdBy: n.createdByUserId,
  };
}

/** Client-side filters for live lists (the server already limits by audience / role). */
function filterLive(list: NoticeView[], filters: { search?: string; priority: string; audience: string; type: string; from?: string; to?: string }) {
  let out = list;
  if (filters.search) {
    const kw = filters.search.toLowerCase();
    out = out.filter((r) => r.title.toLowerCase().includes(kw) || r.body.toLowerCase().includes(kw));
  }
  if (filters.type !== "all") out = out.filter((r) => r.type === filters.type);
  if (filters.priority !== "all") out = out.filter((r) => r.priority === filters.priority);
  if (filters.audience !== "all") out = out.filter((r) => r.audience.scope === filters.audience);
  if (filters.from) out = out.filter((r) => (r.eventDate ?? r.publishDate) >= filters.from!);
  if (filters.to) out = out.filter((r) => (r.eventDate ?? r.publishDate) <= filters.to!);
  return out;
}

function toEditableNoticeInput(
  n: {
    title: string;
    body: string;
    type: NoticeType;
    audience: Notice["audience"];
    publishDate: string;
    eventDate: string | null;
    priority: NoticePriority;
  },
  status: "draft" | "published" | "archived"
): NoticeInput {
  return {
    title: n.title,
    body: n.body,
    type: n.type,
    audience: n.audience,
    publishDate: n.publishDate,
    eventDate: n.eventDate,
    priority: n.priority,
    status,
  };
}

function useNoticeFilters(withAudience: boolean) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [audience, setAudience] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const hasActiveFilters = Boolean(search || type || priority || audience || status || from || to);
  const resetFilters = () => {
    setSearch("");
    setType("");
    setPriority("");
    setAudience("");
    setStatus("");
    setFrom("");
    setTo("");
  };

  const filters = {
    search,
    type: (type || "all") as NoticeType | "all",
    priority: (priority || "all") as NoticePriority | "all",
    audience: (audience || "all") as NoticeAudienceScope | "all",
    status: (status || "all") as Notice["status"] | "all",
    from: from || undefined,
    to: to || undefined,
  };

  const bar = (
    <FilterBar
      actions={
        hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset filters">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        )
      }
    >
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search notices"
        className="col-span-2 sm:w-56"
        label="Search notices"
      />
      <FilterSelect
        label="Type"
        value={type}
        onChange={setType}
        allLabel="All types"
        options={Object.entries(NOTICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
      />
      {withAudience && (
        <FilterSelect
          label="Audience"
          value={audience}
          onChange={setAudience}
          allLabel="All audiences"
          options={Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))}
        />
      )}
      <FilterSelect
        label="Priority"
        value={priority}
        onChange={setPriority}
        allLabel="Any priority"
        options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
      />
      {withAudience && (
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          allLabel="Any status"
          options={[
            { value: "published", label: "Published" },
            { value: "draft", label: "Draft" },
            { value: "archived", label: "Archived" },
          ]}
        />
      )}
      <Input
        type="date"
        aria-label="From date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="sm:w-40"
      />
      <Input
        type="date"
        aria-label="To date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="sm:w-40"
      />
    </FilterBar>
  );

  return { filters, bar, hasActiveFilters, resetFilters, deps: [search, type, priority, audience, status, from, to] };
}

// ------------------------------------------------------------------ Admin

export function NoticesManager() {
  const { toast } = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const { dataSource } = useSession();
  const live = dataSource === "live";

  const { filters, bar, hasActiveFilters, resetFilters, deps } = useNoticeFilters(true);

  // Live: every notice of the school (managers) from Convex; lifecycle via publish / archive / restore.
  const liveNotices = useSchoolQuery(
    api.notices.listManaged,
    live ? { status: filters.status !== "all" ? (filters.status as "draft" | "published" | "archived") : undefined } : "skip"
  );
  const q = useQuery(() => services.notices.list(filters), [...deps, live], { enabled: !live });

  const publishMutation = useSchoolMutation(api.notices.publish);
  const archiveMutation = useSchoolMutation(api.notices.archive);
  const restoreMutation = useSchoolMutation(api.notices.restore);
  const fail = (e: unknown) => toast({ title: "That didn't work", description: e instanceof Error ? e.message : "Please try again.", tone: "error" });
  const publishLive = async (id: string) => {
    const r = await publishMutation({ noticeId: id as Id<"notices"> });
    toast({ title: "Notice published", description: r.scheduled ? "Its audience will be notified on the publish date." : `Notification sent to ${r.notified} account${r.notified === 1 ? "" : "s"}.` });
  };

  const [compose, setCompose] = useState<NoticeView | "new" | null>(params.get("action") === "new" ? "new" : null);
  const [del, setDel] = useState<NoticeView | null>(null);
  const [view, setView] = useState<NoticeView | null>(null);

  useEffect(() => {
    if (params.get("action") === "new") setCompose("new");
  }, [params]);

  const today = todayISO();
  const liveRows = useMemo(() => (liveNotices ? filterLive(liveNotices.map((n) => liveNoticeView(n, today)), filters) : undefined), [liveNotices, filters, today]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: liveRows === undefined, isRefreshing: false, data: liveRows, error: null, refetch: () => {} } : q),
    [live, liveRows, q],
  );

  return (
    <div>
      <PageHeader
        title="Notices & Events"
        description="School-wide and class-specific notices, events and holidays. Each notice only reaches its audience."
        actions={
          <Button onClick={() => setCompose("new")}>
            <Plus className="h-4 w-4" /> New notice
          </Button>
        }
      />
      <Card className="mb-5 p-4">{bar}</Card>
      <QueryView query={queryState} loading="table">
        {(noticeList) =>
          noticeList.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Megaphone className="h-6 w-6" />}
                title={hasActiveFilters ? "No notices match your filters" : "No notices found"}
                description={
                  hasActiveFilters
                    ? "Try adjusting your search keywords, audience, type, or date range."
                    : "School-wide announcements, events, and holidays will appear here once created."
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" onClick={resetFilters}>
                      <RotateCcw className="h-4 w-4" /> Reset filters
                    </Button>
                  ) : (
                    <Button onClick={() => setCompose("new")}>Post a notice</Button>
                  )
                }
              />
            </Card>
          ) : (
            <Card>
              <div className="border-b border-line/60 px-5 py-3">
                <p className="text-[13px] text-ink-muted">
                  Showing <span className="font-semibold text-ink">{noticeList.length}</span> notice
                  {noticeList.length === 1 ? "" : "s"} ·{" "}
                  <span>{noticeList.filter((r: any) => r.status === "published").length} published</span> ·{" "}
                  <span>
                    {noticeList.filter((r: any) => r.status === "draft").length} draft
                    {noticeList.filter((r: any) => r.status === "draft").length === 1 ? "" : "s"}
                  </span>{" "}
                  · <span>{noticeList.filter((r: any) => r.status === "archived").length} archived</span>
                </p>
              </div>
              <ul className="divide-y divide-line/60 px-5">
                {noticeList.map((n: any) => (
                  <NoticeListItem
                    key={n.id}
                    className="py-4"
                    notice={n}
                    onClick={() => setView(n)}
                    actions={
                      <DropdownMenu>
                        <DropdownTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${n.title}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent>
                          <DropdownItem onSelect={() => setView(n)}>
                            <Eye className="h-4 w-4" /> View
                          </DropdownItem>
                          {(!live || n.status === "draft") && (
                            <DropdownItem onSelect={() => setCompose(n)}>
                              <Pencil className="h-4 w-4" /> Edit
                            </DropdownItem>
                          )}
                          {n.status === "draft" && (
                            <DropdownItem
                              onSelect={async () => {
                                try {
                                  if (live) {
                                    await publishLive(n.id);
                                  } else {
                                    await services.notices.update(n.id, toEditableNoticeInput(n, "published"));
                                    toast({ title: "Notice published", description: "Notice is now visible to its target audience." });
                                  }
                                } catch (e) { fail(e); }
                              }}
                            >
                              <Send className="h-4 w-4" /> Publish now
                            </DropdownItem>
                          )}
                          {n.status === "published" && (
                            <DropdownItem
                              onSelect={async () => {
                                try {
                                  if (live) await archiveMutation({ noticeId: n.id as Id<"notices"> });
                                  else await services.notices.archive(n.id);
                                  toast({ title: "Notice archived" });
                                } catch (e) { fail(e); }
                              }}
                            >
                              <Archive className="h-4 w-4" /> Archive
                            </DropdownItem>
                          )}
                          {n.status === "archived" && (
                            <DropdownItem
                              onSelect={async () => {
                                try {
                                  if (live) {
                                    const r = await restoreMutation({ noticeId: n.id as Id<"notices"> });
                                    toast({ title: r.status === "published" ? "Notice restored to published" : "Notice restored as a draft" });
                                  } else {
                                    await services.notices.restore(n.id);
                                    toast({ title: "Notice restored to published" });
                                  }
                                } catch (e) { fail(e); }
                              }}
                            >
                              <RotateCcw className="h-4 w-4" /> Restore
                            </DropdownItem>
                          )}
                          {/* Live notices are never hard-deleted (archive keeps the record); delete is demo-only. */}
                          {!live && (
                            <DropdownItem tone="danger" onSelect={() => setDel(n)}>
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownItem>
                          )}
                        </DropdownContent>
                      </DropdownMenu>
                    }
                  />
                ))}
              </ul>
            </Card>
          )
        }
      </QueryView>
      {compose && (
        <ComposeModal
          existing={compose === "new" ? undefined : compose}
          onClose={() => {
            setCompose(null);
            if (params.get("action")) router.replace("/admin/notices");
          }}
        />
      )}
      <NoticeDetail
        notice={view}
        onClose={() => setView(null)}
        onEdit={(n) => {
          setCompose(n);
          setView(null);
        }}
        onPublish={async (n) => {
          try {
            if (live) {
              await publishLive(n.id);
            } else {
              await services.notices.update(n.id, toEditableNoticeInput(n, "published"));
              toast({ title: "Notice published", description: "Notice is now visible to its audience." });
            }
            setView(null);
          } catch (e) { fail(e); }
        }}
      />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete notice?"
        description={`"${del?.title}" will be removed for everyone. This cannot be undone.`}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          if (del) {
            await services.notices.remove(del.id); // demo data only
            toast({ title: "Notice deleted" });
          }
          setDel(null);
        }}
      />
    </div>
  );
}

function ComposeModal({ existing, onClose }: { existing?: NoticeView; onClose: () => void }) {
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const opts = useAcademicOptions();

  const createNoticeMutation = useSchoolMutation(api.notices.createDraft);
  const updateNoticeMutation = useSchoolMutation(api.notices.update);
  const publishNoticeMutation = useSchoolMutation(api.notices.publish);

  const [form, setForm] = useState<NoticeInput>(
    existing
      ? {
          title: existing.title,
          body: existing.body,
          type: existing.type,
          audience: existing.audience,
          publishDate: existing.publishDate,
          eventDate: existing.eventDate,
          priority: existing.priority,
          status: existing.status === "archived" ? "published" : existing.status,
        }
      : {
          title: "",
          body: "",
          type: "notice",
          audience: { scope: "school" },
          publishDate: todayISO(),
          eventDate: null,
          priority: "normal",
          status: "published",
        }
  );
  // Reach preview is computed from demo data only; live notices report who was notified when published.
  const reach = useQuery(() => services.notices.previewReach(form.audience), [JSON.stringify(form.audience), live], { enabled: !live });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const setScope = (scope: NoticeAudienceScope) =>
    setForm({
      ...form,
      audience: {
        scope,
        classIds: scope === "classes" ? [] : undefined,
        sectionIds: scope === "sections" ? [] : undefined,
      },
    });

  const toggle = (key: "classIds" | "sectionIds", id: string, on: boolean) => {
    const list = form.audience[key] ?? [];
    setForm({
      ...form,
      audience: {
        ...form.audience,
        [key]: on ? [...list, id] : list.filter((x) => x !== id),
      },
    });
  };

  const selectAllClasses = () => {
    const allIds = (opts.data?.classes ?? []).map((c) => c.id);
    setForm({ ...form, audience: { ...form.audience, classIds: allIds } });
  };

  const clearAllClasses = () => {
    setForm({ ...form, audience: { ...form.audience, classIds: [] } });
  };

  const selectAllSections = () => {
    const allIds = (opts.data?.sections ?? []).map((s) => s.id);
    setForm({ ...form, audience: { ...form.audience, sectionIds: allIds } });
  };

  const clearAllSections = () => {
    setForm({ ...form, audience: { ...form.audience, sectionIds: [] } });
  };

  const save = async (status: "draft" | "published") => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      if (live) {
        // Server lifecycle: save as a draft (create or edit), then publish if asked. Published notices are immutable.
        const fields = {
          title: form.title.trim(),
          body: form.body.trim(),
          type: form.type as "notice" | "event" | "holiday",
          priority: (form.priority === "low" ? "normal" : form.priority) as "normal" | "high" | "urgent",
          audience: toConvexAudience(form.audience),
          publishDate: form.publishDate,
        };
        let noticeId: Id<"notices">;
        if (existing) {
          noticeId = existing.id as Id<"notices">;
          await updateNoticeMutation({ noticeId, ...fields, eventDate: form.eventDate || "" });
        } else {
          noticeId = (await createNoticeMutation({ ...fields, eventDate: form.eventDate || undefined })).noticeId;
        }
        if (status === "published") {
          const r = await publishNoticeMutation({ noticeId });
          toast({ title: "Notice published", description: r.scheduled ? "Its audience will be notified on the publish date." : `Notification sent to ${r.notified} account${r.notified === 1 ? "" : "s"}.` });
        } else {
          toast({ title: "Draft saved" });
        }
        onClose();
      } else {
        const payload = toEditableNoticeInput(form, status);
        if (existing) {
          await services.notices.update(existing.id, payload);
          toast({ title: status === "draft" ? "Draft saved" : "Notice updated" });
        } else {
          const r = await services.notices.create(payload);
          toast({
            title: status === "draft" ? "Draft saved" : "Notice published",
            description: status === "published" ? `Delivered to ${r.reached} accounts.` : undefined,
          });
        }
        onClose();
      }
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(e?.message ?? "Failed to save notice"));
      setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {});
    }
    setBusy(false);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={existing ? "Edit notice" : "New notice"}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => save("draft")} disabled={busy}>
            Save draft
          </Button>
          <Button loading={busy} onClick={() => save("published")}>
            <Megaphone className="h-4 w-4" /> {existing?.status === "published" ? "Save changes" : "Publish"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Title" required error={errors.title} className="sm:col-span-2">
          <Input
            value={form.title}
            placeholder="Notice headline or event name"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </FormField>
        <FormField label="Type">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as NoticeType })}>
            {Object.entries(NOTICE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Priority">
          <Select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as NoticePriority })}
          >
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Publish on" required error={errors.publishDate}>
          <Input
            type="date"
            value={form.publishDate}
            onChange={(e) => setForm({ ...form, publishDate: e.target.value })}
          />
        </FormField>
        <FormField
          label={form.type === "notice" ? "Relevant date (optional)" : "Event / holiday date"}
          required={form.type !== "notice"}
          error={errors.eventDate}
        >
          <Input
            type="date"
            value={form.eventDate ?? ""}
            onChange={(e) => setForm({ ...form, eventDate: e.target.value || null })}
          />
        </FormField>

        <FormField label="Audience" required error={errors.audience} className="sm:col-span-2">
          <Select value={form.audience.scope} onChange={(e) => setScope(e.target.value as NoticeAudienceScope)}>
            {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </FormField>

        {form.audience.scope === "classes" && (
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">Select classes that will receive this notice:</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAllClasses}>
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAllClasses}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 rounded-xl border border-line/60 bg-paper-soft/40 p-3">
              {(opts.data?.classes ?? []).map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  checked={form.audience.classIds?.includes(c.id) ?? false}
                  onChange={(e) => toggle("classIds", c.id, e.target.checked)}
                />
              ))}
            </div>
          </div>
        )}

        {form.audience.scope === "sections" && (
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">Select sections that will receive this notice:</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAllSections}>
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAllSections}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-line/60 bg-paper-soft/40 p-3 sm:grid-cols-4 lg:grid-cols-5">
              {(opts.data?.sections ?? []).map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.label}
                  checked={form.audience.sectionIds?.includes(s.id) ?? false}
                  onChange={(e) => toggle("sectionIds", s.id, e.target.checked)}
                />
              ))}
            </div>
          </div>
        )}

        <p className="flex items-center gap-2 rounded-xl bg-teal-soft/60 px-3 py-2 text-[13px] text-lagoon sm:col-span-2">
          <Users className="h-4 w-4 shrink-0" />
          {live ? (
            <span>Only members of this audience will see it; they are notified in-app when it is published.</span>
          ) : (
            <span>
              Will reach{" "}
              <span className="font-semibold">
                {reach.data
                  ? `${reach.data.studentAccounts} student/guardian accounts and ${reach.data.teachers} teachers`
                  : "…"}
              </span>
              . Accounts outside this scope will not see it.
            </span>
          )}
        </p>

        <FormField label="Description" required error={errors.body} className="sm:col-span-2">
          <Textarea
            rows={5}
            placeholder="Full content of the announcement..."
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormError error={error && !Object.keys(errors).length ? error : null} />
        </div>
      </div>
    </Modal>
  );
}

function NoticeDetail({
  notice,
  onClose,
  onEdit,
  onPublish,
}: {
  notice: NoticeView | null;
  onClose: () => void;
  onEdit?: (notice: NoticeView) => void;
  onPublish?: (notice: NoticeView) => void;
}) {
  return (
    <Modal
      open={!!notice}
      onOpenChange={(o) => !o && onClose()}
      title={notice?.title ?? ""}
      size="md"
      footer={
        notice && (
          <div className="flex w-full items-center justify-between">
            <span className="text-[12px] text-ink-muted">
              Posted {formatDate(notice.publishDate)} {notice.author ? `by ${notice.author}` : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              {notice.status === "draft" && onPublish && (
                <Button size="sm" onClick={() => onPublish(notice)}>
                  <Send className="h-3.5 w-3.5" /> Publish
                </Button>
              )}
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(notice)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      {notice && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">{NOTICE_TYPE_LABELS[notice.type]}</Badge>
            <StatusBadge status={notice.priority} />
            <Badge tone="outline">{notice.audienceLabel}</Badge>
            {notice.status !== "published" && <StatusBadge status={notice.status} />}
          </div>
          {notice.eventDate && (
            <p className="flex items-center gap-2 text-sm font-medium text-sapphire">
              <CalendarDays className="h-4 w-4" /> {formatLongDate(notice.eventDate)}
            </p>
          )}
          <div className="rounded-xl bg-paper-soft/50 p-4">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{notice.body}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Teacher / Student board

export function NoticeBoard() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  const { filters, bar, hasActiveFilters, resetFilters, deps } = useNoticeFilters(false);

  // Live: published notices addressed to this member (server-side audience check), visible today.
  const liveNotices = useSchoolQuery(api.notices.feed, live ? {} : "skip");
  const q = useQuery(() => services.notices.list(filters), [...deps, live], { enabled: !live });
  const [view, setView] = useState<NoticeView | null>(null);

  const today = todayISO();
  const liveRows = useMemo(() => (liveNotices ? filterLive(liveNotices.map((n) => liveNoticeView(n, today)), filters) : undefined), [liveNotices, filters, today]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: liveRows === undefined, isRefreshing: false, data: liveRows, error: null, refetch: () => {} } : q),
    [live, liveRows, q],
  );

  return (
    <div>
      <PageHeader title="Notices" description="Announcements, events and holidays relevant to you." />
      <Card className="mb-5 p-4">{bar}</Card>
      <QueryView query={queryState} loading="table">
        {(noticeList) => {
          const upcoming = noticeList.filter((n: any) => n.isUpcoming && n.type !== "notice");
          return noticeList.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Megaphone className="h-6 w-6" />}
                title={hasActiveFilters ? "No notices match your filters" : "No notices for you right now"}
                description={
                  hasActiveFilters
                    ? "Try clearing your search query or date range filters."
                    : "School announcements and upcoming events will appear here."
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" onClick={resetFilters}>
                      <RotateCcw className="h-4 w-4" /> Reset filters
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <Card>
                <ul className="divide-y divide-line/60 px-5">
                  {noticeList.map((n: any) => (
                    <NoticeListItem key={n.id} className="py-4" notice={n} onClick={() => setView(n)} />
                  ))}
                </ul>
              </Card>
              <Card className="h-fit p-5">
                <p className="mb-3 text-sm font-semibold text-sapphire">Upcoming events & holidays</p>
                {upcoming.length === 0 ? (
                  <p className="text-sm text-ink-muted">Nothing scheduled.</p>
                ) : (
                  <ul className="space-y-3">
                    {upcoming
                      .sort((a: any, b: any) => (a.eventDate ?? "").localeCompare(b.eventDate ?? ""))
                      .map((n: any) => (
                        <li key={n.id} className="flex items-start gap-3">
                          <div className="grid w-12 shrink-0 rounded-xl bg-sapphire py-1.5 text-center text-white">
                            <span className="text-[10px] font-semibold uppercase">
                              {new Date(`${n.eventDate}T00:00:00`).toLocaleString("en-IN", { month: "short" })}
                            </span>
                            <span className="text-lg font-semibold leading-none">{Number(n.eventDate!.slice(8))}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{n.title}</p>
                            <p className="text-[12px] text-ink-muted">{NOTICE_TYPE_LABELS[n.type as NoticeType]}</p>
                          </div>
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
