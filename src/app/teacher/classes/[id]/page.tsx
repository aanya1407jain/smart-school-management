"use client";
import { useParams } from "next/navigation";
import { TeacherClassDetail } from "@/features/teachers/my-classes";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveMyClasses } from "@/features/teacher-live/teacher-live";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  // Live accounts get the live class view (section picker + roster) instead of demo data.
  return <PortalPage demo={<TeacherClassDetail sectionId={id} />} live={<LiveMyClasses />} />;
}
