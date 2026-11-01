import type { Metadata } from "next";
import { PortalPage } from "@/features/live/portal";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { Card, EmptyState, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Add teacher" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="teachers.form" />} live={<Card className="mx-auto mt-6 max-w-xl"><EmptyState title="Add teachers from Accounts & Import" description="New teachers are added through Accounts & Import (one at a time or from a spreadsheet), which issues their employee ID and sign-in." action={<LinkButton href="/admin/accounts">Open Accounts & Import</LinkButton>} /></Card>} />;
}
