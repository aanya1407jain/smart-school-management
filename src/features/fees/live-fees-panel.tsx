"use client";
/**
 * A REAL (Convex) student fee ledger: installments, concessions and payments. Amounts arrive in minor units (paise). Used by the student portal (My Fees) and the Fees section of the staff student profile.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { BadgeChip, Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/format";
import { dueLabel, formatDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Ok<T> = Extract<T, { state: "ok" }>;
export type LiveFees = Omit<Ok<FunctionReturnType<typeof api.fees.myFees>>, "state">;

const rupees = (minor: number) => formatCurrency(minor / 100);
const METHOD: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", cheque: "Cheque", online: "Online" };

export function LiveFeesPanel({ fees, today = todayISO() }: { fees: LiveFees; today?: string }) {
  const overdue = fees.obligations.some((o) => o.outstandingMinor > 0 && o.dueDate < today);
  return (
    <div className="space-y-4" data-testid="live-fees">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Amount label="Total fees" value={rupees(fees.totals.grossMinor)} accent="bg-sapphire/70" />
        <Amount label="Concession" value={rupees(fees.totals.concessionMinor)} accent="bg-mauve" />
        <Amount label="Paid" value={rupees(fees.totals.paidMinor)} accent="bg-teal" />
        <Amount label="Outstanding" value={rupees(fees.totals.outstandingMinor)} warn={overdue} accent={overdue ? "bg-pd-danger" : "bg-amber-500"} />
      </div>
      <Card>
        <CardHeader title="Installments" description={fees.academicYear} />
        {fees.obligations.length === 0 ? (
          <EmptyState title="No fees assigned" description="The school office has not assigned a fee structure to this student for the current year." />
        ) : (
          <div className="relative overflow-x-auto p-5">
            <table className="w-full text-sm">
              <caption className="sr-only">Fee installments</caption>
              <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-ink-muted"><th className="py-2">Installment</th><th className="py-2 text-right">Amount</th><th className="py-2 text-right">Concession</th><th className="py-2 text-right">Paid</th><th className="py-2 text-right">Balance</th></tr></thead>
              <tbody>
                {fees.obligations.map((o) => (
                  <tr key={o.obligationId} className="figures border-t border-line/50 transition-colors hover:bg-teal-soft/20">
                    <td className="py-2.5"><p className="font-semibold text-ink">{o.label}</p><p className="text-[12px] text-ink-muted">{o.outstandingMinor > 0 ? dueLabel(o.dueDate, today) : `Due ${formatDate(o.dueDate)}`}</p></td>
                    <td className="py-2.5 text-right">{rupees(o.amountMinor)}</td>
                    <td className="py-2.5 text-right">{o.concessionMinor ? `− ${rupees(o.concessionMinor)}` : "—"}</td>
                    <td className="py-2.5 text-right">{rupees(o.paidMinor)}</td>
                    <td className="py-2.5 text-right">{o.outstandingMinor > 0 ? <span className="inline-flex items-center gap-2"><span className="font-semibold text-ink">{rupees(o.outstandingMinor)}</span><StatusBadge status={o.dueDate < today ? "overdue" : "pending"} /></span> : <StatusBadge status="paid" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Payment history" />
        {fees.payments.length === 0 ? <EmptyState title="No payments recorded" /> : (
          <ul className="divide-y divide-line/60">
            {fees.payments.map((p) => (
              <li key={p.paymentId} className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-teal-soft/20">
                <span className="flex flex-wrap items-center gap-2"><BadgeChip tone="neutral">{p.receiptNo ?? "—"}</BadgeChip><span className="text-ink-muted">{formatDate(p.paidOn)} · {METHOD[p.method] ?? p.method}</span></span>
                <span className="figures font-semibold text-ink">{rupees(p.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Split fee card: flat surface with a coloured accent stripe and tabular amount. */
function Amount({ label, value, warn, accent }: { label: string; value: string; warn?: boolean; accent: string }) {
  return (
    <div className="solid-card spatial relative overflow-hidden p-4 pl-5 transition-transform duration-200">
      <span aria-hidden className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full", accent)} />
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cn("figures mt-1 text-lg font-bold", warn ? "text-plum" : "text-sapphire")}>{value}</p>
    </div>
  );
}
