"use client";
import { useParams } from "next/navigation";
import { TeacherHomeworkDetail } from "@/features/homework/homework-manager";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveTeacherHomeworkDetail } from "@/features/teacher-live/teacher-live";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PortalPage demo={<TeacherHomeworkDetail homeworkId={id} />} live={<LiveTeacherHomeworkDetail homeworkId={id} />} />;
}
