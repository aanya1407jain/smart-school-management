import type { ReactNode } from "react";
import { Award } from "lucide-react";
import { Badge, ProgressRing } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/**
 * Accomplishment header shared by the demo and live result cards: score ring,
 * exam name and term, grade and rank badges on a frosted gradient band.
 */
export function ResultSummary({ term, examName, percentage, grade, rank, failed, badges }: { term?: string | null; examName: string; percentage: number | null; grade?: string | null; rank?: string | null; failed?: boolean; badges?: ReactNode }) {
  return (
    <div className="relative flex items-center gap-4 overflow-hidden border-b border-line/60 bg-bg px-5 py-4">
      <ProgressRing value={percentage} size={72} stroke={7} tone={failed ? "plum" : "teal"} />
      <div className="relative min-w-0 flex-1">
        {term && <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{term}</p>}
        <h3 className="truncate text-base font-semibold text-sapphire">{examName}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {grade && <Badge tone="lavender"><Award className="h-3 w-3" aria-hidden />Grade {grade}</Badge>}
          {rank && <Badge tone="sapphire" className="figures">{rank}</Badge>}
          {badges}
        </div>
      </div>
    </div>
  );
}

/** Compact high-contrast grade tag for a subject row. */
export function GradeChip({ grade, passed }: { grade: string; passed: boolean }) {
  return (
    <span className={cn("inline-grid min-w-[2rem] place-items-center rounded-md px-1.5 py-0.5 font-mono text-[12px] font-bold ring-1 ring-inset", passed ? "bg-sapphire/[0.06] text-sapphire ring-sapphire/15" : "bg-blush/50 text-plum ring-plum/20")}>
      {grade}
    </span>
  );
}

