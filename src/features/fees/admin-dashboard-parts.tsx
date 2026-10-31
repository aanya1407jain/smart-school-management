"use client";
/** Fees' parts of the admin dashboard (contributed, see src/modules/fees/contributions.tsx). */
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, Wallet } from "lucide-react";
import type { AdminDashboardPartProps, AdminFeesOnly } from "@/lib/contributions/types";
import { StatCard } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

export function PendingFeesStat({ d }: AdminDashboardPartProps) {
  return <StatCard label="Pending fees" value={formatCurrency(d.stats.fees.outstanding)} icon={<Wallet className="h-5 w-5" />} tone="lavender" hint={`${formatCurrency(d.stats.fees.overdue)} overdue · ${d.stats.fees.overdueStudents} students`} href="/admin/fees" />;
}

export function FeeOverviewPanel({ d }: AdminDashboardPartProps) {
  return (
    <ChartCard title="Fee overview" description={`${formatPercent(d.stats.fees.collectionRate, 1)} of the year's fees collected`} action={<Link href="/admin/fees" className="text-[13px] font-medium text-lagoon hover:underline">Manage fees</Link>}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d.feeByClass} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="name" {...axisProps} />
          <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={48} />
          <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="collected" name="Collected" stackId="f" {...barProps("collected", { top: false })} maxBarSize={36} stroke="#fff" strokeWidth={1} />
          <Bar dataKey="outstanding" name="Outstanding" stackId="f" {...barProps("outstanding")} maxBarSize={36} stroke="#fff" strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** A finance-only member (no school-wide reports) sees just the fee figures. */
export function FinanceOnlyFigures({ fees: f }: { fees: AdminFeesOnly }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Collected" value={formatCurrency(f.collectedMinor / 100)} icon={<Wallet className="h-5 w-5" />} hint={`${formatPercent(f.collectionRate, 1)} of net fees`} href="/admin/fees" />
      <StatCard label="Outstanding" value={formatCurrency(f.outstandingMinor / 100)} icon={<Wallet className="h-5 w-5" />} tone="sapphire" href="/admin/fees?tab=balances" />
      <StatCard label="Overdue" value={formatCurrency(f.overdueMinor / 100)} icon={<AlertCircle className="h-5 w-5" />} tone="lavender" hint={`${f.overdueStudents} students`} href="/admin/fees?tab=balances&standing=overdue" />
      <StatCard label="Net fees" value={formatCurrency(f.netMinor / 100)} icon={<Wallet className="h-5 w-5" />} tone="purple" />
    </div>
  );
}
