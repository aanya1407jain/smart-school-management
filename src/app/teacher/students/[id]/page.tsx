"use client";
import { useParams } from "next/navigation";
import { StudentProfileView } from "@/features/students/student-profile";

/** Teachers can open profiles of students in their assigned sections only (service-enforced). */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <StudentProfileView studentId={id} />;
}
