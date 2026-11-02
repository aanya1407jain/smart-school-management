"use client";
/**
 * Small presentational pieces shared by the live and demo Subjects views: the
 * class filter, a subject's type badge and a compact list of class chips.
 */
import { cn } from "@/lib/utils/cn";

/** Segmented class filter: "All" plus one pill per class; scrolls sideways on phones. */
export function ClassFilter({ classes, value, onChange }: { classes: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const items = [{ id: "all", name: "All classes" }, ...classes];
  return (
    <div role="group" aria-label="Filter by class" className="scrollbar-thin -mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          className={cn(
            "h-8 shrink-0 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40",
            value === c.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-line bg-white text-ink-soft hover:border-emerald-300 hover:text-emerald-800",
          )}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

/** Core / Elective (and stream) for a subject in one class. */
export function KindBadge({ elective, stream, label }: { elective: boolean; stream?: string | null; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset",
        elective ? "bg-amber-50 text-amber-800 ring-amber-500/25" : "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
      )}>
        {label ?? (elective ? "Elective" : "Core")}
      </span>
      {stream && <span className="inline-flex items-center rounded-full bg-bg px-2 py-0.5 text-[11.5px] font-medium text-ink-soft ring-1 ring-inset ring-line">{stream}</span>}
    </span>
  );
}

/** The classes that study a subject, as compact chips (electives marked with an amber dot). */
export function ClassChips({ items, empty = "Not in any class yet" }: { items: { id: string; name: string; elective?: boolean; stream?: string | null }[]; empty?: string }) {
  if (items.length === 0) return <span className="text-[12.5px] text-ink-muted">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((c) => (
        <span key={c.id} title={c.elective ? `Elective${c.stream ? ` · ${c.stream}` : ""}` : c.stream ?? undefined}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">
          {c.elective && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Elective" />}
          {c.name}{c.stream ? <span className="text-ink-muted">· {c.stream}</span> : null}
        </span>
      ))}
    </span>
  );
}
