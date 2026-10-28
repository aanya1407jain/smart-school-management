"use client";
import { useParams } from "next/navigation";
import { PortalPage } from "@/features/live/portal";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { Card, EmptyState, LinkButton } from "@/components/ui";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PortalPage demo={<DemoSlot id="teachers.profile" props={{ teacherId: id }} />} live={<Card className="mx-auto mt-6 max-w-xl"><EmptyState title="Teacher records" description="Teacher records are viewed and edited in Teachers & Staff." action={<LinkButton href="/admin/teachers">Open Teachers & Staff</LinkButton>} /></Card>} />;
}
