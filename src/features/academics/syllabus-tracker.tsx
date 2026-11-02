"use client";
/**
 * Curriculum progress & pacing engine (syllabus tracker).
 *
 * Pacing compares each subject's chapter completion with where it should be
 * by today on a straight line from `startDate` to `targetDate`: a subject more
 * than PACING_TOLERANCE points behind that line is "Behind pacing". Read-only
 * for the Principal; teachers (readOnly=false) can log a finished chapter.
 *
 * Props are unchanged from the original tracker, so every caller keeps working.
 */
import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Plus } from "lucide-react";
import { Avatar, Select } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { PACING_TOLERANCE, pacingOf, type PacingStatus } from "./pacing";

export interface SyllabusSubject {
  id: string;
  className: string; // e.g. "Class 10-A"
  subject: string;
  teacher: string;
  totalChapters: number;
  completedChapters: number;
  startDate: string; // ISO
  targetDate: string; // ISO
}

export const SAMPLE_SUBJECTS: SyllabusSubject[] = [
  { id: "1", className: "Class 10-A", subject: "Mathematics", teacher: "Ramesh Sharma", totalChapters: 15, completedChapters: 9, startDate: "2026-04-01", targetDate: "2027-02-15" },
  { id: "2", className: "Class 10-A", subject: "Science", teacher: "Pooja Verma", totalChapters: 16, completedChapters: 6, startDate: "2026-04-01", targetDate: "2027-02-15" },
  { id: "3", className: "Class 9-B", subject: "English", teacher: "Anjali Gupta", totalChapters: 12, completedChapters: 8, startDate: "2026-04-01", targetDate: "2027-02-15" },
  { id: "4", className: "Class 9-B", subject: "Social Science", teacher: "Vikram Malhotra", totalChapters: 18, completedChapters: 7, startDate: "2026-04-01", targetDate: "2027-02-15" },
  { id: "5", className: "Class 8-A", subject: "Hindi", teacher: "Sunita Mishra", totalChapters: 14, completedChapters: 11, startDate: "2026-04-01", targetDate: "2027-02-15" },
];

export function SyllabusProgressTracker({
  subjects = SAMPLE_SUBJECTS,
  readOnly = true, // Principal / admin dashboards: view only
  onChapterComplete,
}: {
  subjects?: SyllabusSubject[];
  readOnly?: boolean;
  onChapterComplete?: (subjectId: string, newCompleted: number) => void;
}) {
  const [data, setData] = useState<SyllabusSubject[]>(subjects);
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [behindOnly, setBehindOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const today = todayISO();

  const classList = useMemo(() => Array.from(new Set(data.map((s) => s.className))).sort(), [data]);
  const inClass = useMemo(() => (selectedClass === "all" ? data : data.filter((s) => s.className === selectedClass)), [data, selectedClass]);
  const shown = useMemo(() => (behindOnly ? inClass.filter((s) => pacingOf(s, today).status === "behind") : inClass), [inClass, behindOnly, today]);

  const stats = useMemo(() => {
    const total = inClass.reduce((a, s) => a + s.totalChapters, 0);
    const completed = inClass.reduce((a, s) => a + s.completedChapters, 0);
    const statuses = inClass.map((s) => pacingOf(s, today).status);
    return {
      total, completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0,
      behind: statuses.filter((s) => s === "behind").length,
      onTrack: statuses.filter((s) => s !== "behind").length,
    };
  }, [inClass, today]);

  const handleIncrement = (id: string) => {
    if (readOnly) return;
    setData((prev) => prev.map((item) => {
      if (item.id === id && item.completedChapters < item.totalChapters) {
        const updated = item.completedChapters + 1;
        onChapterComplete?.(id, updated);
        return { ...item, completedChapters: updated };
      }
      return item;
    }));
  };

  return (
    <section aria-labelledby="pacing-title" className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 border-b border-line p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700" aria-hidden><BookOpen className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0">
            <h2 id="pacing-title" className="text-[15px] font-semibold text-ink">Curriculum progress &amp; pacing</h2>
            <p className="text-[13px] text-ink-muted">{readOnly ? "Chapter coverage against each subject's planned pace." : "Log chapters as you finish them."}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Filter by class" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className="h-9 w-full min-[420px]:w-44">
            <option value="all">All classes</option>
            {classList.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <button
            type="button"
            aria-pressed={behindOnly}
            onClick={() => setBehindOnly((b) => !b)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus",
              behindOnly ? "border-amber-300 bg-amber-50 text-amber-900" : "border-line bg-white text-ink-soft hover:border-amber-300 hover:text-amber-900",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Behind pacing only
            {stats.behind > 0 && <span className="figures rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">{stats.behind}</span>}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Summary label={selectedClass === "all" ? "Whole school" : selectedClass} value={`${stats.pct}%`} hint="chapters covered" />
        <Summary label="Chapters" value={`${stats.completed} / ${stats.total}`} hint="completed" />
        <Summary label="On schedule" value={String(stats.onTrack)} hint={`subject${stats.onTrack === 1 ? "" : "s"}`} tone="ok" />
        <Summary label="Behind pacing" value={String(stats.behind)} hint={`more than ${PACING_TOLERANCE} pts behind`} tone={stats.behind ? "warn" : undefined} />
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-muted">{behindOnly ? "Nothing is behind pacing — every subject is on track." : "No subjects to show."}</p>
      ) : (
        <>
          {/* Table (sm and up) */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-bg/60 text-[12px] font-medium text-ink-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Subject</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Teacher</th>
                  <th scope="col" className="w-[28%] px-3 py-2.5 font-medium">Progress</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((sub) => {
                  const p = pacingOf(sub, today);
                  const isOpen = open === sub.id;
                  return (
                    <Fragment key={sub.id}>
                      <tr className={cn("align-middle transition-colors hover:bg-bg/50", isOpen && "bg-bg/50")}>
                        <td className="px-5 py-3">
                          <p className="font-semibold text-ink">{sub.subject}</p>
                          <p className="text-[12px] text-ink-muted">{sub.className}</p>
                        </td>
                        <td className="px-3 py-3"><span className="inline-flex items-center gap-2 text-ink-soft"><Avatar name={sub.teacher} size="xs" />{sub.teacher}</span></td>
                        <td className="px-3 py-3"><ProgressCell sub={sub} pct={p.pct} expected={p.expected} status={p.status} /></td>
                        <td className="px-3 py-3"><PacingBadge status={p.status} /></td>
                        <td className="px-5 py-3">
                          <RowActions readOnly={readOnly} done={p.status === "completed"} isOpen={isOpen} id={sub.id} onAdd={() => handleIncrement(sub.id)} onToggle={() => setOpen(isOpen ? null : sub.id)} />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr id={`pacing-log-${sub.id}`} className="bg-bg/50">
                          <td colSpan={5} className="px-5 pb-4 pt-0"><PacingLog sub={sub} pct={p.pct} expected={p.expected} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Stacked list (phones) */}
          <ul className="divide-y divide-line sm:hidden">
            {shown.map((sub) => {
              const p = pacingOf(sub, today);
              const isOpen = open === sub.id;
              return (
                <li key={sub.id} className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{sub.subject}</p>
                      <p className="text-[12px] text-ink-muted">{sub.className}</p>
                    </div>
                    <PacingBadge status={p.status} />
                  </div>
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink-soft"><Avatar name={sub.teacher} size="xs" />{sub.teacher}</span>
                  <ProgressCell sub={sub} pct={p.pct} expected={p.expected} status={p.status} />
                  <RowActions readOnly={readOnly} done={p.status === "completed"} isOpen={isOpen} id={`m-${sub.id}`} onAdd={() => handleIncrement(sub.id)} onToggle={() => setOpen(isOpen ? null : sub.id)} align="start" />
                  {isOpen && <div id={`pacing-log-m-${sub.id}`}><PacingLog sub={sub} pct={p.pct} expected={p.expected} /></div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function Summary({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "ok" | "warn" }) {
  return (
    <div className="bg-white px-5 py-3">
      <p className="truncate text-[12px] font-medium text-ink-muted">{label}</p>
      <p className={cn("figures text-lg font-semibold leading-snug", tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink")}>{value}</p>
      <p className="truncate text-[11.5px] text-ink-muted">{hint}</p>
    </div>
  );
}

/** Thin bar (amber when behind) with a tick where the subject should be today. */
function ProgressCell({ sub, pct, expected, status }: { sub: SyllabusSubject; pct: number; expected: number; status: PacingStatus }) {
  const rounded = Math.round(pct);
  return (
    <div className="min-w-[9rem]">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={rounded} aria-valuemin={0} aria-valuemax={100} aria-label={`${sub.subject} chapters completed`}>
        <div className={cn("h-full rounded-full", status === "behind" ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${rounded}%` }} />
        {status !== "completed" && <span aria-hidden title="Expected by today" className="absolute inset-y-0 w-0.5 bg-ink/50" style={{ left: `${Math.min(99.5, expected)}%` }} />}
      </div>
      <p className="figures mt-1 text-[12px] text-ink-muted"><span className="font-semibold text-ink">{sub.completedChapters}/{sub.totalChapters}</span> chapters · {rounded}%</p>
    </div>
  );
}

function RowActions({ readOnly, done, isOpen, id, onAdd, onToggle, align = "end" }: { readOnly: boolean; done: boolean; isOpen: boolean; id: string; onAdd: () => void; onToggle: () => void; align?: "start" | "end" }) {
  return (
    <div className={cn("flex items-center gap-1", align === "end" ? "justify-end" : "justify-start")}>
      {!readOnly && (
        <button type="button" disabled={done} onClick={onAdd}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-40">
          <Plus className="h-3 w-3" aria-hidden /> Chapter
        </button>
      )}
      <button type="button" aria-expanded={isOpen} aria-controls={`pacing-log-${id}`} onClick={onToggle}
        className="inline-flex h-8 items-center gap-0.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:shadow-focus">
        Pacing log <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}

function PacingLog({ sub, pct, expected }: { sub: SyllabusSubject; pct: number; expected: number }) {
  const gap = Math.round(pct) - Math.round(expected);
  return (
    <dl className="figures grid grid-cols-2 gap-3 rounded-lg border border-line bg-white p-3 text-[12.5px] sm:grid-cols-4">
      <div><dt className="text-ink-muted">Expected by today</dt><dd className="font-semibold text-ink">{Math.round(expected)}%</dd></div>
      <div><dt className="text-ink-muted">Gap</dt><dd className={cn("font-semibold", gap < -PACING_TOLERANCE ? "text-amber-700" : "text-emerald-700")}>{gap > 0 ? "+" : ""}{gap} pts</dd></div>
      <div><dt className="text-ink-muted">Chapters left</dt><dd className="font-semibold text-ink">{sub.totalChapters - sub.completedChapters}</dd></div>
      <div><dt className="text-ink-muted">Target date</dt><dd className="font-semibold text-ink">{formatDate(sub.targetDate)}</dd></div>
    </dl>
  );
}

function PacingBadge({ status }: { status: PacingStatus }) {
  if (status === "completed") {
    return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20"><CheckCircle2 className="h-3 w-3" aria-hidden /> Completed</span>;
  }
  if (status === "behind") {
    return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-800 ring-1 ring-inset ring-amber-500/30"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> Behind pacing</span>;
  }
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50/70 px-2 py-0.5 text-[12px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/15"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> On schedule</span>;
}
