"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { StudentLedger } from "@/features/fees/student-ledger";

export default function Page() {
  const { studentId } = useParams<{ studentId: string }>();
  return <Suspense><StudentLedger studentId={studentId} /></Suspense>;
}
