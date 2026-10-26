"use client";
/**
 * Admin → Promotions & TC. Promotes sections into the next academic year,
 * graduates final-year cohorts to alumni, and drafts / issues / cancels
 * transfer certificates. Server: convex/studentLifecycle.ts (permission
 * `students:lifecycle`, Student Management module). Every operation is atomic
 * and audited; history (old enrollments, roll numbers, marks, attendance, fee
 * ledgers, cancelled TCs) is never rewritten.
 */
import { Card, EmptyState, PageHeader, Tabs, TabsContent, TabsList } from "@/components/ui";
import { isConvexConfigured } from "@/lib/convex/config";
import { PromoteTab } from "./lifecycle/promote-tab";
import { PassOutTab } from "./lifecycle/passout-tab";
import { TransferCertificatesTab } from "./lifecycle/tc-tab";

export function StudentLifecyclePage() {
  const header = (
    <PageHeader
      title="Promotions & transfer certificates"
      description="Promote a section into the next academic year, graduate final-year students to alumni, and issue transfer certificates. Nothing is deleted: earlier classes, roll numbers and cancelled certificates stay in each student's history."
    />
  );
  if (!isConvexConfigured) return <div>{header}<Card><EmptyState title="Backend not connected" description="Student lifecycle operations need the Convex backend." /></Card></div>;
  return (
    <div>
      {header}
      <Tabs defaultValue="promote">
        <TabsList items={[{ value: "promote", label: "Promote" }, { value: "passout", label: "Pass out" }, { value: "tc", label: "Transfer certificates" }]} />
        <TabsContent value="promote"><PromoteTab /></TabsContent>
        <TabsContent value="passout"><PassOutTab /></TabsContent>
        <TabsContent value="tc"><TransferCertificatesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
