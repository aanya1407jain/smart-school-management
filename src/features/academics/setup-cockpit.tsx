"use client";
/**
 * Academics → year summary: one KPI strip (classes, sections, class-teacher
 * coverage, students placed). While the year's setup is unfinished a single
 * "next step" line sits above it; once every step is done nothing else shows.
 */
import { ArrowRight, Layers, School, UserCheck, Users } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type CockpitStep = { tab: string; key: string; title: string; metric: string | null; detail: string; done: boolean };

export function SetupCockpit({
  steps, onStep, classes, sections, yearName, coverage, enrollment,
}: {
  steps: CockpitStep[];
  onStep: (tab: string) => void;
  classes: number;
  sections: number;
  yearName: string | null;
  /** Sections with a class teacher, out of all sections. */
  coverage: { assigned: number; total: number };
  /** Enrolled vs active students; null when Student Management is off. */
  enrollment: { enrolled: number; active: number } | null;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const perClass = classes ? (sections / classes).toFixed(1).replace(/\.0$/, "") : null;
  return (
    <div className="space-y-3">
      {next && (
        <button
          type="button"
          onClick={() => onStep(next.tab)}
          className="group flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-left text-[13px] text-amber-900 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
        >
          <span className="figures shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset ring-amber-200">{doneCount}/{steps.length}</span>
          <span className="min-w-0 flex-1 truncate">Year setup · next: <b className="font-semibold">{next.title}</b> <span className="text-amber-800/80">— {next.detail}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      )}

      <section aria-label={yearName ? `${yearName} at a glance` : "Year at a glance"} className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-white shadow-sm lg:grid-cols-4">
        <Kpi icon={School} label="Classes" value={classes} caption={yearName ? `In ${yearName}` : "No current year"} onClick={() => onStep("classes")} />
        <Kpi icon={Layers} label="Sections" value={sections} caption={perClass ? `≈ ${perClass} per class` : "Add a class first"} onClick={() => onStep("classes")} />
        <Kpi
          icon={UserCheck}
          label="Class teachers"
          value={<>{coverage.assigned}<span className="text-base font-medium text-ink-muted"> / {coverage.total}</span></>}
          caption={coverage.total === 0 ? "No sections yet" : `${coverage.assigned} assigned / ${coverage.total} sections`}
          progress={coverage.total ? (coverage.assigned / coverage.total) * 100 : null}
          onClick={() => onStep(steps.some((s) => s.tab === "assignments") ? "assignments" : "classes")}
        />
        <Kpi
          icon={Users}
          label="Students placed"
          value={enrollment ? <>{enrollment.enrolled}<span className="text-base font-medium text-ink-muted"> / {enrollment.active}</span></> : "—"}
          caption={!enrollment ? "Student Management is off" : enrollment.enrolled === enrollment.active ? "Every active student has a section" : `${enrollment.active - enrollment.enrolled} without a section`}
          progress={enrollment && enrollment.active ? (enrollment.enrolled / enrollment.active) * 100 : null}
          onClick={enrollment && steps.some((s) => s.tab === "enrollments") ? () => onStep("enrollments") : undefined}
        />
      </section>
    </div>
  );
}

/**
 * One cell of the strip. Cells are split by hairlines rather than gaps: a left
 * border from the second column, and on phones (2 × 2) a top border on row two.
 */
function Kpi({ icon: Icon, label, value, caption, progress = null, onClick }: { icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; label: string; value: ReactNode; caption: string; progress?: number | null; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-muted">
        <Icon className="h-4 w-4 text-emerald-700" aria-hidden /> {label}
      </span>
      <span className="figures mt-1.5 block text-2xl font-semibold leading-none tracking-tight text-ink">{value}</span>
      <span className="mt-2 flex items-center gap-2">
        {progress !== null && (
          <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-line" aria-hidden>
            <span className={cn("block h-full rounded-full", progress >= 100 ? "bg-emerald-600" : "bg-amber-500")} style={{ width: `${Math.min(100, progress)}%` }} />
          </span>
        )}
        <span className="truncate text-[12px] text-ink-muted">{caption}</span>
      </span>
    </>
  );
  const cls = "block min-w-0 border-line px-5 py-4 text-left [&:nth-child(n+2)]:border-l max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(n+3)]:border-t";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600/40")}>{body}</button>
  ) : <div className={cls}>{body}</div>;
}
