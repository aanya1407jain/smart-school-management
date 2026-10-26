"use client";
/**
 * Files attached to a record (homework, submission, student document …), read
 * through convex/files.ts. Listing and every download re-check read access on
 * the server; download links are short-lived storage URLs fetched on click.
 */
import { useRef, useState } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { useSchoolMutation, useSchoolQuery, useSchoolQueryRunner } from "@/lib/convex/membership";
import { checkUploadFile, useFileUpload } from "@/lib/convex/use-file-upload";
import { errorMessage } from "@/lib/convex/errors";
import { Button, ConfirmDialog, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";

type OwnerType = FunctionArgs<typeof api.files.listForOwner>["ownerType"];
type Kind = FunctionArgs<typeof api.files.register>["kind"];

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Open a file in a new tab (the URL is fetched on demand, after the server re-checks access). */
export function useOpenFile() {
  const getUrl = useSchoolQueryRunner(api.files.getUrl);
  const { toast } = useToast();
  return async (fileId: Id<"files">) => {
    try {
      const f = await getUrl({ fileId });
      if (f.url) window.open(f.url, "_blank", "noopener,noreferrer");
      else toast({ title: "File is not available", tone: "error" });
    } catch (e) {
      toast({ title: "Could not open the file", description: errorMessage(e), tone: "error" });
    }
  };
}

export function AttachmentList({
  ownerType, ownerId, canRemove = false, emptyText, compact = false,
}: { ownerType: OwnerType; ownerId: string; canRemove?: boolean; emptyText?: string; compact?: boolean }) {
  const files = useSchoolQuery(api.files.listForOwner, { ownerType, ownerId });
  const remove = useSchoolMutation(api.files.remove);
  const open = useOpenFile();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<{ id: Id<"files">; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (files === undefined) return compact ? null : <p className="text-[12.5px] text-ink-muted">Loading files…</p>;
  if (files.length === 0) return emptyText ? <p className="text-[12.5px] text-ink-muted">{emptyText}</p> : null;
  return (
    <>
      <ul className="space-y-1.5" aria-label="Attachments">
        {files.map((f) => (
          <li key={f._id} className="flex items-center gap-2 text-[13px]">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
            <button type="button" onClick={() => open(f._id)} className="min-w-0 truncate font-medium text-lagoon hover:underline">{f.fileName}</button>
            {!compact && <span className="shrink-0 text-[11.5px] text-ink-muted">{kb(f.size)} · {formatDate(new Date(f.uploadedAt).toISOString())}</span>}
            <Button variant="ghost" size="icon-sm" aria-label={`Open ${f.fileName}`} onClick={() => open(f._id)}><Download className="h-3.5 w-3.5" /></Button>
            {canRemove && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.fileName}`} onClick={() => setConfirm({ id: f._id, name: f.fileName })}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Delete file?"
          description={`"${confirm.name}" will be removed permanently. This is recorded in the audit log.`}
          confirmLabel="Delete"
          tone="danger"
          loading={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await remove({ fileId: confirm.id }); toast({ title: "File deleted" }); setConfirm(null); }
            catch (e) { toast({ title: "Could not delete the file", description: errorMessage(e), tone: "error" }); }
            finally { setBusy(false); }
          }}
        />
      )}
    </>
  );
}

/** A button that uploads one file to a record (server checks type, size, ownership and limits). */
export function UploadButton({ ownerType, ownerId, kind, label = "Attach file", onUploaded }: { ownerType: OwnerType; ownerId: string; kind: Kind; label?: string; onUploaded?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { upload, status } = useFileUpload();
  const { toast } = useToast();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const problem = checkUploadFile(file);
          if (problem) return toast({ title: "File not accepted", description: problem, tone: "error" });
          try { await upload(file, { kind, ownerType, ownerId }); toast({ title: "File uploaded", description: file.name }); onUploaded?.(); }
          catch (err) { toast({ title: "Upload failed", description: err instanceof Error ? errorMessage(err, err.message) : "The upload failed.", tone: "error" }); }
        }}
      />
      <Button type="button" size="sm" variant="outline" loading={status === "uploading"} onClick={() => input.current?.click()}>
        <Upload className="h-4 w-4" /> {label}
      </Button>
    </>
  );
}
