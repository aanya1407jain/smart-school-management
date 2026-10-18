"use client";
/**
 * Admin → Accounts & Import. Fully Convex-backed: people, sign-in accounts and
 * onboarding imports. The server authorises every call (users:manage,
 * students:write, staff:manage); permissions here only decide what to show.
 */
import { PageHeader, Card, EmptyState, Tabs, TabsContent, TabsList } from "@/components/ui";
import { isConvexConfigured } from "@/lib/convex/config";
import { useSession } from "@/features/auth/session-provider";
import { hasPermission } from "@/lib/permissions";
import type { ImportTarget } from "@convex/model/importSpecs";
import { PeoplePanel } from "./people-panel";
import { ImportWizard } from "./import-wizard";
import { StaffAccessPanel } from "./staff-access-panel";

export function AccountsWorkspace() {
  const { user } = useSession();
  const header = (
    <PageHeader
      title="Accounts & Import"
      description="Add students and teachers, import them from a spreadsheet, and manage their sign-in accounts."
    />
  );
  if (!isConvexConfigured) {
    return (
      <div>
        {header}
        <Card><EmptyState title="Backend not connected" description="Account management needs the Convex backend (NEXT_PUBLIC_CONVEX_URL). It is not available in the offline demo." /></Card>
      </div>
    );
  }
  const canStudents = hasPermission(user, "students:write");
  const canStaff = hasPermission(user, "staff:manage");
  const canAccounts = hasPermission(user, "users:manage");
  const importTargets: ImportTarget[] = [...(canStudents ? ["students" as const] : []), ...(canStaff ? ["teachers" as const] : [])];
  const tabs = [
    ...(canAccounts ? [{ value: "students", label: "Students" }, { value: "teachers", label: "Teachers" }, { value: "staff", label: "Office & access" }] : []),
    ...(importTargets.length ? [{ value: "import", label: "Import" }] : []),
  ];
  if (!tabs.length) return <div>{header}<Card><EmptyState title="Nothing to manage" description="You do not have permission to manage accounts or import data." /></Card></div>;

  return (
    <div>
      {header}
      <Tabs defaultValue={tabs[0].value}>
        <TabsList items={tabs} />
        {canAccounts && <TabsContent value="students"><PeoplePanel kind="student" canAdd={canStudents} /></TabsContent>}
        {canAccounts && <TabsContent value="teachers"><PeoplePanel kind="teacher" canAdd={canStaff} /></TabsContent>}
        {canAccounts && <TabsContent value="staff"><StaffAccessPanel /></TabsContent>}
        {importTargets.length > 0 && <TabsContent value="import"><ImportWizard allowed={importTargets} canCreateAccounts={canAccounts} /></TabsContent>}
      </Tabs>
    </div>
  );
}
