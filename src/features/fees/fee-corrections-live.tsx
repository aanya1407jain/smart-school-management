"use client";
/**
 * LIVE fee corrections for one student (fees:manage, incl. the restricted
 * accountant set). Financial history is append-only on the server:
 *  - reversing a payment writes a reversal row (the original stays, its receipt
 *    is marked reversed, the balance is restored);
 *  - revoking a concession marks it revoked (kept for the record);
 *  - cancelling an assignment marks its installments cancelled and is refused
 *    while any payment is allocated to them.
 * Every action needs a reason and is written to the audit log.
 */
import { useState } from "react";
import { Ban, RotateCcw, Undo2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { useSchoolMutation } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { Button, Card, CardHeader, EmptyState, FormField, Input, Modal, useToast } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/dates";

type Ledger = FunctionReturnType<typeof api.fees.studentLedger>;
const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const rupees = (minor: number) => formatCurrency(minor / 100);

type Action =
  | { kind: "reverse"; id: Ledger["payments"][number]["paymentId"]; label: string }
  | { kind: "revoke"; id: Ledger["concessions"][number]["concessionId"]; label: string }
  | { kind: "cancel"; id: Ledger["structures"][number]["structureId"]; label: string };

const COPY = {
  reverse: { title: "Reverse payment", button: "Reverse payment", help: "The payment stays on record with a reversal entry; its receipt is marked reversed and the amount becomes outstanding again." },
  revoke: { title: "Revoke concession", button: "Revoke concession", help: "The concession stops applying from now on; the amount becomes payable again. It stays on record as revoked." },
  cancel: { title: "Cancel fee assignment", button: "Cancel assignment", help: "The student's installments for this structure are cancelled. Not allowed while payments are allocated to them — reverse those first." },
};

export function LiveFeeCorrections({ ledger }: { ledger: Ledger }) {
  const [action, setAction] = useState<Action | null>(null);
  const activeConcessions = ledger.concessions.filter((c) => c.status === "active");
  return (
    <Card data-testid="live-fee-corrections">
      <CardHeader title="Corrections" description="Reverse a payment, revoke a concession or cancel an assignment. History is never deleted; each action needs a reason and is audited." />
      <div className="grid grid-cols-1 gap-5 p-5 pt-2 lg:grid-cols-3">
        <section aria-label="Payments">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Payments</h3>
          {ledger.payments.length === 0 ? <EmptyState title="No payments" className="py-4" /> : (
            <ul className="space-y-2">
              {ledger.payments.map((p) => (
                <li key={p.paymentId} className="flex items-center justify-between gap-2 text-[13px]">
                  <span><span className="font-medium text-ink">{rupees(p.amountMinor)}</span> <span className="text-ink-muted">· {formatDate(p.paidOn)}{p.receiptNo ? ` · ${p.receiptNo}` : ""}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "reverse", id: p.paymentId, label: `${rupees(p.amountMinor)} paid on ${formatDate(p.paidOn)}${p.receiptNo ? ` (receipt ${p.receiptNo})` : ""}` })}><Undo2 className="h-4 w-4" /> Reverse</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Concessions">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Active concessions</h3>
          {activeConcessions.length === 0 ? <EmptyState title="No active concessions" className="py-4" /> : (
            <ul className="space-y-2">
              {activeConcessions.map((c) => (
                <li key={c.concessionId} className="flex items-center justify-between gap-2 text-[13px]">
                  <span><span className="font-medium text-ink">{c.kind === "percent" ? `${c.value / 100}%` : rupees(c.value)}</span> <span className="text-ink-muted">· {c.reason}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "revoke", id: c.concessionId, label: `${c.kind === "percent" ? `${c.value / 100}%` : rupees(c.value)} — ${c.reason}` })}><RotateCcw className="h-4 w-4" /> Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Assigned structures">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Assigned structures</h3>
          {ledger.structures.length === 0 ? <EmptyState title="Nothing assigned" className="py-4" /> : (
            <ul className="space-y-2">
              {ledger.structures.map((s) => (
                <li key={s.structureId} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium text-ink">{s.name} <span className="font-normal text-ink-muted">· {rupees(s.totalMinor)}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "cancel", id: s.structureId, label: s.name })}><Ban className="h-4 w-4" /> Cancel</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {action && <CorrectionModal action={action} studentId={ledger.studentId} onClose={() => setAction(null)} />}
    </Card>
  );
}

function CorrectionModal({ action, studentId, onClose }: { action: Action; studentId: Ledger["studentId"]; onClose: () => void }) {
  const { toast } = useToast();
  const reverse = useSchoolMutation(api.fees.reversePayment);
  const revoke = useSchoolMutation(api.fees.revokeConcession);
  const cancel = useSchoolMutation(api.fees.cancelAssignment);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[action.kind];
  const run = async () => {
    if (!reason.trim()) return setError("A reason is required.");
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "reverse") await reverse({ paymentId: action.id, reason: reason.trim() });
      else if (action.kind === "revoke") await revoke({ concessionId: action.id, reason: reason.trim() });
      else await cancel({ studentId, structureId: action.id, reason: reason.trim() });
      toast({ title: action.kind === "reverse" ? "Payment reversed" : action.kind === "revoke" ? "Concession revoked" : "Assignment cancelled" });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={copy.title} description={action.label} size="sm" footer={<><Button variant="outline" onClick={onClose}>Keep it</Button><Button variant="danger" loading={busy} onClick={run}>{copy.button}</Button></>}>
      <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">{copy.help}</p>
      <FormField label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Cheque bounced" /></FormField>
      {error && <p role="alert" className="mt-2 text-[13px] text-plum">{error}</p>}
    </Modal>
  );
}
