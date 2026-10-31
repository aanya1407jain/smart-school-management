"use client";
/**
 * The LIVE student portal's My Results page (Examinations module).
 */
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { LoadingState, PageHeader } from "@/components/ui";
import { LiveResultsList } from "./live-results";
import { MissingRecord, usePortalArgs } from "@/features/student-portal/live-portal";

export function LiveResults() {
  const r = useSchoolQuery(api.exams.myResults, usePortalArgs());
  if (r === undefined) return <LoadingState variant="cards" label="Loading results" />;
  if (r.state === "no_student_record") return <MissingRecord />;
  return (<div><PageHeader title="My Results" description="Published examination results." /><LiveResultsList results={r.results} header={{ school: r.school, student: r.student }} /></div>);
}

