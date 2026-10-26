"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { StudentLedger } from "@/features/fees/student-ledger";
import { LiveAware } from "@/features/student-portal/live-portal";

export default function Page() {
  const { studentId } = useParams<{ studentId: string }>();
  return <Suspense><LiveAware><StudentLedger studentId={studentId} /></LiveAware></Suspense>;
}
