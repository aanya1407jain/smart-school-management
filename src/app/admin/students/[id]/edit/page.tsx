"use client";
import { useParams } from "next/navigation";
import { StudentForm } from "@/features/students/student-form";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <StudentForm studentId={id} />;
}
