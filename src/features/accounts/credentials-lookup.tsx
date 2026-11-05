"use client";
/**
 * Admin → Credentials. Find any sign-in account by name, scholar number,
 * employee ID or Login ID; see who it belongs to and its Login ID; reset its
 * password (confirmed with a one-time code emailed to the acting
 * administrator). Passwords are stored only as hashes, so none can be shown —
 * a new one is shown once, when it is set. The server authorises every call
 * (admin role + users:manage, convex/credentials.ts).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, History, KeyRound, Lock, ShieldCheck, UserRoundSearch } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CredentialAccount } from "@convex/credentials";
import { Badge, Button, Card, DataTable, EmptyState, LoadingState, Modal, PageHeader, SearchInput, type Column } from "@/components/ui";
import { isConvexConfigured } from "@/lib/convex/config";
import { useSchoolQuery } from "@/lib/convex/membership";
import { PasswordResetDialog, type ResetTarget } from "./password-reset-dialog";

const ROLE_LABEL: Record<CredentialAccount["role"], string> = { admin: "Administrator", teacher: "Teacher", student: "Student" };
const STATE_BADGE: Record<CredentialAccount["state"], { label: string; tone: "teal" | "lavender" | "plum" }> = {
  active: { label: "Active", tone: "teal" },
  pending: { label: "No password yet", tone: "lavender" },
  suspended: { label: "Disabled", tone: "plum" },
};
const EVENT_LABEL: Record<string, string> = {
  "account.created": "Account created",
  "account.credentials_issued": "Password issued",
  PASSWORD_OVERWRITE: "Password reset by administrator",
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" aria-label={label}
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
      }}
      className="grid h-7 w-7 place-items-center rounded-lg text-ink-muted hover:bg-teal-soft/60 hover:text-lagoon"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </button>
  );
}

/** Passwords are hashed: never shown, only described. */
function PasswordCell({ a }: { a: CredentialAccount }) {
  if (a.state === "pending") return <span className="text-[13px] text-ink-muted">Not issued</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted" title="Stored as a secure hash — it cannot be viewed. Reset it to issue a new one.">
      <Lock className="h-3.5 w-3.5" aria-hidden />
      <span className="font-mono tracking-widest" aria-label="Hidden">••••••••</span>
      {a.defaultPassword && <span title="Still on the former shared default password (no longer issued); the student must change it at next sign-in. Reset the password to replace it now."><Badge tone="lavender">Old default — reissue</Badge></span>}
    </span>
  );
}

const placement = (a: CredentialAccount) => a.role === "student" ? (a.classSection ? `Class ${a.classSection}` : "—") : (a.department ?? "—");

export function CredentialsLookup() {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const [open, setOpen] = useState<Id<"schoolMemberships"> | null>(null);
  const [resetting, setResetting] = useState<ResetTarget | null>(null);
  const result = useSchoolQuery(api.credentials.search, isConvexConfigured && debounced.length >= 2 ? { query: debounced } : "skip");

  const header = (
    <PageHeader
      title="Credentials"
      description="Look up anyone's sign-in account and reset passwords. Every reset is confirmed with a one-time code sent to your email and recorded in the audit log."
    />
  );
  if (!isConvexConfigured) {
    return <div>{header}<Card><EmptyState title="Backend not connected" description="Credentials need the Convex backend (NEXT_PUBLIC_CONVEX_URL)." /></Card></div>;
  }

  const columns: Column<CredentialAccount>[] = [
    {
      key: "name", header: "Name", primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{a.name}{a.isSelf && <span className="ml-1.5 text-[12px] font-normal text-ink-muted">(you)</span>}</p>
          <p className="text-[12.5px] text-ink-muted">{ROLE_LABEL[a.role]}{a.employeeId ? ` · ${a.employeeId}` : ""}</p>
        </div>
      ),
    },
    { key: "placement", header: "Class / department", cell: (a) => <span className="text-[13px] text-ink-soft">{placement(a)}</span> },
    {
      key: "login", header: "Login ID",
      cell: (a) => a.loginId ? <span className="inline-flex items-center gap-1"><span className="font-mono text-[13px] font-semibold text-ink">{a.loginId}</span><CopyButton text={a.loginId} label={`Copy Login ID ${a.loginId}`} /></span> : <span className="text-ink-muted">—</span>,
    },
    { key: "password", header: "Password", cell: (a) => <PasswordCell a={a} /> },
    { key: "state", header: "Status", cell: (a) => <Badge dot tone={STATE_BADGE[a.state].tone}>{STATE_BADGE[a.state].label}</Badge> },
  ];

  return (
    <div className="space-y-5" data-testid="credentials-lookup">
      {header}
      <div role="note" className="flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[13px] text-ink-soft">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lagoon" aria-hidden />
        <span>Passwords are stored as secure hashes, so nobody — including administrators — can view them. To give someone access again, reset their password: the new one is shown to you once, to hand over privately.</span>
      </div>
      <Card className="p-4">
        <SearchInput value={query} onChange={setQuery} label="Search accounts" placeholder="Search by name, scholar number, employee ID or Login ID" />
      </Card>
      {debounced.length < 2 ? (
        <Card><EmptyState icon={<UserRoundSearch className="h-6 w-6" />} title="Search for an account" description="Type at least 2 characters of a name or ID." /></Card>
      ) : result === undefined ? (
        <Card><LoadingState variant="table" label="Searching" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={result.results}
            getRowId={(a) => a.membershipId}
            onRowClick={(a) => setOpen(a.membershipId)}
            rowActions={(a) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpen(a.membershipId); }}>Details</Button>}
            empty={<EmptyState title="No matching accounts" description="Students and teachers without a sign-in account are listed on Accounts & Import." />}
            caption="Matching sign-in accounts"
          />
          {result.more && <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-muted">Showing the first {result.results.length} matches — refine the search to narrow it down.</p>}
        </Card>
      )}
      <AccountDetails membershipId={open} onClose={() => setOpen(null)} onReset={(t) => { setOpen(null); setResetting(t); }} />
      <PasswordResetDialog target={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function AccountDetails({ membershipId, onClose, onReset }: { membershipId: Id<"schoolMemberships"> | null; onClose: () => void; onReset: (t: ResetTarget) => void }) {
  const a = useSchoolQuery(api.credentials.account, membershipId ? { targetMembershipId: membershipId } : "skip");
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-right text-[13.5px] text-ink">{value}</dd>
    </div>
  );
  return (
    <Modal
      open={!!membershipId}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={a ? a.name : "Account"}
      description={a ? ROLE_LABEL[a.role] : undefined}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {a?.passwordAction === "reset" && <Button onClick={() => onReset({ membershipId: a.membershipId, name: a.name, loginId: a.loginId })}><KeyRound className="h-4 w-4" /> Reset password</Button>}
          {a?.passwordAction === "issue" && <Link href="/admin/accounts" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Issue on Accounts &amp; Import</Link>}
        </>
      }
    >
      {!a ? <LoadingState variant="inline" /> : (
        <div className="space-y-4" data-testid="credential-details">
          <dl className="divide-y divide-line/70">
            {row("Login ID", a.loginId ? <span className="inline-flex items-center gap-1"><span className="font-mono font-semibold">{a.loginId}</span><CopyButton text={a.loginId} label="Copy Login ID" /></span> : "—")}
            {a.role === "student" && row("Scholar number", a.scholarNo ?? "—")}
            {a.role === "student" && row("Class / section", a.classSection ?? "—")}
            {a.role === "teacher" && row("Employee ID", a.employeeId ?? "—")}
            {a.role !== "student" && row("Department", a.department ?? "—")}
            {row("Password", <PasswordCell a={a} />)}
            {row("Status", <Badge dot tone={STATE_BADGE[a.state].tone}>{STATE_BADGE[a.state].label}</Badge>)}
          </dl>
          {a.isSelf && <p className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] text-ink-muted">This is your own account. Another administrator must reset your password.</p>}
          {a.state === "suspended" && <p className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] text-ink-muted">Enable this account on Accounts &amp; Import before resetting its password.</p>}
          {a.history.length > 0 && (
            <div>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted"><History className="h-3.5 w-3.5" aria-hidden /> Credential history</h3>
              <ul className="space-y-1.5">
                {a.history.map((h, i) => (
                  <li key={i} className="text-[13px] text-ink-soft">
                    <span className="font-medium text-ink">{EVENT_LABEL[h.action] ?? h.action}</span> · {new Date(h.at).toLocaleString()}{h.by ? ` · by ${h.by}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
