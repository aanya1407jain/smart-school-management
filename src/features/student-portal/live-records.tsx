"use client";
/**
 * Presentational pieces of the LIVE student portal that belong to Students: notices addressed to the student and the student's certificates. Module records (results, fees, homework, timetable) live with their modules.
 */
import { Download, FileText, Megaphone } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

type Ok<T> = Extract<T, { state: "ok" }>;
export type LiveNotice = Ok<FunctionReturnType<typeof api.studentPortal.myNotices>>["notices"][number];
export type LiveCertificate = Ok<FunctionReturnType<typeof api.studentPortal.myCertificates>>["certificates"][number];

// ------------------------------------------------------------------ notices
export function LiveNoticesList({ notices }: { notices: LiveNotice[] }) {
  if (notices.length === 0) return <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No notices" description="Notices from your school appear here." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line/60" data-testid="live-notices">
        {notices.map((n) => (
          <li key={n.noticeId} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink">{n.title}</p>
              {n.priority !== "normal" && <Badge tone="plum">{n.priority === "urgent" ? "Urgent" : "Important"}</Badge>}
              {n.type !== "notice" && <Badge tone="lavender">{n.type === "event" ? "Event" : "Holiday"}</Badge>}
            </div>
            <p className="mt-1 whitespace-pre-line text-[13px] text-ink-soft">{n.body}</p>
            <p className="mt-1 text-[11.5px] text-ink-muted">Published {formatDate(n.publishDate)}{n.eventDate ? ` · on ${formatDate(n.eventDate)}` : ""}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ certificates
export function LiveCertificatesList({ certificates }: { certificates: LiveCertificate[] }) {
  if (certificates.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No certificates or official documents"
          description="Official certificates and documents issued by the school will appear here."
        />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-line/60" data-testid="live-certificates">
        {certificates.map((c) => (
          <li key={c.fileId} className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-soft text-lagoon">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{c.fileName}</p>
                <p className="text-[12px] text-ink-muted">
                  {c.kind.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} · {Math.round(c.size / 1024)} KB · Uploaded {formatDate(new Date(c.uploadedAt).toISOString().slice(0, 10))}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="teal">Issued by the school</Badge>
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={c.fileName}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink shadow-sm hover:border-teal hover:text-teal transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
