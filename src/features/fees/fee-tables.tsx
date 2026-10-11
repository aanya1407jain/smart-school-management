"use client";
import { useState } from "react";
import { Printer, Receipt as ReceiptIcon } from "lucide-react";
import type { Payment } from "@/types/domain";
import type { ObligationView } from "@/lib/services/derive";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Button, DataTable, EmptyState, Modal, QueryView, StatusBadge } from "@/components/ui";
import { LogoMark } from "@/components/brand/logo";
import { formatCurrency } from "@/lib/utils/format";
import { formatDate, formatDateTime, dueLabel } from "@/lib/utils/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants/labels";

export function FeeObligationsTable({ obligations }: { obligations: ObligationView[] }) {
  return (
    <DataTable<ObligationView>
      caption="Fee installments"
      rows={obligations}
      getRowId={(o) => o.id}
      empty={<EmptyState title="No fee records available" description="No fee structure has been assigned yet." />}
      columns={[
        { key: "label", header: "Installment", primary: true, cell: (o) => <div><p className="font-semibold text-ink">{o.label}</p><p className="text-[12px] text-ink-muted">Due {formatDate(o.dueDate)}</p></div> },
        { key: "amount", header: "Amount", align: "right", cell: (o) => formatCurrency(o.amount) },
        { key: "concession", header: "Concession", align: "right", cell: (o) => (o.concession ? `− ${formatCurrency(o.concession)}` : "—") },
        { key: "paid", header: "Paid", align: "right", cell: (o) => formatCurrency(o.paid) },
        { key: "outstanding", header: "Balance", align: "right", cell: (o) => <span className={o.outstanding > 0 ? "font-semibold text-ink" : "text-ink-muted"}>{formatCurrency(o.outstanding)}</span> },
        { key: "status", header: "Status", cell: (o) => <div className="space-y-0.5"><StatusBadge status={o.status} />{o.outstanding > 0 && <p className="text-[11.5px] text-ink-muted">{dueLabel(o.dueDate)}</p>}</div> },
      ]}
    />
  );
}

type PaymentRow = Payment & { receiptNo: string };

export function PaymentsTable({ payments }: { payments: PaymentRow[] }) {
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const sorted = [...payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  return (
    <>
      <DataTable<PaymentRow>
        caption="Payment history"
        rows={sorted}
        getRowId={(p) => p.id}
        empty={<EmptyState title="No payments yet" description="Payments recorded by the school office appear here with their receipts." />}
        columns={[
          { key: "receipt", header: "Receipt", primary: true, cell: (p) => <div><p className="font-mono text-[13px] font-semibold text-ink">{p.receiptNo}</p><p className="text-[12px] text-ink-muted">{formatDate(p.paidOn)}</p></div> },
          { key: "amount", header: "Amount", align: "right", cell: (p) => <span className="font-semibold text-ink">{formatCurrency(p.amount)}</span> },
          { key: "method", header: "Method", cell: (p) => PAYMENT_METHOD_LABELS[p.method] },
          { key: "ref", header: "Reference", cell: (p) => <span className="font-mono text-[12.5px]">{p.reference}</span> },
        ]}
        rowActions={(p) => <Button variant="ghost" size="sm" onClick={() => setReceiptId(p.receiptId)}><ReceiptIcon className="h-4 w-4" /> Receipt</Button>}
      />
      <ReceiptModal receiptId={receiptId} onClose={() => setReceiptId(null)} />
    </>
  );
}

export function ReceiptModal({ receiptId, onClose }: { receiptId: string | null; onClose: () => void }) {
  const q = useQuery(() => services.fees.getReceipt(receiptId!), [receiptId], { enabled: !!receiptId });
  return (
    <Modal
      open={!!receiptId}
      onOpenChange={(o) => !o && onClose()}
      title="Fee receipt"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </>
      }
    >
      <QueryView query={q} loading="inline">
        {(r) => (
          <>
            <style>{`
              @media print {
                @page {
                  size: auto;
                  margin: 12mm;
                }
                html, body {
                  background: #ffffff !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  height: auto !important;
                  overflow: visible !important;
                }
                body * {
                  visibility: hidden !important;
                }
                #receipt, #receipt * {
                  visibility: visible !important;
                }
                [role="dialog"], [data-radix-portal] {
                  position: static !important;
                  transform: none !important;
                  max-width: 100% !important;
                  max-height: none !important;
                  overflow: visible !important;
                  background: transparent !important;
                  border: none !important;
                  box-shadow: none !important;
                  backdrop-filter: none !important;
                  padding: 0 !important;
                  margin: 0 !important;
                }
                [data-state][class*="backdrop-blur"],
                [role="dialog"] > div:first-child,
                [role="dialog"] > div:last-child {
                  display: none !important;
                }
                #receipt {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  max-width: 680px !important;
                  margin: 0 auto !important;
                  padding: 24px !important;
                  background: #ffffff !important;
                  border: 1px solid #d1d5db !important;
                  border-radius: 12px !important;
                  box-shadow: none !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
              }
            `}</style>
            <div id="receipt" className="rounded-2xl border border-line bg-white p-6 text-sm print:m-0 print:border-line print:p-6 print:shadow-none">
              <div className="flex items-start justify-between gap-4 border-b border-dashed border-line pb-4">
                <div className="flex items-center gap-3">
                  <LogoMark size={40} />
                  <div>
                    <p className="font-display text-base font-semibold text-sapphire">{r.school.name}</p>
                    <p className="text-[12px] text-ink-muted">{r.school.address}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Receipt</p>
                  <p className="font-mono font-semibold text-ink">{r.receipt.receiptNo}</p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 py-4">
                <dt className="text-ink-muted">Student</dt>
                <dd className="text-right font-medium text-ink">{r.student.name}</dd>
                <dt className="text-ink-muted">Admission no.</dt>
                <dd className="text-right font-mono text-ink">{r.student.admissionNo}</dd>
                <dt className="text-ink-muted">Class</dt>
                <dd className="text-right text-ink">{r.student.classLabel}</dd>
                <dt className="text-ink-muted">Paid on</dt>
                <dd className="text-right text-ink">{formatDate(r.payment.paidOn)}</dd>
                <dt className="text-ink-muted">Method</dt>
                <dd className="text-right text-ink">
                  {PAYMENT_METHOD_LABELS[r.payment.method]} · <span className="font-mono">{r.payment.reference}</span>
                </dd>
                <dt className="text-ink-muted">Recorded by</dt>
                <dd className="text-right text-ink">{r.recordedBy}</dd>
              </dl>
              <div className="flex items-center justify-between rounded-xl bg-teal-soft px-4 py-3">
                <span className="font-medium text-lagoon">Amount received</span>
                <span className="text-xl font-semibold text-sapphire">{formatCurrency(r.receipt.amount)}</span>
              </div>
              <p className="mt-3 text-[12px] text-ink-muted">
                Current outstanding balance: <span className="font-semibold text-ink">{formatCurrency(r.balanceNow)}</span> · Issued {formatDateTime(r.receipt.issuedAt)}
              </p>
              <div className="mt-4 hidden items-center justify-between border-t border-line/60 pt-3 text-[11px] text-ink-muted print:flex">
                <span>Official fee receipt · {r.school.name}</span>
                <span>Computer-generated record</span>
              </div>
            </div>
          </>
        )}
      </QueryView>
    </Modal>
  );
}
