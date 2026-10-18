"use client";
/**
 * Audit log viewer (audit:read): every recorded change in the school, newest
 * first, filterable by action, with who did it and the recorded details.
 * Read-only — there is no way to edit or delete audit rows.
 */
import { useState } from "react";
import { ScrollText } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useSchoolPaginatedQuery, useSchoolQuery } from "@/lib/convex/membership";
import { Badge, Button, Card, EmptyState, LoadingState, PageHeader, Select } from "@/components/ui";
import { formatDateTime } from "@/lib/utils/dates";

export function LiveAuditLog() {
  const [action, setAction] = useState("");
  const actions = useSchoolQuery(api.audit.actions, {});
  const feed = useSchoolPaginatedQuery(api.audit.feed, action ? { action } : {}, { initialNumItems: 50 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div data-testid="live-audit-log">
      <PageHeader title="Audit log" description="Who changed what, and when. Entries are written by the server with each change and cannot be edited or deleted." />
      <Card className="mb-4 p-4">
        <Select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} className="w-72">
          <option value="">All actions</option>
          {(actions ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
      </Card>
      <Card>
        {feed.status === "LoadingFirstPage" ? <LoadingState variant="table" /> : feed.results.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No audit entries" description={action ? "Nothing recorded for this action yet." : "Changes appear here as they are made."} />
        ) : (
          <ul className="divide-y divide-line/60">
            {feed.results.map((r) => (
              <li key={r._id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral" className="font-mono">{r.action}</Badge>
                  <span className="text-[12.5px] text-ink-muted">{formatDateTime(new Date(r.at).toISOString())}</span>
                  <span className="text-[12.5px] text-ink-muted">· {r.actor ? `${r.actor.name}${r.actor.loginId ? ` (${r.actor.loginId})` : ""}` : "System"}{r.actorRole ? ` · ${r.actorRole}` : ""}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{r.summary}</p>
                {r.metadata != null && (
                  <button className="mt-1 text-[12.5px] font-medium text-lagoon hover:underline" onClick={() => setOpen(open === r._id ? null : r._id)} aria-expanded={open === r._id}>
                    {open === r._id ? "Hide details" : "Details"}
                  </button>
                )}
                {open === r._id && <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-alabaster p-3 text-[12px] text-ink-soft">{JSON.stringify(r.metadata, null, 2)}</pre>}
              </li>
            ))}
          </ul>
        )}
        {feed.status === "CanLoadMore" && <div className="border-t border-line/60 p-3 text-center"><Button variant="outline" size="sm" onClick={() => feed.loadMore(50)}>Load more</Button></div>}
      </Card>
    </div>
  );
}
