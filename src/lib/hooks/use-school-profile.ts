"use client";
/**
 * The current school's (tenant's) public identity for the app chrome —
 * splash, login, sidebar, breadcrumbs. Reactive: renaming the school in
 * Settings updates every place that shows it.
 */
import { services } from "@/lib/services";
import { useQuery } from "./use-query";

export type SchoolProfile = Awaited<ReturnType<typeof services.school.getPublicProfile>>;

export function useSchoolProfile(): SchoolProfile | undefined {
  return useQuery(() => services.school.getPublicProfile(), []).data;
}
