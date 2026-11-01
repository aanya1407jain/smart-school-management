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
import { useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Avatar, BadgeChip, CardHeader, GlassCard, Select } from "@/components/ui";
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

const SAMPLE_SUBJECTS: SyllabusSubject[] = [
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
  const reduceMotion = useReducedMotion();
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
    return { total, completed, pending: total - completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0, behind: inClass.filter((s) => pacingOf(s, today).status === "behind").length };
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
    <GlassCard className="spatial overflow-hidden">
      <CardHeader
        title="Curriculum progress & pacing"
        description={readOnly ? "Principal view (read only) · Chapter coverage against each subject's planned pace." : "Teacher view · Log chapters as you finish them."}
        icon={<BookOpen className="h-4 w-4" />}
        className="flex-wrap"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Filter by class" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className="h-9 w-40">
              <option value="all">All classes</option>
              {classList.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <button
              type="button"
              aria-pressed={behindOnly}
              onClick={() => setBehindOnly((b) => !b)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold ring-1 ring-inset transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:shadow-focus",
                behindOnly ? "bg-gradient-to-br from-amber-400 to-rose-500 text-white shadow-[0_4px_14px_-4px_rgb(244_63_94/0.6)] ring-transparent" : "bg-white/70 text-ink-soft ring-line/80 hover:bg-white hover:text-plum",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Behind pacing only
            </button>
          </div>
        }
      />

      {/* Executive summary strip */}
      <div className="mx-5 mb-4 rounded-2xl border border-white/70 bg-white/55 p-4 backdrop-blur-md">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{selectedClass === "all" ? "Whole school progress" : `${selectedClass} progress`}</p>
          <p className="figures font-mono text-xl font-bold text-sapphire">{stats.pct}%</p>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/70 shadow-[inset_0_1px_2px_rgb(6_49_84/0.10)] ring-1 ring-inset ring-line/70" role="progressbar" aria-valuenow={stats.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Curriculum completed">
          <div className="h-full rounded-full bg-gradient-to-r from-sapphire via-lagoon to-cyan transition-[width] duration-700 ease-out" style={{ width: `${stats.pct}%` }} />
        </div>
        <p className="figures mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
          <span><b className="font-mono text-ink">{stats.total}</b> total chapters</span><span aria-hidden>•</span>
          <span><b className="font-mono text-lagoon">{stats.completed}</b> completed</span><span aria-hidden>•</span>
          <span><b className="font-mono text-ink">{stats.pending}</b> in progress</span><span aria-hidden>•</span>
          <span className={stats.behind ? "text-plum" : undefined}><b className="font-mono">{stats.behind}</b> at risk / behind</span>
        </p>
      </div>

      {/* Subject cards */}
      {shown.length === 0 ? (
        <p className="px-5 pb-6 text-center text-sm text-ink-muted">{behindOnly ? "Nothing is behind pacing — every subject is on track." : "No subjects to show."}</p>
      ) : (
        <motion.ul layout={!reduceMotion} className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {shown.map((sub, i) => {
              const p = pacingOf(sub, today);
              const pct = Math.round(p.pct);
              const isOpen = open === sub.id;
              return (
                <motion.li
                  key={sub.id}
                  layout={!reduceMotion}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34, delay: reduceMotion ? 0 : i * 0.04 }}
                  style={{ "--stagger-i": i } as CSSProperties}
                  className="group flex flex-col rounded-2xl border border-white/70 bg-white/65 p-4 shadow-ambient backdrop-blur-md transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-ambient-lg"
                >
                  <div className="flex items-start justify-between gap-2">
                    <BadgeChip tone="sapphire">{sub.className}</BadgeChip>
                    <PacingPill status={p.status} />
                  </div>
                  <p className="mt-2.5 text-[15px] font-semibold text-ink">{sub.subject}</p>
                  <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/80 py-0.5 pl-0.5 pr-2.5 text-[12px] font-medium text-ink-soft ring-1 ring-inset ring-line/70">
                    <Avatar name={sub.teacher} size="xs" /> {sub.teacher}
                  </span>

                  <div className="mt-3.5">
                    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/70 shadow-[inset_0_1px_2px_rgb(6_49_84/0.10)] ring-1 ring-inset ring-line/70" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${sub.subject} chapters completed`}>
                      <div
                        className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out", p.status === "behind" ? "from-amber-400 to-rose-500" : p.status === "completed" ? "from-aqua to-teal" : "from-indigo-500 to-cyan")}
                        style={{ width: `${pct}%` }}
                      />
                      {/* Where the subject should be today. */}
                      {p.status !== "completed" && <span aria-hidden title="Expected by today" className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ left: `${Math.min(99.5, p.expected)}%` }} />}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="figures font-mono text-[12.5px] font-semibold text-ink">{sub.completedChapters}/{sub.totalChapters} chapters • {pct}%</span>
                    <div className="flex items-center gap-1">
                      {!readOnly && (
                        <button type="button" disabled={p.status === "completed"} onClick={() => handleIncrement(sub.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/80 px-2 py-1 text-[12px] font-semibold text-lagoon ring-1 ring-inset ring-teal/25 transition-all hover:bg-teal-soft active:scale-95 disabled:opacity-40">
                          <Plus className="h-3 w-3" aria-hidden /> Chapter
                        </button>
                      )}
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : sub.id)}
                        className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[12px] font-semibold text-lagoon transition-colors hover:bg-teal-soft focus-visible:outline-none focus-visible:shadow-focus">
                        Pacing log <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.dl
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.2 }}
                        className="figures mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 overflow-hidden border-t border-line/60 pt-2.5 text-[12px]"
                      >
                        <dt className="text-ink-muted">Expected by today</dt><dd className="text-right font-mono font-semibold text-ink">{Math.round(p.expected)}%</dd>
                        <dt className="text-ink-muted">Gap</dt><dd className={cn("text-right font-mono font-semibold", pct - p.expected < -PACING_TOLERANCE ? "text-plum" : "text-lagoon")}>{pct - Math.round(p.expected) > 0 ? "+" : ""}{pct - Math.round(p.expected)} pts</dd>
                        <dt className="text-ink-muted">Chapters left</dt><dd className="text-right font-mono font-semibold text-ink">{sub.totalChapters - sub.completedChapters}</dd>
                        <dt className="text-ink-muted">Target date</dt><dd className="text-right font-semibold text-ink">{formatDate(sub.targetDate)}</dd>
                      </motion.dl>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </GlassCard>
  );
}

function PacingPill({ status }: { status: PacingStatus }) {
  if (status === "completed") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-teal-soft to-cyan/10 px-2.5 py-0.5 text-[11.5px] font-bold text-lagoon ring-1 ring-inset ring-teal/25"><CheckCircle2 className="h-3 w-3" aria-hidden /> Completed</span>;
  }
  if (status === "behind") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50/90 px-2.5 py-0.5 text-[11.5px] font-bold text-rose-700 ring-1 ring-inset ring-rose-500/25 backdrop-blur-sm">
        <span className="relative grid h-1.5 w-1.5 place-items-center" aria-hidden>
          <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-rose-500 opacity-60 motion-reduce:hidden" />
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        </span>
        Behind pacing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50/90 px-2.5 py-0.5 text-[11.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 backdrop-blur-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> On schedule
    </span>
  );
}
