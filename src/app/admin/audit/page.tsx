import type { Metadata } from "next";
import { LiveAuditLog } from "@/features/audit/audit-log-live";
import { PortalPage } from "@/features/live/portal";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };
export default function Page() {
  return (
    <PortalPage
      // Demo personas: sample entries generated in the browser (internal build only).
      demo={<DemoSlot id="audit.log" fallback={<Card><EmptyState title="Audit log" description="The audit log records real school accounts' changes." /></Card>} />}
      live={<LiveAuditLog />}
    />
  );
}
