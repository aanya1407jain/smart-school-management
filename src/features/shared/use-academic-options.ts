"use client";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";

/** Years, classes, sections (scoped to the user), subjects, teachers. */
export function useAcademicOptions() {
  return useQuery(() => services.lookup.getAcademicOptions(), []);
}
