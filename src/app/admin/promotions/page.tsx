import type { Metadata } from "next";
import { StudentLifecyclePage } from "@/features/students/student-lifecycle";

export const metadata: Metadata = { title: "Promotions & TC" };
export default function Page() {
  return <StudentLifecyclePage />;
}
