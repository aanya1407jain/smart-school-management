"use client";
/** Fees' parts of the admin dashboard (contributed, see src/modules/fees/contributions.tsx). */
import { AlertCircle, Wallet } from "lucide-react";
import type { AdminDashboardPartProps, AdminFeesOnly } from "@/lib/contributions/types";
import { useSession } from "@/features/auth/session-provider";
import { MetricCard, Panel, PanelEmpty, PanelLink } from "@/features/dashboard/principal-ui";
import { formatCurrency, formatPercent, pluralize } from "@/lib/utils/format";

/** Fee figures come back only for finance access (reports.adminDashboard); without it, show nothing rather than ₹0. */
function useCanSeeFees() {
  const { can } = useSession();
  return can("reports:finance") || can("fees:manage");
}

/** Total still owed for the year; the supporting line separates the overdue part. */
export function PendingFeesMetric({ d }: AdminDashboardPartProps) {
  const f = d.stats.fees;
  if (!useCanSeeFees()) return null;
  return (
    <MetricCard
      label="Pending fees"
      value={formatCurrency(f.outstanding)}
      support={f.overdue > 0 ? `${formatCurrency(f.overdue)} overdue · ${pluralize(f.overdueStudents, "student")}` : "Nothing overdue"}
      tone={f.overdue > 0 ? "warning" : "neutral"}
      icon={Wallet}
      href="/admin/fees?tab=balances"
    />
  );
}

/** Collection progress for the year plus the classes with the most still owed (full breakdown on Fees / Reports). */
export function FeeCollectionOverview({ d }: AdminDashboardPartProps) {
  const f = d.stats.fees;
  const allowed = useCanSeeFees();
  if (!allowed) return null;
  const rate = Math.max(0, Math.min(100, f.collectionRate));
  const owing = [...d.feeByClass].filter((c) => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 3);
  return (
    <Panel title="Fee collection" description="This academic year, all classes" action={<PanelLink href="/admin/reports?tab=fees">Report</PanelLink>} testId="dash-fee-summary">
      {f.collected + f.outstanding === 0 ? <PanelEmpty>No fees assigned for this year yet.</PanelEmpty> : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] text-pd-muted"><span className="text-[20px] font-semibold text-pd-ink tabular-nums">{formatPercent(rate, 1)}</span> collected</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-pd-line" role="img" aria-label={`${formatPercent(rate, 1)} of this year's fees collected`}>
            <div className="h-full rounded-full bg-pd-accent" style={{ width: `${rate}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            <div className="min-w-0"><dt className="text-pd-muted">Collected</dt><dd className="break-words font-semibold text-pd-ink tabular-nums">{formatCurrency(f.collected)}</dd></div>
            <div className="min-w-0"><dt className="text-pd-muted">Pending</dt><dd className="break-words font-semibold text-pd-ink tabular-nums">{formatCurrency(f.outstanding)}</dd></div>
          </dl>
          {owing.length > 0 && (
            <div className="mt-4 border-t border-pd-line pt-3">
              <p className="text-[12.5px] font-medium text-pd-muted">Most pending by class</p>
              <ul className="mt-1.5 space-y-1.5">
                {owing.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate text-pd-ink">{c.name}</span>
                    <span className="shrink-0 font-medium text-pd-ink tabular-nums">{formatCurrency(c.outstanding)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** A finance-only member (no school-wide reports) sees just the fee figures. */
export function FinanceOnlyFigures({ fees: f }: { fees: AdminFeesOnly }) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
      <MetricCard label="Collected" value={formatCurrency(f.collectedMinor / 100)} support={`${formatPercent(f.collectionRate, 1)} of net fees`} icon={Wallet} href="/admin/fees" />
      <MetricCard label="Pending" value={formatCurrency(f.outstandingMinor / 100)} icon={Wallet} href="/admin/fees?tab=balances" />
      <MetricCard label="Overdue" value={formatCurrency(f.overdueMinor / 100)} support={`${pluralize(f.overdueStudents, "student")}`} tone={f.overdueMinor > 0 ? "warning" : "neutral"} icon={AlertCircle} href="/admin/fees?tab=balances&standing=overdue" />
      <MetricCard label="Net fees" value={formatCurrency(f.netMinor / 100)} icon={Wallet} />
    </div>
  );
}
