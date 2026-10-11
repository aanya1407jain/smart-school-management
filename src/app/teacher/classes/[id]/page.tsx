"use client";
import { useParams } from "next/navigation";
import { TeacherClassDetail } from "@/features/teachers/my-classes";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <TeacherClassDetail sectionId={id} />;
}
