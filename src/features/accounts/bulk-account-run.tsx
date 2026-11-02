"use client";
/**
 * One bulk account-creation run (convex/bulkAccounts.ts): prepare → confirm →
 * process in server-sized batches → report. Temporary passwords arrive once
 * per batch, are kept only in this page's memory and can be downloaded as CSV.
 * Everything that matters (scope, counts, idempotency, authorization) lives on
 * the server; closing the page loses nothing but undownloaded passwords, which
 * can be re-issued for exactly those accounts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, KeyRound, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge, Button, Modal, ProgressBar, useToast } from "@/components/ui";
import { useSchoolAction, useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { downloadCsv } from "@/features/imports/spreadsheet";

type JobId = Id<"bulkAccountJobs">;
export type BulkCredential = { loginId: string; displayName: string; admissionNo: string; section: string; temporaryPassword: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BulkAccountRun({ jobId, onClose, autoPrepare }: { jobId: JobId; onClose: () => void; autoPrepare: boolean }) {
  const { toast } = useToast();
  const job = useSchoolQuery(api.bulkAccounts.getJob, { jobId });
  const skippedItems = useSchoolQuery(api.bulkAccounts.jobItems, job && (job.status === "ready" || job.status === "completed" || job.status === "cancelled") ? { jobId, status: "skipped" } : "skip");
  const failedItems = useSchoolQuery(api.bulkAccounts.jobItems, job && job.failed > 0 ? { jobId, status: "failed" } : "skip");
  const undeliveredItems = useSchoolQuery(api.bulkAccounts.jobItems, job && job.undelivered > 0 && job.status !== "running" ? { jobId, status: "created", undeliveredOnly: true } : "skip");

  const prepare = useSchoolMutation(api.bulkAccounts.prepareJob);
  const start = useSchoolMutation(api.bulkAccounts.startJob);
  const cancel = useSchoolMutation(api.bulkAccounts.cancelJob);
  const retry = useSchoolMutation(api.bulkAccounts.retryFailed);
  const acknowledge = useSchoolMutation(api.bulkAccounts.acknowledge);
  const processBatch = useSchoolAction(api.bulkAccounts.processBatch);
  const reissue = useSchoolAction(api.accounts.issuePendingCredentials);

  const [credentials, setCredentials] = useState<BulkCredential[]>([]);
  const [downloaded, setDownloaded] = useState(false);
  const [working, setWorking] = useState<null | "preparing" | "processing" | "reissuing">(null);
  const [pausedError, setPausedError] = useState<string | null>(null);
  const stop = useRef(false);
  const preparing = useRef(false);

  // Snapshot an "all matching" scope page by page (bounded server calls).
  const runPrepare = useCallback(async () => {
    if (preparing.current) return;
    preparing.current = true;
    setWorking("preparing");
    try {
      for (;;) { const r = await prepare({ jobId }); if (r.done) break; }
    } catch (e) {
      toast({ tone: "error", title: "Could not prepare the selection", description: errorMessage(e) });
    } finally {
      preparing.current = false;
      setWorking(null);
    }
  }, [jobId, prepare, toast]);

  useEffect(() => { if (autoPrepare && job?.status === "preparing") void runPrepare(); }, [autoPrepare, job?.status, runPrepare]);

  const keep = useCallback(async (batch: (BulkCredential & { itemId: Id<"bulkAccountJobItems"> })[]) => {
    if (!batch.length) return;
    setCredentials((c) => [...c, ...batch.map(({ itemId: _i, ...rest }) => rest)]);
    setDownloaded(false);
    for (let i = 0; i < batch.length; i += 200) {
      await acknowledge({ jobId, itemIds: batch.slice(i, i + 200).map((b) => b.itemId) });
    }
  }, [acknowledge, jobId]);

  // Process batches until the server says the run is finished. Network errors are retried with back-off.
  const runProcess = useCallback(async () => {
    stop.current = false;
    setPausedError(null);
    setWorking("processing");
    let failures = 0;
    try {
      while (!stop.current) {
        let res;
        try {
          res = await processBatch({ jobId });
          failures = 0;
        } catch (e) {
          failures++;
          if (failures >= 3) { setPausedError(errorMessage(e, "The connection was interrupted.")); return; }
          await sleep(1500 * failures);
          continue;
        }
        await keep(res.credentials);
        if (res.done) break;
        if (res.credentials.length === 0) await sleep(1500); // other claims still finishing
      }
    } finally {
      setWorking(null);
    }
  }, [jobId, keep, processBatch]);

  const confirmStart = async () => {
    try {
      await start({ jobId });
      await runProcess();
    } catch (e) {
      toast({ tone: "error", title: "Could not start", description: errorMessage(e) });
    }
  };

  const retryFailures = async () => {
    try {
      for (;;) { const r = await retry({ jobId }); if (!r.more) break; }
      await runProcess();
    } catch (e) {
      toast({ tone: "error", title: "Could not retry", description: errorMessage(e) });
    }
  };

  // Accounts created by this run whose passwords never reached this browser: issue NEW temporary passwords.
  const reissueUndelivered = async () => {
    const items = (undeliveredItems ?? []).filter((i) => i.membershipId);
    if (!items.length) return;
    setWorking("reissuing");
    try {
      for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const res = await reissue({ targetMembershipIds: chunk.map((c) => c.membershipId as Id<"schoolMemberships">) });
        const got: (BulkCredential & { itemId: Id<"bulkAccountJobItems"> })[] = [];
        res.forEach((r, j) => {
          if (r.ok) got.push({ itemId: chunk[j].itemId as Id<"bulkAccountJobItems">, loginId: r.loginId, displayName: r.displayName, admissionNo: chunk[j].admissionNo, section: "", temporaryPassword: r.temporaryPassword });
        });
        await keep(got);
      }
    } catch (e) {
      toast({ tone: "error", title: "Could not issue new passwords", description: errorMessage(e) });
    } finally {
      setWorking(null);
    }
  };

  // Warn before leaving with passwords that were not downloaded.
  useEffect(() => {
    if (!credentials.length || downloaded) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [credentials.length, downloaded]);

  const download = () => {
    downloadCsv(`student-accounts-${new Date().toISOString().slice(0, 10)}`, [
      ["Student name", "Scholar No.", "Class", "Login ID", "Default password", "Note"],
      // `admissionNo` carries the scholar number (convex/bulkAccounts.ts); the Login ID is the same number.
      ...credentials.map((c) => [c.displayName, c.admissionNo, c.section, c.loginId, c.temporaryPassword, "Must be changed at first sign-in"]),
    ]);
    setDownloaded(true);
  };

  const close = async () => {
    if (credentials.length && !downloaded && !window.confirm("You have not downloaded the new passwords. They cannot be shown again (you would need to reset them). Close anyway?")) return;
    stop.current = true;
    if (job && (job.status === "ready" || job.status === "preparing")) {
      try { await cancel({ jobId }); } catch { /* already finished */ }
    }
    onClose();
  };

  if (!job) {
    return <Modal open onOpenChange={() => onClose()} title="Create student accounts"><p className="text-sm text-ink-muted">Loading…</p></Modal>;
  }

  const processed = job.created + job.skipped + job.failed;
  const pct = job.total ? Math.round((processed / job.total) * 100) : 0;
  const skippedByReason = new Map<string, number>();
  for (const s of skippedItems ?? []) skippedByReason.set(s.reason ?? "Skipped", (skippedByReason.get(s.reason ?? "Skipped") ?? 0) + 1);
  const busy = working !== null;

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) void close(); }}
      title="Create student accounts"
      description={job.scope.type === "all" ? "All matching students without an account" : "Selected students"}
      size="lg"
      footer={
        <>
          {credentials.length > 0 && <Button variant="outline" onClick={download}><Download className="h-4 w-4" /> Download {credentials.length} credential{credentials.length === 1 ? "" : "s"} (CSV)</Button>}
          {job.status === "ready" && <Button onClick={confirmStart} loading={busy} disabled={job.queued === 0}>Create {job.queued} account{job.queued === 1 ? "" : "s"}</Button>}
          {job.status === "running" && !busy && <Button onClick={runProcess}><RotateCcw className="h-4 w-4" /> Resume</Button>}
          {job.status === "running" && busy && <Button variant="outline" onClick={() => { stop.current = true; }}>Pause</Button>}
          <Button variant={job.status === "ready" ? "outline" : "primary"} onClick={() => void close()} disabled={busy && working !== "preparing"}>
            {job.status === "ready" || job.status === "preparing" ? "Cancel" : "Close"}
          </Button>
        </>
      }
    >
      {job.status === "preparing" && (
        <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Collecting the matching students… {job.total} found so far.
        </p>
      )}

      {job.status === "ready" && (
        <div className="space-y-4 text-sm" data-testid="bulk-confirm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Selected" value={job.total} />
            <Stat label="Will get an account" value={job.queued} tone="teal" />
            <Stat label="Skipped" value={job.skipped} />
            <Stat label="Batches" value={job.batches} hint={`${job.batchSize} per batch`} />
          </dl>
          {skippedByReason.size > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-soft">
              {[...skippedByReason].map(([reason, n]) => <li key={reason}>{n} skipped: {reason}</li>)}
            </ul>
          )}
          <p className="flex items-start gap-2.5 rounded-xl border border-lagoon/25 bg-teal-soft px-4 py-3 text-[13px] text-lagoon">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Each student signs in with their scholar number as the Login ID and the school&apos;s default password. Students must change it at first sign-in.
              Passwords are shown only during this run — download the CSV before closing.
            </span>
          </p>
        </div>
      )}

      {(job.status === "running" || job.status === "completed" || job.status === "cancelled") && (
        <div className="space-y-4 text-sm" data-testid="bulk-progress">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={job.status === "completed" ? "teal" : job.status === "cancelled" ? "neutral" : "lavender"} dot>
              {job.status === "completed" ? "Completed" : job.status === "cancelled" ? "Cancelled" : busy ? "Processing" : "Paused"}
            </Badge>
            <span className="text-ink-soft" data-testid="bulk-processed">{processed} of {job.total} processed</span>
          </div>
          <ProgressBar value={pct} label={`${pct}% processed`} />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={job.created} tone="teal" />
            <Stat label="Skipped" value={job.skipped} />
            <Stat label="Failed" value={job.failed} tone={job.failed ? "plum" : undefined} />
            <Stat label="Remaining" value={job.queued + job.processing} />
          </dl>
          {pausedError && <p role="alert" className="rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum">Paused: {pausedError} Nothing is lost — press Resume.</p>}
          {job.status === "completed" && (
            <p className="flex items-center gap-2 text-[13px] text-lagoon" role="status" data-testid="bulk-summary">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {job.created} account{job.created === 1 ? "" : "s"} created · {job.skipped} skipped · {job.failed} failed
            </p>
          )}
          {job.failed > 0 && !busy && (
            <div className="rounded-xl border border-plum/20 bg-white px-4 py-3 text-[13px]" role="alert">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-plum"><AlertTriangle className="h-4 w-4" aria-hidden /> {job.failed} failed</p>
              <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-ink-soft">
                {(failedItems ?? []).map((f) => <li key={f.itemId}>{f.name} ({f.admissionNo}): {f.reason}</li>)}
              </ul>
              {job.status !== "cancelled" && <Button size="sm" variant="outline" className="mt-2" onClick={retryFailures}><RotateCcw className="h-4 w-4" /> Retry failed</Button>}
            </div>
          )}
          {job.undelivered > 0 && !busy && job.status !== "running" && (
            <div className="rounded-xl border border-mauve/30 bg-blush/30 px-4 py-3 text-[13px] text-ink-soft" role="alert">
              {job.undelivered} account{job.undelivered === 1 ? " was" : "s were"} created but {job.undelivered === 1 ? "its password" : "their passwords"} never reached this page
              (for example, the connection dropped). Passwords are never stored, so issue new temporary passwords for exactly these accounts.
              <div className="mt-2"><Button size="sm" variant="outline" onClick={reissueUndelivered} loading={working === "reissuing"}><KeyRound className="h-4 w-4" /> Issue new passwords</Button></div>
            </div>
          )}
          {credentials.length > 0 && (
            <p className="flex items-start gap-2.5 rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum" role="note">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {credentials.length} temporary password{credentials.length === 1 ? "" : "s"} ready. Download the CSV and hand them out privately; do not leave the file on a shared computer.
                They are not stored and cannot be shown again.
              </span>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "teal" | "plum" }) {
  return (
    <div className="rounded-xl border border-line/80 bg-white px-3 py-2">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={tone === "teal" ? "text-lg font-semibold text-lagoon" : tone === "plum" ? "text-lg font-semibold text-plum" : "text-lg font-semibold text-ink"}>{value.toLocaleString()}</dd>
      {hint && <dd className="text-[11.5px] text-ink-muted">{hint}</dd>}
    </div>
  );
}
