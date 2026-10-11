import type { Metadata } from "next";
import { StudentForm } from "@/features/students/student-form";

export const metadata: Metadata = { title: "Add student" };
export default function Page() {
  return <StudentForm />;
}
