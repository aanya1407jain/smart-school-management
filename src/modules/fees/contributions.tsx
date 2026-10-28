"use client";
/** Fees' contributions to shared screens (src/lib/contributions/types.ts). */
import { Wallet } from "lucide-react";
import type { ModuleUiContributions } from "@/lib/contributions/types";
import { LinkButton } from "@/components/ui";
import { LiveFeesPanel } from "@/features/fees/live-fees-panel";
import { FeeOverviewPanel, FinanceOnlyFigures, PendingFeesStat } from "@/features/fees/admin-dashboard-parts";
import { FeeReport } from "@/features/fees/fee-report";
import { formatCurrency } from "@/lib/utils/format";
import { todayISO } from "@/lib/utils/dates";

export const feesUi: ModuleUiContributions = {
  reportTabs: { module: "finance", order: 30, tabs: [{ value: "fees", label: "Fees", visible: (can) => can("reports:finance") || can("fees:manage"), Content: FeeReport }] },
  adminDashboard: { module: "finance", order: 20, Stats: PendingFeesStat, panels: [{ Panel: FeeOverviewPanel }], quickActions: [{ label: "Collect fee", href: "/admin/fees?action=collect", Icon: Wallet }], FinanceOnly: FinanceOnlyFigures },
  studentProfile: {
    module: "finance",
    order: 20,
    metrics: (p) => [{
      key: "fees",
      label: "Fee balance",
      value: p.fees ? (p.fees.totals.outstandingMinor ? formatCurrency(p.fees.totals.outstandingMinor / 100) : p.fees.obligations.length ? "Paid" : "None assigned") : "Restricted",
      tone: p.fees?.obligations.some((o) => o.outstandingMinor > 0 && o.dueDate < todayISO()) ? "warn" : undefined,
    }],
    tabs: (p) => (p.fees ? [{ value: "fees", label: "Fees", content: <LiveFeesPanel fees={p.fees} /> }] : []),
    actions: (p) => (p.isAdmin && p.studentId ? <LinkButton href={`/admin/fees/${p.studentId}`} variant="outline"><Wallet className="h-4 w-4" /> Fee ledger</LinkButton> : null),
  },
};
