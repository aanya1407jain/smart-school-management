"use client";
import { useParams } from "next/navigation";
import { StudentProfileView } from "@/features/students/student-profile";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <StudentProfileView studentId={id} backHref="/admin/students" />;
}
