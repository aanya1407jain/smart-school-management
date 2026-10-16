"use client";
import { useParams } from "next/navigation";
import { StudentForm } from "@/features/students/student-form";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveStudentEdit } from "@/features/students/live-students";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PortalPage demo={<StudentForm studentId={id} />} live={<LiveStudentEdit studentId={id} />} />;
}
