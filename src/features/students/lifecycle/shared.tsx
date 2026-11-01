"use client";
/** Shared pieces of the Promotions & TC workspace (pickers, pills, money). */
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge, FormField, Select, type Tone } from "@/components/ui";
import { useSchoolQuery } from "@/lib/convex/membership";
import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export const rupees = (minor: number) => formatCurrency(minor / 100);

/**
 * Academic-year + section picker (every year, not only the current one).
 * Renders two grid cells, so a parent grid can lay two pickers out as one row of four.
 */
export function YearSectionPicker({
  label, value, onChange, onYear, yearFilter, placeholder = "Choose a section",
}: {
  label: string;
  value: Id<"sections"> | "";
  onChange: (id: Id<"sections"> | "") => void;
  onYear?: (id: Id<"academicYears"> | "") => void;
  yearFilter?: (y: { startDate: string; _id: Id<"academicYears"> }) => boolean;
  placeholder?: string;
}) {
  const years = useSchoolQuery(api.academics.listAcademicYears, {});
  const [yearId, setYearId] = useState<Id<"academicYears"> | "">("");
  const visibleYears = (years ?? []).filter((y) => !yearFilter || yearFilter(y));
  useEffect(() => {
    // Default to the current year (or the first visible one); drop a year that is no longer offered.
    if ((!yearId || !visibleYears.some((y) => y._id === yearId)) && visibleYears.length) {
      const next = (visibleYears.find((y) => y.isCurrent) ?? visibleYears[0])._id;
      setYearId(next);
      onYear?.(next);
    }
  }, [yearId, visibleYears]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useSchoolQuery(api.academics.listSections, yearId ? { academicYearId: yearId } : "skip");
  return (
    <>
      <FormField label={`${label}: academic year`}>
        <Select value={yearId} onChange={(e) => { const y = e.target.value as Id<"academicYears">; setYearId(y); onYear?.(y); onChange(""); }} disabled={!years}>
          {visibleYears.length === 0 && <option value="">No academic years</option>}
          {visibleYears.map((y) => <option key={y._id} value={y._id}>{y.name}{y.isCurrent ? " (current)" : ""}</option>)}
        </Select>
      </FormField>
      <FormField label={`${label}: section`}>
        <Select value={value} onChange={(e) => onChange(e.target.value as Id<"sections"> | "")} disabled={!sections}>
          <option value="">{placeholder}</option>
          {(sections ?? []).map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
        </Select>
      </FormField>
    </>
  );
}

export type Standing = "eligible" | "compartment" | "detained" | "no_result";

const STANDING: Record<Standing, { label: string; tone: Tone }> = {
  eligible: { label: "Eligible", tone: "teal" },
  compartment: { label: "Compartment", tone: "lavender" },
  detained: { label: "Repeat / Detained", tone: "plum" },
  no_result: { label: "No result", tone: "neutral" },
};

export function StandingPill({ standing }: { standing: Standing }) {
  const s = STANDING[standing];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export type PassResult = "passed" | "compartment" | "failed" | "withheld";

const RESULT: Record<PassResult, { label: string; tone: Tone }> = {
  passed: { label: "Passed", tone: "teal" },
  compartment: { label: "Compartment", tone: "lavender" },
  failed: { label: "Not passed", tone: "plum" },
  withheld: { label: "Withheld", tone: "neutral" },
};

export function ResultPill({ result }: { result: PassResult }) {
  const r = RESULT[result];
  return <Badge tone={r.tone} dot>{r.label}</Badge>;
}

/** Checklist line with a tick or a warning mark. */
export function CheckItem({ ok, children, detail }: { ok: boolean; children: ReactNode; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold", ok ? "bg-primary text-white" : "bg-pd-warning text-white")}>{ok ? "✓" : "!"}</span>
      <span className="min-w-0 text-sm">
        <span className={cn("font-medium", ok ? "text-ink" : "text-plum")}>{children}</span>
        <span className="sr-only">{ok ? " — done" : " — needs attention"}</span>
        {detail && <span className="block text-[12.5px] text-ink-muted">{detail}</span>}
      </span>
    </li>
  );
}
