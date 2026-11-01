"use client";
import { useMemo } from "react";
import { api } from "@convex/_generated/api";
import { requireDemo, type AcademicOptions } from "@/lib/demo/runtime";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { useSession } from "@/features/auth/session-provider";

/**
 * Years, classes, sections (scoped to the user), subjects, teachers — for
 * forms and filters.
 *  - demo personas: the in-browser demo data (unchanged);
 *  - live (school) accounts: the school's real Convex records, so filter
 *    values are real ids. Sections come from `academics.listSections`, which
 *    the server already scopes (admins: all; teachers: their own). Teachers
 *    and the bell schedule are not part of the live options (each live screen
 *    that needs them loads them itself).
 * A live failure surfaces as an error (never as demo data).
 */
export function useAcademicOptions(): QueryState<AcademicOptions> {
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const demo = useQuery(() => requireDemo().school.getAcademicOptions(), [live], { enabled: !live });
  const years = useSchoolQuery(api.academics.listAcademicYears, live ? {} : "skip");
  const hasCurrent = !!years?.some((y) => y.isCurrent);
  const classes = useSchoolQuery(api.academics.listClasses, live ? {} : "skip");
  const sections = useSchoolQuery(api.academics.listSections, live && hasCurrent ? {} : "skip");
  const subjects = useSchoolQuery(api.academics.listSubjectOptions, live ? {} : "skip");

  const liveData = useMemo<AcademicOptions | undefined>(() => {
    if (!live || !years || !classes || !subjects || (hasCurrent && !sections)) return undefined;
    const current = years.find((y) => y.isCurrent) ?? null;
    const level = new Map(classes.map((c) => [c._id as string, c.level]));
    const secs = (sections ?? []).map((s) => ({ id: s._id as string, classId: s.classId as string, name: s.name, label: s.displayName, grade: level.get(s.classId) ?? 0, room: s.room ?? "" }));
    const usedClassIds = new Set(secs.map((s) => s.classId));
    return {
      // Server statuses planned / active / closed ↔ UI upcoming / active / archived.
      years: years.map((y) => ({ id: y._id as string, name: y.name, startDate: y.startDate, endDate: y.endDate, status: y.status === "planned" ? ("upcoming" as const) : y.status === "closed" ? ("archived" as const) : ("active" as const) })),
      currentYearId: (current?._id as string) ?? "",
      classes: classes
        .filter((c) => c.active !== false && (usedClassIds.size === 0 || usedClassIds.has(c._id)))
        .sort((a, b) => a.level - b.level)
        .map((c) => ({ id: c._id as string, academicYearId: (current?._id as string) ?? "", grade: c.level, name: c.name, subjectIds: [] as string[] })),
      sections: secs.sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)),
      subjects: subjects.map((s) => ({ id: s._id as string, name: s.name, code: s.code, type: "core" as const })),
      periods: [],
      teachers: [],
    };
  }, [live, years, classes, sections, subjects, hasCurrent]);

  if (!live) return demo;
  return { data: liveData, error: null, isLoading: liveData === undefined, isRefreshing: false, refetch: () => {} };
}
