"use client";
import { useParams } from "next/navigation";
import { TeacherForm } from "@/features/teachers/teacher-form";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <TeacherForm teacherId={id} />;
}
