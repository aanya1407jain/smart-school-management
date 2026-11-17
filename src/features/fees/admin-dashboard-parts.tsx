"use client";
/** Fees' parts of the admin dashboard (contributed, see src/modules/fees/contributions.tsx). */
import { AlertCircle, Wallet } from "lucide-react";
import type { AdminDashboardPartProps, AdminFeesOnly } from "@/lib/contributions/types";
import { useSession } from "@/features/auth/session-provider";
import { MetricCard, Panel, PanelEmpty, PanelLink, SplitBar } from "@/features/dashboard/principal-ui";
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
      accent="fees"
      viz={f.collected + f.outstanding > 0 ? <SplitBar parts={[
        { value: f.collected, className: "bg-mint", label: "Collected" },
        { value: Math.max(0, f.outstanding - f.overdue), className: "bg-marigold", label: "Due" },
        { value: f.overdue, className: "bg-coral", label: "Overdue" },
      ]} /> : undefined}
      href="/admin/fees?tab=balances"
    />
  );
}

/** Percentage ring, drawn in on load. */
function Ring({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative h-[92px] w-[92px] shrink-0" role="img" aria-label={`${formatPercent(value, 1)} of this year's fees collected`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="9" style={{ stroke: "rgb(var(--c-marigold) / 0.25)" }} />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="9" strokeLinecap="round" style={{ stroke: "rgb(var(--c-mint))", strokeDasharray: `${(value / 100) * c} ${c}` }} className="animate-[ring-in_1.1s_cubic-bezier(.2,.8,.2,1)_both]" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center"><span><span className="block text-[18px] font-semibold leading-none tracking-[-0.03em] text-pd-ink tabular-nums">{Math.round(value)}%</span><span className="text-[10.5px] text-pd-muted">collected</span></span></span>
    </div>
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
    <Panel icon="fees" title="Fee collection" description="This academic year" action={<PanelLink href="/admin/reports?tab=fees">Report</PanelLink>} testId="dash-fee-summary">
      {f.collected + f.outstanding === 0 ? <PanelEmpty>No fees assigned for this year yet.</PanelEmpty> : (
        <>
          <div className="flex items-center gap-5">
            <Ring value={rate} />
            <dl className="grid flex-1 gap-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-pd-muted"><span className="h-2 w-2 rounded-full bg-mint" />Collected</dt><dd className="font-semibold text-pd-ink tabular-nums">{formatCurrency(f.collected)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-pd-muted"><span className="h-2 w-2 rounded-full bg-marigold" />Pending</dt><dd className="font-semibold text-pd-ink tabular-nums">{formatCurrency(f.outstanding)}</dd></div>
              {f.overdue > 0 && <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-pd-muted"><span className="h-2 w-2 rounded-full bg-coral" />Overdue</dt><dd className="font-semibold text-pd-danger tabular-nums">{formatCurrency(f.overdue)}</dd></div>}
            </dl>
          </div>
          {owing.length > 0 && (
            <div className="mt-5 rounded-2xl bg-bg/70 p-3.5">
              <p className="text-[12.5px] font-medium text-pd-muted">Most pending</p>
              <ul className="mt-2 space-y-2">
                {owing.map((c) => (
                  <li key={c.name} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-[13px]">
                    <span className="truncate text-pd-ink">{c.name}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface"><span className="grow-x block h-full rounded-full bg-marigold" style={{ width: `${(c.outstanding / owing[0].outstanding) * 100}%` }} /></span>
                    <span className="font-medium text-pd-ink tabular-nums">{formatCurrency(c.outstanding)}</span>
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
