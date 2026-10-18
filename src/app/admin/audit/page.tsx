import type { Metadata } from "next";
import { LiveAuditLog } from "@/features/audit/audit-log-live";
import { PortalPage } from "@/features/student-portal/live-portal";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };
export default function Page() {
  return <PortalPage demo={<Card><EmptyState title="Audit log" description="The audit log records real school accounts' changes; the demo school does not keep one." /></Card>} live={<LiveAuditLog />} />;
}
