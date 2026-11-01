"use client";
/** Shared pieces of the Academics setup workspace (Core): record types from the Core API and small helpers used by Core and contributed tabs. */
import { useEffect, useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Card, EmptyState } from "@/components/ui";

export type Year = FunctionReturnType<typeof api.academics.listAcademicYears>[number];
export type Klass = FunctionReturnType<typeof api.academics.listClasses>[number];
export type Section = FunctionReturnType<typeof api.academics.listSections>[number];
export type Teacher = FunctionReturnType<typeof api.academics.listTeachers>[number];

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Spinner() {
  return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>;
}

export function NeedYear() {
  return <Card><EmptyState icon={<CalendarRange className="h-6 w-6" />} title="No academic year selected" description="Create an academic year (or choose one) first." /></Card>;
}

/** Keeps a selected section id valid as the sections list changes (e.g. when switching years). */

/** Keeps a selected section id valid as the sections list changes (e.g. when switching years). */
export function useSectionSelection(sections: Section[]) {
  const [sectionId, setSectionId] = useState<string>(sections[0]?._id ?? "");
  useEffect(() => {
    if (!sections.some((s) => s._id === sectionId)) setSectionId(sections[0]?._id ?? "");
  }, [sections, sectionId]);
  return [sectionId, setSectionId] as const;
}

// ------------------------------------------------------------------ Academic years
