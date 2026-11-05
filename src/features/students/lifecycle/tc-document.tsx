"use client";
/**
 * The official transfer certificate as printed (and saved as PDF through the
 * browser's print dialog). Issued certificates carry their verification code
 * and a QR code pointing at the public /verify/tc/<code> page.
 */
import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export type TcDocumentData = {
  school: { name: string; address: string | null };
  tcNo: string;
  status: "draft" | "issued" | "cancelled" | "preview";
  snapshot: {
    studentName: string;
    admissionNo: string;
    scholarNo?: string;
    dateOfBirth?: string;
    admissionDate?: string;
    lastClass?: string;
    lastSection?: string;
    academicYear?: string;
    parentName?: string;
    fatherName?: string;
    motherName?: string;
    workingDays?: number;
    attendedDays?: number;
  };
  leavingDate: string;
  applicationDate: string | null;
  issueDate: string | null;
  reason: string;
  conduct: string | null;
  destinationSchool: string | null;
  remarks: string | null;
  verificationCode: string | null;
  cancelReason?: string | null;
  issuedBy?: string;
};

/** Quiet zone around the symbol, in modules (the QR spec asks for 4; 2 is plenty on a white card). */
const QR_QUIET_ZONE = 2;

/**
 * The QR matrix of `text` as one SVG path ("M x,y h1 v1 h-1 z" per dark
 * module), generated entirely in the browser with `qrcode-generator`.
 * SEC-04: nothing is sent to a third party — the verification URL (and its
 * code) never leaves the page, and no outside service decides what the
 * printed QR points to.
 */
export function qrSvgPath(text: string): { modules: number; d: string } {
  const qr = qrcode(0, "M"); // type 0 = smallest version that fits; M = ~15% error correction
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) if (qr.isDark(row, col)) d += `M${col},${row}h1v1h-1z`;
  }
  return { modules, d };
}

/** Verification QR code, rendered as inline SVG (no network request, no injected HTML). */
export function QrCode({ text, size = 112, className }: { text: string; size?: number; className?: string }) {
  const { modules, d } = useMemo(() => qrSvgPath(text), [text]);
  const extent = modules + QR_QUIET_ZONE * 2;

  return (
    <div
      className={cn("overflow-hidden rounded-lg bg-white flex items-center justify-center border border-line/40", className)}
      style={{ width: size, height: size }}
    >
      <svg
        role="img"
        aria-label="Verification QR code"
        viewBox={`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${extent} ${extent}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className="h-full w-full"
      >
        <rect x={-QR_QUIET_ZONE} y={-QR_QUIET_ZONE} width={extent} height={extent} fill="#ffffff" />
        <path d={d} fill="#000000" />
      </svg>
    </div>
  );
}

export function verificationUrl(code: string) {
  return typeof window === "undefined" ? `/verify/tc/${code}` : `${window.location.origin}/verify/tc/${code}`;
}

export function TcDocument({ data, id = "tc-print" }: { data: TcDocumentData; id?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(data.verificationCode ? verificationUrl(data.verificationCode) : null);
  }, [data.verificationCode]);

  const s = data.snapshot;
  const rows: [string, string][] = [
    ["Name of student", s.studentName],
    ["Father's name", s.fatherName ?? "—"],
    ["Mother's name", s.motherName ?? (s.fatherName ? "—" : s.parentName ?? "—")],
    ["Admission no.", s.admissionNo],
    ["Scholar no.", s.scholarNo ?? "—"],
    ["Date of birth", s.dateOfBirth ? formatDate(s.dateOfBirth) : "—"],
    ["Date of admission", s.admissionDate ? formatDate(s.admissionDate) : "—"],
    ["Class last studied", [s.lastClass, s.lastSection && `(${s.lastSection})`, s.academicYear].filter(Boolean).join(" ") || "—"],
    ["Working days / days attended", s.workingDays !== undefined ? `${s.workingDays} / ${s.attendedDays ?? 0}` : "—"],
    ["Date of application", data.applicationDate ? formatDate(data.applicationDate) : "—"],
    ["Date of leaving", formatDate(data.leavingDate)],
    ["Reason for leaving", data.reason || "—"],
    ["Conduct & character", data.conduct ?? "—"],
    ["School joining", data.destinationSchool ?? "—"],
    ["Remarks", data.remarks ?? "—"],
    ["Date of issue", data.issueDate ? formatDate(data.issueDate) : "On issue"],
  ];
  const watermark = data.status === "cancelled" ? "CANCELLED" : data.status === "issued" ? null : "DRAFT";

  return (
    <div id={id} className="relative overflow-hidden rounded-2xl border border-line bg-white p-7 text-ink shadow-sm print:border-0 print:shadow-none">
      <style>{`@media print { body * { visibility: hidden !important; } #${id}, #${id} * { visibility: visible !important; } #${id} { position: fixed; inset: 0; padding: 32px; } }`}</style>
      {watermark && <span aria-hidden className="pointer-events-none absolute inset-0 grid -rotate-12 place-items-center font-display text-7xl font-bold tracking-widest text-plum/10">{watermark}</span>}
      <div className="relative flex items-start justify-between gap-4 border-b border-dashed border-line pb-4">
        <div>
          <p className="font-display text-xl font-semibold text-sapphire">{data.school.name}</p>
          {data.school.address && <p className="text-[12.5px] text-ink-muted">{data.school.address}</p>}
          <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-ink-soft">Transfer certificate</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Certificate no.</p>
          <p className="font-mono text-sm font-semibold">{data.tcNo || "Assigned on issue"}</p>
        </div>
      </div>
      {data.status === "cancelled" && <p className="relative mt-3 rounded-lg bg-blush/40 px-3 py-2 text-sm font-semibold text-plum">Cancelled{data.cancelReason ? ` — ${data.cancelReason}` : ""}. This certificate is not valid.</p>}
      <table className="relative mt-3 w-full text-sm">
        <tbody className="divide-y divide-line/60">
          {rows.map(([k, v]) => <tr key={k}><td className="w-56 py-1.5 pr-3 align-top text-ink-muted">{k}</td><td className="py-1.5 font-medium">{v}</td></tr>)}
        </tbody>
      </table>
      <div className="relative mt-8 flex items-end justify-between gap-4">
        {data.verificationCode && url ? (
          <div className="flex items-end gap-3">
            <QrCode text={url} size={96} />
            <div className="text-[11px] text-ink-muted">
              <p className="font-semibold uppercase tracking-wider">Verify this certificate</p>
              <p className="font-mono text-[12px] text-ink">{data.verificationCode}</p>
              <p className="max-w-[16rem] break-all">{url}</p>
            </div>
          </div>
        ) : <span className="text-[12px] text-ink-muted">{data.status === "issued" ? "" : "The verification code is added when the certificate is issued."}</span>}
        <div className="text-right text-[13px] text-ink-muted">
          {data.issuedBy && <p>Prepared by: {data.issuedBy}</p>}
          <p className="mt-8">Principal&apos;s signature &amp; seal</p>
        </div>
      </div>
    </div>
  );
}