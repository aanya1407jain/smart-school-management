import type { Metadata } from "next";
import { TeacherForm } from "@/features/teachers/teacher-form";

export const metadata: Metadata = { title: "Add teacher" };
export default function Page() {
  return <TeacherForm />;
}
