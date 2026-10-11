"use client";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  sortKey?: string;
  align?: "left" | "right" | "center";
  /** Shown in the mobile card as a labelled row (default true unless `primary`). */
  mobileLabel?: string | false;
  /** The column rendered as the mobile card heading. */
  primary?: boolean;
}

export interface SortState { key: string; dir: "asc" | "desc" }

/**
 * Premium table on md+ screens; stacked cards on mobile (no horizontal
 * overflow of a wide desktop table).
 */
export function DataTable<T>({
  columns, rows, getRowId, onRowClick, sort, onSortChange, empty, caption, className, rowActions, dense,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  empty?: ReactNode;
  caption?: string;
  className?: string;
  rowActions?: (row: T) => ReactNode;
  dense?: boolean;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const toggle = (key: string) => onSortChange?.({ key, dir: sort?.key === key && sort.dir === "asc" ? "desc" : "asc" });

  return (
    <div className={className}>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-0 text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort && c.sortKey && sort.key === c.sortKey ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "border-b border-line/80 bg-alabaster/60 px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted first:rounded-tl-xl last:rounded-tr-xl",
                    c.align === "right" && "text-right", c.align === "center" && "text-center", c.headerClassName,
                  )}
                >
                  {c.sortKey && onSortChange ? (
                    <button onClick={() => toggle(c.sortKey!)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
                      {c.header}
                      {sort?.key === c.sortKey ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
                    </button>
                  ) : c.header}
                </th>
              ))}
              {rowActions && <th className="border-b border-line/80 bg-alabaster/60 px-4 py-3 last:rounded-tr-xl"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn("group transition-colors", onRowClick && "cursor-pointer", "hover:bg-teal-soft/40")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("border-b border-line/50 px-4 align-middle text-ink-soft", dense ? "py-2" : "py-3", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {rowActions && <td className={cn("border-b border-line/50 px-4 text-right", dense ? "py-2" : "py-3")} onClick={(e) => e.stopPropagation()}>{rowActions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <li key={getRowId(row)}>
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
              className="rounded-2xl border border-line/70 bg-white p-4 shadow-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">{primary.cell(row)}</div>
                {rowActions && <div onClick={(e) => e.stopPropagation()}>{rowActions(row)}</div>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                {columns.filter((c) => c !== primary && c.mobileLabel !== false).map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{c.mobileLabel || c.header}</dt>
                    <dd className="mt-0.5 truncate text-[13px] text-ink-soft">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
