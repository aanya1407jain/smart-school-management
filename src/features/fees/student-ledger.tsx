"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadgePercent, CheckCircle2, Layers, Plus, Wallet } from "lucide-react";
import type { PaymentMethod } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import { Avatar, Button, Card, CardHeader, EmptyState, FormField, GlassCard, Input, Modal, ProgressBar, QueryView, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants/labels";
import { FeeObligationsTable, PaymentsTable, ReceiptModal } from "./fee-tables";

export function StudentLedger({ studentId }: { studentId: string }) {
  const params = useSearchParams();
  const { toast } = useToast();
  const q = useQuery(() => services.fees.getStudentLedger(studentId), [studentId]);
  const [payOpen, setPayOpen] = useState(false);
  const [concOpen, setConcOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const assign = useMutation(services.fees.assignStructure);

  useEffect(() => { if (params.get("pay") === "1" && q.data && q.data.totals.outstanding > 0) setPayOpen(true); }, [params, q.data]);

  return (
    <QueryView query={q}>
      {(l) => {
        const pct = l.totals.net ? (l.totals.paid / l.totals.net) * 100 : 0;
        return (
          <div className="space-y-5">
            <GlassCard className="p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <Avatar name={l.student.name} size="lg" />
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">Fee ledger · 2026–27</p>
                    <h1 className="text-2xl font-semibold text-sapphire">{l.student.name}</h1>
                    <p className="text-sm text-ink-muted"><span className="font-mono">{l.student.admissionNo}</span> · {l.student.classLabel} · <Link href={`/admin/students/${l.student.id}`} className="text-lagoon hover:underline">Profile</Link></p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setConcOpen(true)} disabled={!l.totals.outstanding}><BadgePercent className="h-4 w-4" /> Concession</Button>
                  <Button onClick={() => setPayOpen(true)} disabled={!l.totals.outstanding}><Wallet className="h-4 w-4" /> Record payment</Button>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/70 pt-5 sm:grid-cols-5">
                {[["Total fees", l.totals.gross], ["Concession", l.totals.concession], ["Net payable", l.totals.net], ["Paid", l.totals.paid], ["Outstanding", l.totals.outstanding]].map(([k, v]) => (
                  <div key={k as string}><p className="text-[12px] uppercase tracking-wide text-ink-muted">{k}</p><p className={k === "Outstanding" && l.totals.overdue ? "text-lg font-semibold text-plum" : "text-lg font-semibold text-sapphire"}>{formatCurrency(v as number)}</p></div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <ProgressBar value={pct} label="Fees paid" />
                <span className="shrink-0 text-[13px] font-medium text-ink-soft">{formatPercent(pct)} paid</span>
                <StatusBadge status={l.standing} />
              </div>
            </GlassCard>

            {l.assignments.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Layers className="h-6 w-6" />}
                  title="No fee structure assigned"
                  description="Assign a fee structure to generate this student's installments."
                  action={l.availableStructures.map((s) => (
                    <Button key={s.id} variant="outline" loading={assign.isPending} onClick={async () => { if (await assign.mutate(s.id, [studentId])) toast({ title: "Fee assigned", description: s.name }); }}>
                      <Plus className="h-4 w-4" /> {s.name} · {formatCurrency(s.total)}
                    </Button>
                  ))}
                />
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader title="Installments" description={l.structures.map((s) => s.name).join(", ")} />
                  <div className="p-5"><FeeObligationsTable obligations={l.obligations} /></div>
                </Card>
                {l.concessions.length > 0 && (
                  <Card>
                    <CardHeader title="Concessions" />
                    <ul className="divide-y divide-line/60 px-5 pb-2">
                      {l.concessions.map((c) => <li key={c.id} className="flex justify-between py-3 text-sm"><span className="text-ink-soft">{c.reason} · {formatDate(c.createdAt.slice(0, 10))}</span><span className="font-semibold text-ink">− {formatCurrency(c.amount)}</span></li>)}
                    </ul>
                  </Card>
                )}
                <Card>
                  <CardHeader title="Payments & receipts" />
                  <div className="p-5"><PaymentsTable payments={l.payments} /></div>
                </Card>
              </>
            )}

            <PaymentModal
              open={payOpen}
              onOpenChange={setPayOpen}
              studentId={studentId}
              outstanding={l.totals.outstanding}
              suggested={l.nextDue?.outstanding ?? l.totals.outstanding}
              onPaid={(rid, no, amount) => {
                toast({ title: `Payment recorded — ${formatCurrency(amount)}`, description: `Receipt ${no} generated. Outstanding balance updated.` });
                setReceiptId(rid);
              }}
            />
            <ConcessionModal open={concOpen} onOpenChange={setConcOpen} studentId={studentId} max={l.totals.outstanding} />
            <ReceiptModal receiptId={receiptId} onClose={() => setReceiptId(null)} />
          </div>
        );
      }}
    </QueryView>
  );
}

function PaymentModal({ open, onOpenChange, studentId, outstanding, suggested, onPaid }: { open: boolean; onOpenChange: (o: boolean) => void; studentId: string; outstanding: number; suggested: number; onPaid: (receiptId: string, receiptNo: string, amount: number) => void }) {
  const [amount, setAmount] = useState(suggested);
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [note, setNote] = useState("");
  const m = useMutation(services.fees.recordPayment);
  useEffect(() => { if (open) { setAmount(suggested); m.reset(); } }, [open, suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const r = await m.mutate({ studentId, amount, method, reference, paidOn, note });
    if (r) { onOpenChange(false); onPaid(r.receiptId, r.receiptNo, amount); setReference(""); setNote(""); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Record payment" description={`Outstanding balance: ${formatCurrency(outstanding)}`} size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} onClick={submit}><CheckCircle2 className="h-4 w-4" /> Record & generate receipt</Button></>}>
      <div className="space-y-4">
        <FormField label="Amount (₹)" required error={m.fieldErrors.amount} hint="Payments are applied to the earliest unpaid installment first.">
          <Input type="number" min={1} max={outstanding} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </FormField>
        <div className="flex flex-wrap gap-1.5">
          {[suggested, outstanding].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => <Button key={v} size="sm" variant="soft" onClick={() => setAmount(v)}>{v === outstanding ? "Full balance" : "Next installment"} · {formatCurrency(v)}</Button>)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Method" required><Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
          <FormField label="Date" required error={m.fieldErrors.paidOn}><Input type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} /></FormField>
        </div>
        <FormField label="Reference / transaction ID" required={method !== "cash"} error={m.fieldErrors.reference}><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "cash" ? "Optional" : "e.g. UPI ref 4061 2231"} /></FormField>
        <FormField label="Note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></FormField>
        <FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} />
      </div>
    </Modal>
  );
}

function ConcessionModal({ open, onOpenChange, studentId, max }: { open: boolean; onOpenChange: (o: boolean) => void; studentId: string; max: number }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(1000);
  const [reason, setReason] = useState("");
  const m = useMutation(services.fees.addConcession);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Apply concession" description={`Reduces the outstanding balance (max ${formatCurrency(max)}).`} size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} onClick={async () => { if (await m.mutate(studentId, amount, reason)) { toast({ title: "Concession applied" }); onOpenChange(false); setReason(""); } }}>Apply</Button></>}>
      <div className="space-y-4">
        <FormField label="Amount (₹)" required error={m.fieldErrors.amount}><Input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></FormField>
        <FormField label="Reason" required error={m.fieldErrors.reason}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sibling concession" /></FormField>
      </div>
    </Modal>
  );
}

