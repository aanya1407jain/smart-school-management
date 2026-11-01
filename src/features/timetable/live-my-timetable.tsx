"use client";
/**
 * The LIVE student portal's My Timetable page (Academics module).
 */
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { LoadingState, PageHeader } from "@/components/ui";
import { LiveTimetableGrid } from "./live-timetable-grid";
import { MissingRecord, NotEnrolled, usePortalArgs } from "@/features/student-portal/live-portal";

export function LiveTimetable() {
  const t = useSchoolQuery(api.timetable.myStudentTimetable, usePortalArgs());
  if (t === undefined) return <LoadingState variant="table" label="Loading timetable" />;
  if (t.state === "no_student_record") return <MissingRecord />;
  if (t.state === "not_enrolled") return <NotEnrolled what="The timetable" />;
  return (<div><PageHeader title="My Timetable" description={`Class ${t.section} · weekly schedule`} /><LiveTimetableGrid timetable={t} /></div>);
}

