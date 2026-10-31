"use client";
import { useParams } from "next/navigation";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveTeacherHomeworkDetail } from "@/features/homework/live-teacher-homework";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PortalPage demo={<DemoSlot id="homework.detail" props={{ homeworkId: id }} />} live={<LiveTeacherHomeworkDetail homeworkId={id} />} />;
}
