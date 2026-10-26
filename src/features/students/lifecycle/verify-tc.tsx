"use client";
/** Public verification result for a transfer certificate code (convex/tcVerification.ts). */
import { useQuery } from "convex/react";
import { BadgeCheck, ShieldX } from "lucide-react";
import { api } from "@convex/_generated/api";
import { LogoMark } from "@/components/brand/logo";
import { Badge, BadgeChip, GlassCard, LoadingState } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

export function VerifyTc({ code }: { code: string }) {
  const r = useQuery(api.tcVerification.verifyTransferCertificate, { code });
  return (
    <main className="ambient grid min-h-screen place-items-center px-4 py-10">
      <GlassCard className="spatial w-full max-w-lg p-6">
        <div className="mb-5 flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-muted">Certificate verification</p>
            <p className="mono-id text-ink-soft">{code}</p>
          </div>
        </div>
        {r === undefined ? <LoadingState variant="inline" label="Checking" /> : r === null ? (
          <div className="flex items-start gap-3 rounded-2xl bg-blush/40 p-4 text-plum">
            <ShieldX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p className="text-sm"><strong>No certificate matches this code.</strong> Check the code printed under the QR, or contact the issuing school.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={r.valid ? "flex items-start gap-3 rounded-2xl bg-teal-soft/70 p-4 text-lagoon" : "flex items-start gap-3 rounded-2xl bg-blush/40 p-4 text-plum"}>
              {r.valid ? <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : <ShieldX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
              <p className="text-sm"><strong>{r.valid ? "Valid transfer certificate" : "This certificate has been cancelled"}</strong>{r.valid ? ` issued by ${r.school}.` : ` by ${r.school}${r.cancelledAt ? ` on ${formatDate(new Date(r.cancelledAt).toLocaleDateString("en-CA"))}` : ""} and is not valid.`}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Certificate no.</dt><dd className="mt-0.5"><BadgeChip>{r.tcNo}</BadgeChip></dd></div>
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Status</dt><dd className="mt-0.5"><Badge tone={r.valid ? "teal" : "plum"} dot>{r.valid ? "Issued" : "Cancelled"}</Badge></dd></div>
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Student</dt><dd className="mt-0.5 font-semibold text-ink">{r.studentName}</dd></div>
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Admission no.</dt><dd className="mono-id mt-0.5 text-ink">{r.admissionNo}</dd></div>
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Class left</dt><dd className="mt-0.5 text-ink">{r.lastClass ?? "—"}</dd></div>
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Date of leaving</dt><dd className="figures mt-0.5 text-ink">{formatDate(r.leavingDate)}</dd></div>
              <div><dt className="text-[11.5px] uppercase tracking-wide text-ink-muted">Issued on</dt><dd className="figures mt-0.5 text-ink">{formatDate(r.issueDate)}</dd></div>
            </dl>
          </div>
        )}
      </GlassCard>
    </main>
  );
}
