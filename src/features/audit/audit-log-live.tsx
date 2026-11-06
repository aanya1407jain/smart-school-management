"use client";
/**
 * Audit log viewer for live school accounts (audit:read — the server refuses
 * everyone else). Reads convex/audit.ts getAuditLogs page by page; exports the
 * same filters through exportAuditLogsCsv (the export is itself audited).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { useSchoolAction, useSchoolPaginatedQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { AuditLogView } from "./audit-log-view";
import { EMPTY_AUDIT_FILTERS, saveCsv, serverFilters, type AuditEntry, type AuditFilterState } from "./audit-format";

const PAGE = 50;
/** While a text search runs, keep reading older pages until this many matches show (or the log ends). */
const SEARCH_TARGET = 25;
/** …but stop auto-reading after this many pages; the person can press "Load more". */
const MAX_AUTO_PAGES = 15;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function LiveAuditLog() {
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_AUDIT_FILTERS);
  const search = useDebounced(filters.search, 300);
  const args = useMemo(() => serverFilters({ ...filters, search }), [filters, search]);
  const badRange = !!filters.from && !!filters.to && filters.from > filters.to;
  const feed = useSchoolPaginatedQuery(api.audit.getAuditLogs, badRange ? "skip" : args, { initialNumItems: PAGE });
  const exportCsv = useSchoolAction(api.audit.exportAuditLogsCsv);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Text search is matched after reading: read further pages automatically until enough matches show.
  const autoPages = useRef(0);
  const key = JSON.stringify(args);
  useEffect(() => { autoPages.current = 0; }, [key]);
  const searching = !!args.search;
  const results = feed.results as AuditEntry[];
  const wantMore = searching && feed.status === "CanLoadMore" && results.length < SEARCH_TARGET && autoPages.current < MAX_AUTO_PAGES;
  const { loadMore } = feed;
  useEffect(() => {
    if (!wantMore) return;
    autoPages.current += 1;
    loadMore(PAGE);
  }, [wantMore, loadMore, results.length]);

  const onExport = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const r = await exportCsv(args);
      saveCsv(r.fileName, r.csv);
      setNotice(r.truncated
        ? `Exported the newest ${r.rowCount.toLocaleString()} matching entries (the export limit). Narrow the date range to export the rest.`
        : `Exported ${r.rowCount.toLocaleString()} entr${r.rowCount === 1 ? "y" : "ies"}.`);
    } catch (e) {
      setNotice(errorMessage(e, "We couldn't export the audit log. Please try again."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div data-testid="live-audit-log">
      <AuditLogView
        filters={filters}
        onFiltersChange={setFilters}
        rows={badRange ? [] : feed.status === "LoadingFirstPage" ? undefined : results}
        canLoadMore={!badRange && feed.status === "CanLoadMore"}
        loadingMore={feed.status === "LoadingMore"}
        onLoadMore={() => loadMore(PAGE)}
        onExport={onExport}
        exporting={exporting}
        notice={notice}
        scanning={wantMore || (searching && feed.status === "LoadingMore")}
      />
    </div>
  );
}
