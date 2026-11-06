"use client";
/**
 * The audit-log screen (presentational): control bar (search, category, role,
 * date range, CSV export), a dense table (timestamp, actor, action, target,
 * details, status) and a details drawer with the before/after diff. Data and
 * filtering come from the container — LiveAuditLog (Convex) or the internal
 * demo. Read-only: nothing here can change an entry.
 */
import { useState, type ReactNode } from "react";
import { Download, Eye, RotateCcw, ScrollText, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Drawer, EmptyState, FilterBar, FilterSelect, PageHeader, SearchInput, Skeleton, Tooltip } from "@/components/ui";
import { Input } from "@/components/ui/form";
import { AUDIT_CATEGORY_LABELS } from "@convex/core/auditCategories";
import {
  actionLabel, CATEGORY_OPTIONS, CATEGORY_TONE, diffOf, entityLabel, hasActiveFilters, localStamp, OUTCOME, otherDetails,
  relativeFrom, ROLE_OPTIONS, showValue, utcStamp, EMPTY_AUDIT_FILTERS, type AuditEntry, type AuditFilterState,
} from "./audit-format";
import { cn } from "@/lib/utils/cn";

export type AuditLogViewProps = {
  filters: AuditFilterState;
  onFiltersChange: (f: AuditFilterState) => void;
  /** Undefined while the first page loads. */
  rows: AuditEntry[] | undefined;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onExport: () => void;
  exporting: boolean;
  /** Shown under the control bar (e.g. "Export cut at 5,000 rows", or an error). */
  notice?: ReactNode;
  /** Text search is matched after reading: true while older entries are still being scanned for matches. */
  scanning?: boolean;
};

const COLUMNS = ["Timestamp", "Actor", "Action", "Target", "Details", "Status"] as const;

export function AuditLogView({ filters, onFiltersChange, rows, canLoadMore, loadingMore, onLoadMore, onExport, exporting, notice, scanning }: AuditLogViewProps) {
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const set = <K extends keyof AuditFilterState>(k: K, value: AuditFilterState[K]) => onFiltersChange({ ...filters, [k]: value });
  const active = hasActiveFilters(filters);
  const badRange = !!filters.from && !!filters.to && filters.from > filters.to;

  return (
    <div data-testid="audit-log">
      <PageHeader
        title="Audit log"
        description="Who changed what, and when. Entries are written by the server with each change and cannot be edited or deleted."
        actions={
          <Button variant="outline" onClick={onExport} loading={exporting} disabled={badRange} data-testid="audit-export">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <FilterBar>
          <SearchInput
            className="min-[360px]:col-span-2 sm:w-72"
            label="Search the audit log"
            placeholder="Actor, scholar no., Login ID or entity ID"
            value={filters.search}
            onChange={(v) => set("search", v)}
          />
          <FilterSelect label="Category" value={filters.category} onChange={(v) => set("category", v as AuditFilterState["category"])} options={CATEGORY_OPTIONS} allLabel="All categories" />
          <FilterSelect label="Role" value={filters.actorRole} onChange={(v) => set("actorRole", v as AuditFilterState["actorRole"])} options={ROLE_OPTIONS} allLabel="All roles" />
          <div role="group" aria-label="Date range" className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 text-[12.5px] text-ink-muted min-[360px]:col-span-2 sm:flex sm:col-span-1">
            <span>From</span>
            <Input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => set("from", e.target.value)} className="h-10 min-w-0 sm:w-[10.5rem]" />
            <span>To</span>
            <Input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => set("to", e.target.value)} className="h-10 min-w-0 sm:w-[10.5rem]" />
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => onFiltersChange(EMPTY_AUDIT_FILTERS)}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </FilterBar>
        {badRange && <p role="alert" className="mt-2 text-[12.5px] text-plum">The start date must be on or before the end date.</p>}
        {notice && <div className="mt-2 text-[12.5px] text-ink-muted">{notice}</div>}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm" aria-label="Audit log entries" aria-busy={rows === undefined}>
            <thead className="border-b border-line/70 bg-alabaster/60 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              <tr>{COLUMNS.map((c) => <th key={c} scope="col" className="px-4 py-3 first:pl-5 last:pr-5">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows === undefined ? <SkeletonRows /> : rows.map((r) => <AuditRowView key={r._id} r={r} onOpen={() => setOpen(r)} />)}
            </tbody>
          </table>
        </div>

        {rows !== undefined && rows.length === 0 && !scanning && !canLoadMore && (
          <EmptyState
            icon={<ScrollText className="h-6 w-6" />}
            title={active ? "No entries match these filters" : "No audit entries yet"}
            description={active ? "Try a different search, category, role or date range." : "Changes appear here as they are made."}
            action={active ? <Button variant="outline" size="sm" onClick={() => onFiltersChange(EMPTY_AUDIT_FILTERS)}><RotateCcw className="h-3.5 w-3.5" /> Reset filters</Button> : undefined}
          />
        )}
        {rows !== undefined && (scanning || canLoadMore) && (
          <div className="flex items-center justify-center gap-3 border-t border-line/60 p-3">
            {scanning ? (
              <span className="text-[12.5px] text-ink-muted" role="status">Searching older entries…</span>
            ) : (
              <Button variant="outline" size="sm" onClick={onLoadMore} loading={loadingMore}>Load more</Button>
            )}
          </div>
        )}
      </Card>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-lagoon" aria-hidden /> Append-only: there is no way to edit or delete an entry. Times are server-recorded; dates filter in your local time.
      </p>

      <AuditDetailsDrawer entry={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <tr key={i} aria-hidden>
          <td className="px-4 py-3.5 pl-5"><Skeleton className="h-4 w-20" /><Skeleton className="mt-1.5 h-3 w-28" /></td>
          <td className="px-4 py-3.5"><Skeleton className="h-4 w-28" /><Skeleton className="mt-1.5 h-4 w-20 rounded-full" /></td>
          <td className="px-4 py-3.5"><Skeleton className="h-5 w-36 rounded-full" /></td>
          <td className="px-4 py-3.5"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3.5"><Skeleton className="h-4 w-64" /></td>
          <td className="px-4 py-3.5 pr-5"><Skeleton className="h-5 w-16 rounded-full" /></td>
        </tr>
      ))}
    </>
  );
}

function AuditRowView({ r, onOpen }: { r: AuditEntry; onOpen: () => void }) {
  const outcome = OUTCOME[r.outcome];
  return (
    <tr className="align-top transition-colors hover:bg-alabaster/50" data-testid="audit-row">
      <td className="whitespace-nowrap px-4 py-3 pl-5">
        <Tooltip content={<>{utcStamp(r.at)}<br />{localStamp(r.at)} (local)</>}>
          <time dateTime={new Date(r.at).toISOString()} tabIndex={0} className="font-medium text-ink outline-none focus-visible:underline">{relativeFrom(r.at)}</time>
        </Tooltip>
        <p className="mt-0.5 text-[12px] text-ink-muted">{localStamp(r.at)}</p>
      </td>
      <td className="px-4 py-3">
        {r.actor ? (
          <>
            <p className="font-medium text-ink">{r.actor.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={r.actor.profile === "Administrator" ? "sapphire" : r.actor.profile === "Teacher" ? "teal" : "neutral"}>{r.actor.profile}</Badge>
              {r.actor.loginId && <span className="font-mono text-[11.5px] text-ink-muted">{r.actor.loginId}</span>}
            </div>
          </>
        ) : (
          <Badge tone="outline">System</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={CATEGORY_TONE[r.category]} dot>{actionLabel(r.action)}</Badge>
        <p className="mt-1 text-[11.5px] uppercase tracking-[0.06em] text-ink-muted">{AUDIT_CATEGORY_LABELS[r.category]}</p>
      </td>
      <td className="px-4 py-3">
        <p className="text-ink">{entityLabel(r.entity.table)}</p>
        <p className="mt-0.5 max-w-[11rem] truncate font-mono text-[11.5px] text-ink-muted" title={r.target ?? r.entity.id}>{r.target ?? r.entity.id}</p>
      </td>
      <td className="px-4 py-3">
        <p className="line-clamp-2 max-w-[26rem] text-ink-soft">{r.summary}</p>
        <button type="button" onClick={onOpen} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-lagoon hover:underline" aria-label={`View details: ${r.summary}`}>
          <Eye className="h-3.5 w-3.5" aria-hidden /> {diffOf(r.metadata) ? "View changes" : "View details"}
        </button>
      </td>
      <td className="whitespace-nowrap px-4 py-3 pr-5"><Badge tone={outcome.tone} dot>{outcome.label}</Badge></td>
    </tr>
  );
}

function AuditDetailsDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const diff = entry ? diffOf(entry.metadata) : null;
  const rest = entry ? otherDetails(entry.metadata) : null;
  return (
    <Drawer open={!!entry} onOpenChange={(o) => { if (!o) onClose(); }} title={entry ? actionLabel(entry.action) : ""} description={entry?.summary} className="w-[min(100vw,40rem)]">
      {entry && (
        <div className="space-y-5 text-sm" data-testid="audit-drawer">
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2">
            <Term label="When">{localStamp(entry.at)}<span className="block text-[12px] text-ink-muted">{utcStamp(entry.at)}</span></Term>
            <Term label="Actor">{entry.actor ? <>{entry.actor.name} <span className="text-ink-muted">· {entry.actor.profile}{entry.actor.loginId ? ` · ${entry.actor.loginId}` : ""}</span></> : "System"}</Term>
            <Term label="Category"><Badge tone={CATEGORY_TONE[entry.category]}>{AUDIT_CATEGORY_LABELS[entry.category]}</Badge></Term>
            <Term label="Status"><Badge tone={OUTCOME[entry.outcome].tone} dot>{OUTCOME[entry.outcome].label}</Badge></Term>
            <Term label="Action code"><code className="font-mono text-[12.5px]">{entry.action}</code></Term>
            <Term label="Entity">{entityLabel(entry.entity.table)} <span className="break-all font-mono text-[12px] text-ink-muted">{entry.entity.id}</span></Term>
            {entry.target && <Term label="Affected account"><span className="font-mono">{entry.target}</span></Term>}
          </dl>

          {diff && (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Changes</h3>
              <div className="overflow-x-auto rounded-xl border border-line/70">
                <table className="w-full min-w-[30rem] text-[13px]">
                  <thead className="bg-alabaster/60 text-left text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    <tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {diff.map((d) => (
                      <tr key={d.field} className={cn(!d.changed && "text-ink-muted")}>
                        <td className="px-3 py-2 font-mono text-[12px]">{d.field}</td>
                        <td className={cn("px-3 py-2 align-top break-words", d.changed && "bg-blush/30 text-plum line-through decoration-plum/40")}>{showValue(d.before)}</td>
                        <td className={cn("px-3 py-2 align-top break-words", d.changed && "bg-teal-soft/50 text-lagoon")}>{showValue(d.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {rest && (
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{diff ? "Other details" : "Details"}</h3>
              <pre className="max-h-80 overflow-auto rounded-xl bg-alabaster p-3 text-[12px] leading-relaxed text-ink-soft">{JSON.stringify(rest, null, 2)}</pre>
            </section>
          )}
          {!diff && !rest && <p className="text-ink-muted">No further details were recorded for this entry.</p>}
        </div>
      )}
    </Drawer>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}
