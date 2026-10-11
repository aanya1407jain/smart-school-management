"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-col items-center justify-between gap-3 px-1 sm:flex-row" aria-label="Pagination">
      <p className="text-[13px] text-ink-muted">Showing <span className="font-medium text-ink">{from}–{to}</span> of <span className="font-medium text-ink">{total}</span></p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1)
          .map((p, i, arr) => (
            <span key={p} className="flex items-center">
              {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1 text-ink-muted">…</span>}
              <button
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                className={p === page ? "h-8 min-w-8 rounded-lg bg-sapphire px-2 text-[13px] font-semibold text-white" : "h-8 min-w-8 rounded-lg px-2 text-[13px] text-ink-soft hover:bg-white"}
              >
                {p}
              </button>
            </span>
          ))}
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </nav>
  );
}
