"use client";
/**
 * Reports (Core shell). Each tab is contributed by the module its data comes
 * from (src/lib/contributions) — only modules shipped in the build appear —
 * and follows the school's module entitlements and the member's permissions
 * (the server checks both again).
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/features/auth/session-provider";
import { EmptyState, PageHeader, Tabs, TabsContent, TabsList } from "@/components/ui";
import { contributionsTo } from "@/lib/contributions";

export function ReportsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { can, hasModule } = useSession();
  const tabs = contributionsTo("reportTabs", hasModule).flatMap((c) => c.tabs).filter((t) => t.visible(can));
  const allowed = new Set(tabs.map((t) => t.value));
  const fallback = tabs[0]?.value ?? "";
  const [tab, setTabState] = useState(params.get("tab") ?? fallback);
  const setTab = (t: string) => setTabState(allowed.has(t) ? t : fallback);
  useEffect(() => { const t = params.get("tab"); if (t) setTabState(allowed.has(t) ? t : fallback); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = allowed.has(tab) ? tab : fallback;
  return (
    <div>
      <PageHeader title="Reports" description="Every figure and chart is computed live from school records — change the data and the reports follow." />
      {tabs.length === 0 ? <EmptyState title="No reports available" description="Reports appear here for the modules your school uses and your account may see." /> : (
        <Tabs value={current} onValueChange={(t) => { setTab(t); router.replace(`/admin/reports?tab=${t}`, { scroll: false }); }}>
          <TabsList items={tabs.map(({ value, label }) => ({ value, label }))} />
          {tabs.map(({ value, Content }) => <TabsContent key={value} value={value}><Content /></TabsContent>)}
        </Tabs>
      )}
    </div>
  );
}
