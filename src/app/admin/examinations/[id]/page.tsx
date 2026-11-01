"use client";
import { useParams } from "next/navigation";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { LiveExamDetail } from "@/features/examinations/exams-live";
import { PortalPage } from "@/features/live/portal";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PortalPage demo={<DemoSlot id="exams.detail" props={{ examId: id, area: "admin" }} />} live={<LiveExamDetail examId={id} />} />;
}
