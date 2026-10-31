"use client";
/**
 * LIVE "My Classes": the teacher's sections with their rosters (Students). Module figures (homework counts) are omitted when Academics is not shipped.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueries } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMembership, useSchoolQuery } from "@/lib/convex/membership";
import { ClassesDashboard, type TeacherClassCard } from "@/features/students/classes-dashboard";
import { Card, CardHeader, EmptyState, LoadingState, Select } from "@/components/ui";
import { getAppError } from "@/lib/convex/errors";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function LiveMyClasses() {
  const params = useParams<{ id?: string }>();
  const { activeMembershipId } = useMembership();
  const teaching = useSchoolQuery(api.academics.myTeaching, {});
  const overview = useSchoolQuery(api.dashboards.teacherOverview, {});
  const sections = useSchoolQuery(api.academics.listSections, {});
  const sectionIds = useMemo(() => {
    if (!teaching) return [];
    const ids = new Map<string, string>();
    for (const c of teaching.classTeacherOf) ids.set(c.sectionId, c.displayName);
    for (const a of teaching.assignments) ids.set(a.sectionId, a.sectionName);
    return [...ids.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [teaching]);
  // One roster query per section (student count + avatar preview), batched by Convex.
  const rosterQueries = useMemo(
    () => Object.fromEntries(sectionIds.map((sec) => [sec.id, { query: api.students.sectionRoster, args: { sectionId: sec.id as Id<"sections">, ...(activeMembershipId ? { membershipId: activeMembershipId } : {}) } }])),
    [sectionIds, activeMembershipId],
  );
  const rosters = useQueries(rosterQueries) as Record<string, { students: { name: string }[] } | Error | undefined>;
  const [sectionId, setSectionId] = useState("");
  useEffect(() => {
    if (params?.id && sectionIds.some((sec) => sec.id === params.id) && sectionId !== params.id && !sectionId) { setSectionId(params.id); return; }
    if (!sectionIds.some((sec) => sec.id === sectionId)) setSectionId(sectionIds[0]?.id ?? "");
  }, [sectionIds, sectionId, params?.id]);
  const roster = useSchoolQuery(api.students.sectionRoster, sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip");

  const cards: TeacherClassCard[] = useMemo(() => {
    if (!teaching) return [];
    const owned = new Set(teaching.classTeacherOf.map((c) => c.sectionId as string));
    return sectionIds.map((sec) => {
      const r = rosters[sec.id];
      const students = r && !(r instanceof Error) ? r.students : null;
      const ct = overview?.classTeacherOf.find((c) => c.sectionId === sec.id);
      return {
        sectionId: sec.id,
        label: sec.name,
        room: sections?.find((x) => x._id === sec.id)?.room ?? null,
        subjects: teaching.assignments.filter((a) => a.sectionId === sec.id).map((a) => a.subjectName),
        students: students ? students.length : ct?.students ?? null,
        studentNames: students ? students.slice(0, 4).map((x) => x.name) : [],
        attendancePct: null, // no per-section average in the live records yet
        activeHomework: overview?.activeHomework ? overview.activeHomework.find((h) => h.sectionId === sec.id)?.count ?? 0 : null,
        isClassTeacher: owned.has(sec.id),
        markedToday: owned.has(sec.id) ? ct?.registerMarked ?? null : null,
      };
    });
  }, [teaching, overview, sections, rosters, sectionIds]);

  if (teaching === undefined) return <LoadingState variant="cards" label="Loading your classes" />;
  return (
    <div className="space-y-5">
      <ClassesDashboard classes={cards} />
      {sectionIds.length > 0 && (
        <Card id="roster" className="scroll-mt-20">
          <CardHeader title="Roster" description="Roll-number order (assigned by the school)." action={<Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-44">{sectionIds.map((sec) => <option key={sec.id} value={sec.id}>{sec.name}</option>)}</Select>} />
          <div className="p-5">
            {roster === undefined ? <LoadingState variant="table" /> : roster.students.length === 0 ? <EmptyState title="No students in this section" /> : (
              <ul className="divide-y divide-line/60">
                {roster.students.map((st) => (
                  <li key={st.studentId} className="flex items-center gap-3 py-2.5">
                    <span className="mono-id w-8 text-center font-bold text-sapphire">{st.rollNo ?? "—"}</span>
                    <Link href={`/teacher/students/${st.studentId}`} className="font-medium text-ink hover:text-lagoon">{st.name}</Link>
                    <span className="mono-id text-ink-muted">{st.admissionNo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
