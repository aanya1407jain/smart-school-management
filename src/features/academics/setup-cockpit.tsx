"use client";
/**
 * Academics → Year setup cockpit: the six setup steps as an interactive
 * horizontal rail (click a step to open its tab) plus the two health metrics
 * that tell the office whether the year is ready — teacher coverage (class
 * teachers per section) and student enrollment (enrolled vs active records).
 */
import type { CSSProperties } from "react";
import { BookMarked, CalendarRange, Check, GraduationCap, Layers, School, UserCheck } from "lucide-react";
import { GlassCard, ProgressRing } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export type CockpitStep = { tab: string; key: string; title: string; metric: string | null; detail: string; done: boolean };

const ICONS: Record<string, typeof Check> = { years: CalendarRange, classes: School, sections: Layers, subjects: BookMarked, enrollments: GraduationCap, assignments: UserCheck };

export function SetupCockpit({
  steps, onStep, coverage, enrollment,
}: {
  steps: CockpitStep[];
  onStep: (tab: string) => void;
  /** Teacher coverage percentage (null = nothing to cover yet) and its caption. */
  coverage: { pct: number | null; caption: string };
  /** Enrolled vs active students and a caption; null when Student Management is off. */
  enrollment: { enrolled: number; active: number; caption: string } | null;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const enrolledPct = enrollment && enrollment.active ? (enrollment.enrolled / enrollment.active) * 100 : 0;
  return (
    <div className="space-y-4">
      <GlassCard className="spatial p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-sapphire">Year setup workflow</h2>
            <p className="text-[13px] text-ink-muted">Each step builds on the previous one. Select a step to open it.</p>
          </div>
          <span className={cn("figures inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold ring-1 ring-inset", doneCount === steps.length ? "bg-gradient-to-r from-teal-soft to-cyan/10 text-lagoon ring-teal/25" : "bg-lavender/25 text-plum ring-mauve/30")}>
            {doneCount}/{steps.length} complete
          </span>
        </div>
        <ol className="scrollbar-thin -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-6 lg:overflow-visible">
          {steps.map((s, i) => {
            const Icon = ICONS[s.key] ?? Check;
            return (
              <li key={s.key} className="stagger min-w-[10.5rem] snap-start lg:min-w-0" style={{ "--stagger-i": i } as CSSProperties}>
                <button
                  type="button"
                  onClick={() => onStep(s.tab)}
                  className={cn(
                    "group relative flex h-full w-full flex-col gap-2 rounded-2xl border p-3 text-left backdrop-blur-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-ambient-lg focus-visible:outline-none focus-visible:shadow-focus active:scale-[0.98]",
                    s.done ? "border-white/70 bg-white/60" : "border-dashed border-mauve/40 bg-white/40",
                  )}
                >
                  {/* Connector to the next step (wide screens). */}
                  {i < steps.length - 1 && <span aria-hidden className={cn("absolute -right-2 top-7 hidden h-0.5 w-2 lg:block", s.done ? "bg-teal/50" : "bg-line")} />}
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("grid h-9 w-9 place-items-center rounded-xl ring-1 ring-inset transition-shadow group-hover:shadow-glow", s.done ? "bg-gradient-to-br from-teal to-aqua text-white ring-white/30" : "bg-heather/25 text-ink-soft ring-line/70")}>
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    {s.done ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                        <Check className="h-3 w-3" aria-hidden /> Done
                      </span>
                    ) : <span className="rounded-full bg-lavender/30 px-2 py-0.5 text-[10.5px] font-bold text-plum">To do</span>}
                  </span>
                  <span>
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Step {i + 1}</span>
                    <span className="block text-[13.5px] font-semibold leading-5 text-ink">
                      {s.title}{s.metric && <span className="figures ml-1 font-mono text-[12px] text-lagoon">({s.metric})</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-ink-muted">{s.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard className="spatial flex items-center gap-4 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <ProgressRing value={coverage.pct} size={78} stroke={7} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Teacher coverage</p>
            <p className="figures font-mono text-2xl font-bold text-sapphire">{coverage.pct === null ? "—" : `${Math.round(coverage.pct)}%`}</p>
            <p className="text-[12.5px] text-ink-muted">{coverage.caption}</p>
          </div>
        </GlassCard>
        <GlassCard className="spatial flex items-center gap-4 p-4 transition-transform duration-200 hover:-translate-y-0.5">
          <ProgressRing value={enrollment ? enrolledPct : null} size={78} stroke={7} tone="purple" />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Student enrollment</p>
            <p className="figures font-mono text-2xl font-bold text-sapphire">{enrollment ? `${enrollment.enrolled} / ${enrollment.active}` : "—"}</p>
            <p className="text-[12.5px] text-ink-muted">{enrollment ? enrollment.caption : "Student Management is not enabled"}</p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
