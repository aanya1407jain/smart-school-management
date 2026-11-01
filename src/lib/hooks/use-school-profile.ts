"use client";
/**
 * The current school's (tenant's) public identity for the app chrome —
 * splash, login, sidebar, breadcrumbs. Reactive: renaming the school in
 * Settings updates every place that shows it.
 */
import { requireDemo, demoRuntime, type PublicSchoolProfile } from "@/lib/demo/runtime";
import { useQuery } from "./use-query";

export type SchoolProfile = PublicSchoolProfile;

/** From the internal demo dataset when present; undefined otherwise (callers fall back to the signed-in school). */
export function useSchoolProfile(): SchoolProfile | undefined {
  return useQuery(() => requireDemo().school.getPublicProfile(), [], { enabled: !!demoRuntime() }).data;
}
