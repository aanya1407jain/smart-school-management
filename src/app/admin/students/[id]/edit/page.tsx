"use client";
import { useParams } from "next/navigation";
import { StudentForm } from "@/features/students/student-form";
import { LiveAware } from "@/features/student-portal/live-portal";
import { LiveStudentEdit } from "@/features/students/live-students";
import { useSession } from "@/features/auth/session-provider";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { dataSource } = useSession();
  // Demo-dataset records (ids like "stu_aarav") keep the demo editor for demo personas; every
  // real school record (the Students list links to these for all admins) is edited in Convex.
  if (dataSource === "demo" && id.startsWith("stu_")) return <StudentForm studentId={id} />;
  return <LiveAware><LiveStudentEdit studentId={id} /></LiveAware>;
}
