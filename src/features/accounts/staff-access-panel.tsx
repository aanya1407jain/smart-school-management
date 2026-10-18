"use client";
/**
 * Administrative (admin-portal) logins: principals, office staff and
 * accountant-only logins. An administrator (users:manage) can add a login,
 * restrict or un-restrict it to the accountant (finance-only) permissions,
 * suspend / reactivate it and issue a new temporary password. Everything is
 * enforced and audited on the server (accounts.*, memberships.updateAccess);
 * nobody can change their own access here.
 */
import { useState } from "react";
import { Calculator, KeyRound, MoreHorizontal, Power, PowerOff, ShieldCheck, UserPlus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger,
  EmptyState, FormField, Input, LoadingState, Modal, useToast, type Column,
} from "@/components/ui";
import { useSchoolAction, useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { canonicalLoginId, LOGIN_ID_RULES_TEXT } from "@convex/model/loginIds";
import { CredentialsModal, type IssuedCredential } from "./credentials-modal";

type Row = { membershipId: Id<"schoolMemberships">; loginId: string | null; displayName: string; email: string | null; state: "pending" | "active" | "suspended"; accountantOnly: boolean; isSelf: boolean };
type Pending = { row: Row; action: "reset" | "suspend" | "reactivate" | "restrict" | "unrestrict" };

const COPY: Record<Pending["action"], { title: string; body: (n: string) => string; label: string; danger?: boolean }> = {
  reset: { title: "Issue a new temporary password?", body: (n) => `${n} will be signed out everywhere and must choose a new password at next sign-in.`, label: "Issue password" },
  suspend: { title: "Suspend this login?", body: (n) => `${n} is signed out everywhere and cannot sign in until reactivated. Records they created stay.`, label: "Suspend", danger: true },
  reactivate: { title: "Reactivate this login?", body: (n) => `${n} can sign in again with their existing password.`, label: "Reactivate" },
  restrict: { title: "Restrict to accountant access?", body: (n) => `${n} will only see fees, finance reports and student fee ledgers — no academics, attendance, settings or account management.`, label: "Restrict", danger: true },
  unrestrict: { title: "Give full administrator access?", body: (n) => `${n} will get every administrator permission, including account management and settings.`, label: "Give full access", danger: true },
};

export function StaffAccessPanel() {
  const { toast } = useToast();
  const rows = useSchoolQuery(api.accounts.listStaffAccounts, {}) as Row[] | undefined;
  const updateAccess = useSchoolMutation(api.memberships.updateAccess);
  const setStatus = useSchoolAction(api.accounts.setStatus);
  const issue = useSchoolAction(api.accounts.issueTemporaryPassword);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential[] | null>(null);
  const [adding, setAdding] = useState(false);

  const confirm = async () => {
    if (!pending) return;
    const { row, action } = pending;
    setBusy(true);
    try {
      if (action === "reset") setIssued([await issue({ targetMembershipId: row.membershipId })]);
      else if (action === "suspend" || action === "reactivate") await setStatus({ targetMembershipId: row.membershipId, status: action === "suspend" ? "suspended" : "active" });
      else await updateAccess({ targetMembershipId: row.membershipId, permissionSets: action === "restrict" ? ["accountant"] : [] });
      if (action !== "reset") toast({ title: "Access updated", description: row.displayName });
      setPending(null);
    } catch (e) {
      toast({ tone: "error", title: "Action failed", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Row>[] = [
    { key: "name", header: "Name", primary: true, cell: (r) => <div className="min-w-0"><p className="truncate font-medium text-ink">{r.displayName}{r.isSelf && <span className="ml-1.5 text-[12px] font-normal text-ink-muted">(you)</span>}</p>{r.email && <p className="text-[12.5px] text-ink-muted">{r.email}</p>}</div> },
    { key: "login", header: "Login ID", cell: (r) => <span className="font-mono text-[13px] text-ink">{r.loginId ?? "—"}</span> },
    { key: "access", header: "Access", cell: (r) => r.accountantOnly ? <Badge tone="lavender"><Calculator className="h-3 w-3" /> Accountant only</Badge> : <Badge tone="sapphire"><ShieldCheck className="h-3 w-3" /> Administrator</Badge> },
    { key: "state", header: "Status", cell: (r) => <Badge dot tone={r.state === "active" ? "teal" : r.state === "pending" ? "lavender" : "plum"}>{r.state === "active" ? "Active" : r.state === "pending" ? "Pending" : "Suspended"}</Badge> },
  ];

  return (
    <Card data-testid="staff-access">
      <CardHeader title="Administrative logins" description="Office logins for the admin portal. An accountant-only login sees fees and finance reports only." action={<Button size="sm" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add login</Button>} />
      <div className="p-5 pt-2">
        {rows === undefined ? <LoadingState variant="table" /> : (
          <DataTable caption="Administrative logins" rows={rows} getRowId={(r) => r.membershipId} columns={columns} empty={<EmptyState title="No administrative logins" />}
            rowActions={(r) => r.isSelf ? null : (
              <DropdownMenu>
                <DropdownTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Access actions for ${r.displayName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownTrigger>
                <DropdownContent>
                  {r.state !== "suspended" && <DropdownItem onSelect={() => setPending({ row: r, action: "reset" })}><KeyRound className="h-4 w-4" /> {r.state === "pending" ? "Issue password" : "Reset password"}</DropdownItem>}
                  {r.accountantOnly
                    ? <DropdownItem onSelect={() => setPending({ row: r, action: "unrestrict" })}><ShieldCheck className="h-4 w-4" /> Give full admin access</DropdownItem>
                    : <DropdownItem onSelect={() => setPending({ row: r, action: "restrict" })}><Calculator className="h-4 w-4" /> Restrict to accountant</DropdownItem>}
                  {r.state === "active" && <DropdownItem tone="danger" onSelect={() => setPending({ row: r, action: "suspend" })}><PowerOff className="h-4 w-4" /> Suspend</DropdownItem>}
                  {r.state === "suspended" && <DropdownItem onSelect={() => setPending({ row: r, action: "reactivate" })}><Power className="h-4 w-4" /> Reactivate</DropdownItem>}
                </DropdownContent>
              </DropdownMenu>
            )} />
        )}
      </div>
      {pending && (
        <ConfirmDialog open onOpenChange={(o) => !o && setPending(null)} title={COPY[pending.action].title} description={COPY[pending.action].body(pending.row.displayName)}
          confirmLabel={COPY[pending.action].label} tone={COPY[pending.action].danger ? "danger" : undefined} loading={busy} onConfirm={confirm} />
      )}
      {adding && <AddStaffLoginModal onClose={() => setAdding(false)} onIssued={(c) => { setAdding(false); setIssued([c]); }} />}
      {issued && <CredentialsModal open onClose={() => setIssued(null)} credentials={issued} />}
    </Card>
  );
}

function AddStaffLoginModal({ onClose, onIssued }: { onClose: () => void; onIssued: (c: IssuedCredential) => void }) {
  const create = useSchoolAction(api.accounts.create);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState("");
  const [accountantOnly, setAccountantOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginIdError = loginId.trim() && !canonicalLoginId(loginId) ? LOGIN_ID_RULES_TEXT : undefined;
  const submit = async () => {
    if (!name.trim()) return setError("Enter the person's name.");
    if (loginIdError) return;
    setBusy(true);
    setError(null);
    try {
      const r = await create({ person: { kind: "staff", displayName: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), accountantOnly }, ...(loginId.trim() ? { loginId: loginId.trim() } : {}) });
      onIssued(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Add an administrative login" description="Creates a Login ID and a one-time temporary password to hand over in person." size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Create login</Button></>}>
      <div className="space-y-4">
        <FormField label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></FormField>
        <FormField label="Contact email" hint="Optional; never used to sign in."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
        <FormField label="Login ID" hint="Leave blank to generate one (ADMIN-###)." error={loginIdError}><Input value={loginId} onChange={(e) => setLoginId(e.target.value)} className="font-mono" /></FormField>
        <Checkbox label="Accountant only — fees and finance reports, nothing else" checked={accountantOnly} onChange={(e) => setAccountantOnly(e.target.checked)} />
        {!accountantOnly && <p className="rounded-lg bg-lavender/30 px-3 py-2 text-[13px] text-ink-soft">A full administrator can manage accounts, settings and every school record.</p>}
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}
