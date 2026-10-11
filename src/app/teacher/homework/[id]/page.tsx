"use client";
import { useParams } from "next/navigation";
import { TeacherHomeworkDetail } from "@/features/homework/homework-manager";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <TeacherHomeworkDetail homeworkId={id} />;
}
