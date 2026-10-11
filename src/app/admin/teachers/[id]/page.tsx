"use client";
import { useParams } from "next/navigation";
import { TeacherProfileView } from "@/features/teachers/teacher-profile";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <TeacherProfileView teacherId={id} />;
}
