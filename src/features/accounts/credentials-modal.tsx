"use client";
/**
 * Shows freshly issued Login IDs + temporary passwords exactly once. Nothing
 * is stored client-side; closing the dialog discards the passwords (a new
 * temporary password can always be issued again).
 */
import { useState } from "react";
import { Check, Copy, Download, ShieldAlert } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { downloadCsv } from "@/features/imports/spreadsheet";

export type IssuedCredential = { loginId: string; displayName: string; temporaryPassword: string };
export type FailedCredential = { displayName: string; error: string };

export function CredentialsModal({
  open, onClose, credentials, failures = [], title = "Account credentials",
}: { open: boolean; onClose: () => void; credentials: IssuedCredential[]; failures?: FailedCredential[]; title?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard unavailable: the values remain visible */
    }
  };
  const download = () =>
    downloadCsv(`credentials-${new Date().toISOString().slice(0, 10)}`, [
      ["Name", "Login ID", "Temporary password"],
      ...credentials.map((c) => [c.displayName, c.loginId, c.temporaryPassword]),
    ]);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
      description="Share these privately with each person. They must choose a new password after signing in."
      size="lg"
      footer={
        <>
          {credentials.length > 0 && <Button variant="outline" onClick={download}><Download className="h-4 w-4" /> Download CSV</Button>}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div role="note" className="mb-4 flex items-start gap-2.5 rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Temporary passwords are shown only now and are not stored anywhere readable. If one is lost, reset the password to issue a new one.</span>
      </div>
      {credentials.length > 0 && (
        <ul className="divide-y divide-line/70 rounded-xl border border-line/80 bg-white/70" aria-label="Issued credentials">
          {credentials.map((c) => (
            <li key={c.loginId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{c.displayName}</p>
                <p className="text-[13px] text-ink-muted">
                  Login ID <span className="font-mono font-semibold text-ink" data-testid="issued-login-id">{c.loginId}</span>
                  <span className="mx-2 text-line">|</span>
                  Password <span className="font-mono font-semibold text-ink" data-testid="issued-password">{c.temporaryPassword}</span>
                </p>
              </div>
              <Button
                variant="ghost" size="sm"
                aria-label={`Copy credentials for ${c.displayName}`}
                onClick={() => copy(c.loginId, `Login ID: ${c.loginId}\nTemporary password: ${c.temporaryPassword}`)}
              >
                {copied === c.loginId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === c.loginId ? "Copied" : "Copy"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failures.length > 0 && (
        <div className="mt-4 rounded-xl border border-plum/20 bg-white/70 px-4 py-3 text-[13px]" role="alert">
          <p className="mb-1 font-medium text-plum">{failures.length} account(s) could not be issued credentials</p>
          <ul className="list-disc space-y-0.5 pl-5 text-ink-soft">
            {failures.map((f, i) => <li key={i}>{f.displayName}: {f.error}</li>)}
          </ul>
          <p className="mt-1 text-ink-muted">They stay pending; use “Issue password” on the Students or Teachers tab to retry.</p>
        </div>
      )}
    </Modal>
  );
}
