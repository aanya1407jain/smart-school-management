"use client";
/**
 * Students / Teachers with their sign-in account state, and the account
 * actions an administrator can take. Every action is authorised server-side
 * (users:manage); the UI only reflects what the server returns.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, MoreHorizontal, Power, PowerOff, UserPlus, Users, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, EmptyState,
  FormField, Input, LoadingState, Modal, Select, useToast, type Column,
} from "@/components/ui";
import { useSchoolAction, useSchoolMutation, useSchoolPaginatedQuery, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { canonicalLoginId, LOGIN_ID_RULES_TEXT } from "@convex/model/loginIds";
import { CredentialsModal, type IssuedCredential } from "./credentials-modal";
import { AddPersonModal } from "./add-person-modal";
import { BulkAccountRun } from "./bulk-account-run";

type Kind = "student" | "teacher";
type Account = { membershipId: Id<"schoolMemberships">; loginId: string | null; state: "pending" | "active" | "suspended" };
type Person = { personId: string; name: string; number: string; detail: string; rollNo: number | null; account: Account | null };
/**
 * What the administrator has selected. "ids" = explicit students (from loaded pages);
 * "all" = every matching student WITHOUT an account in the current filter, resolved and
 * snapshotted on the server when the run is created (never loaded into the browser).
 */
type Selection = { mode: "ids"; ids: Map<string, Person> } | { mode: "all"; sectionId: string | null };
const EMPTY: Selection = { mode: "ids", ids: new Map() };
/** Students that can get an account in a bulk run: none yet, or pending (reserved Login ID, no password). */
const isEligible = (p: Person) => !p.account || p.account.state === "pending";

const STATE_BADGE: Record<Account["state"] | "none", { label: string; tone: "teal" | "lavender" | "plum" | "neutral" }> = {
  active: { label: "Active", tone: "teal" },
  pending: { label: "Pending", tone: "lavender" },
  suspended: { label: "Disabled", tone: "plum" },
  none: { label: "No account", tone: "neutral" },
};

export function PeoplePanel({ kind, canAdd }: { kind: Kind; canAdd: boolean }) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useState<string>("");
  const list = useSchoolPaginatedQuery(api.accounts.listPeople, { kind, ...(sectionId ? { sectionId: sectionId as Id<"sections"> } : {}) }, { initialNumItems: 50 });
  const bulk = kind === "student";
  const sections = useSchoolQuery(api.academics.listSections, bulk ? {} : "skip");
  const counts = useSchoolQuery(api.bulkAccounts.scopeCounts, bulk ? (sectionId ? { sectionId: sectionId as Id<"sections"> } : {}) : "skip");
  const activeJob = useSchoolQuery(api.bulkAccounts.activeJob, bulk ? {} : "skip");
  const createJob = useSchoolMutation(api.bulkAccounts.createJob);
  const cancelJob = useSchoolMutation(api.bulkAccounts.cancelJob);
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [runJob, setRunJob] = useState<{ id: Id<"bulkAccountJobs">; autoPrepare: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const create = useSchoolAction(api.accounts.create);
  const issue = useSchoolAction(api.accounts.issueTemporaryPassword);
  const setStatus = useSchoolAction(api.accounts.setStatus);

  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState<Person | null>(null);
  const [customId, setCustomId] = useState("");
  const [confirm, setConfirm] = useState<{ person: Person; action: "reset" | "disable" | "enable" } | null>(null);
  const [issued, setIssued] = useState<IssuedCredential[] | null>(null);
  const [adding, setAdding] = useState(false);

  const noun = kind === "student" ? "student" : "teacher";
  const rows = (list.results ?? []) as Person[];

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast({ tone: "error", title: "Action failed", description: errorMessage(e) }); } finally { setBusy(null); }
  };

  const submitCreate = () => {
    if (!creating) return;
    const person = kind === "student"
      ? { kind: "student" as const, studentId: creating.personId as Id<"students"> }
      : { kind: "teacher" as const, teacherId: creating.personId as Id<"teachers"> };
    const loginId = customId.trim() || undefined;
    void run(`create:${creating.personId}`, async () => {
      const r = await create({ person, ...(loginId ? { loginId } : {}) });
      setCreating(null);
      setCustomId("");
      setIssued([r]);
    });
  };

  const submitConfirm = () => {
    if (!confirm?.person.account) return;
    const { person, action } = confirm;
    const id = person.account!.membershipId;
    void run(`${action}:${person.personId}`, async () => {
      if (action === "reset") {
        const r = await issue({ targetMembershipId: id });
        setIssued([r]);
      } else {
        await setStatus({ targetMembershipId: id, status: action === "disable" ? "suspended" : "active" });
        toast({ title: action === "disable" ? "Account disabled" : "Account enabled", description: person.name });
      }
      setConfirm(null);
    });
  };

  const columns: Column<Person>[] = [
    {
      key: "name", header: "Name", primary: true,
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{p.name}</p>
          <p className="text-[12.5px] text-ink-muted">{p.number}</p>
        </div>
      ),
    },
    { key: "detail", header: kind === "student" ? "Class" : "Designation", cell: (p) => <span className="text-ink-soft">{p.detail}</span> },
    ...(kind === "student" ? [{ key: "roll", header: "Roll no.", cell: (p: Person) => <span className="text-ink-soft">{p.rollNo ?? "—"}</span> }] : []),
    { key: "loginId", header: "Login ID", cell: (p) => <span className="font-mono text-[13px] text-ink">{p.account?.loginId ?? "—"}</span> },
    {
      key: "state", header: "Account",
      cell: (p) => { const b = STATE_BADGE[p.account?.state ?? "none"]; return <Badge tone={b.tone} dot>{b.label}</Badge>; },
    },
  ];

  const rowActions = (p: Person) => {
    const state = p.account?.state;
    if (!p.account) {
      return (
        <Button size="sm" variant="soft" loading={busy === `create:${p.personId}`} onClick={() => { setCustomId(""); setCreating(p); }}>
          <UserPlus className="h-4 w-4" /> Create account
        </Button>
      );
    }
    return (
      <DropdownMenu>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Account actions for ${p.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownTrigger>
        <DropdownContent>
          {state !== "suspended" && (
            <DropdownItem onSelect={() => setConfirm({ person: p, action: "reset" })}>
              <KeyRound className="h-4 w-4" /> {state === "pending" ? "Issue password" : "Reset password"}
            </DropdownItem>
          )}
          {state === "active" && <DropdownItem tone="danger" onSelect={() => setConfirm({ person: p, action: "disable" })}><PowerOff className="h-4 w-4" /> Disable account</DropdownItem>}
          {state === "suspended" && <DropdownItem onSelect={() => setConfirm({ person: p, action: "enable" })}><Power className="h-4 w-4" /> Enable account</DropdownItem>}
        </DropdownContent>
      </DropdownMenu>
    );
  };

  const loginIdError = customId.trim() && !canonicalLoginId(customId) ? LOGIN_ID_RULES_TEXT : undefined;

  // ---------------------------------------------------------------- selection (students)
  // A different filter is a different result set: never carry a selection across it.
  const filterKey = `${kind}:${sectionId}`;
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    if (lastFilter.current !== filterKey) { lastFilter.current = filterKey; setSelection(EMPTY); }
  }, [filterKey]);

  const pageEligible = useMemo(() => rows.filter(isEligible), [rows]);
  const selectedIds = selection.mode === "ids" ? selection.ids : null;
  const pageSelected = selectedIds ? pageEligible.filter((p) => selectedIds.has(p.personId)).length : pageEligible.length;
  const allOnPage = pageEligible.length > 0 && pageSelected === pageEligible.length;
  const someOnPage = pageSelected > 0 && !allOnPage;
  const selectedCount = selection.mode === "all" ? counts?.withoutAccount ?? 0 : selection.ids.size;

  const toggle = (p: Person) => setSelection((sel) => {
    if (sel.mode === "all") return sel; // in "all" mode individual rows are not toggled
    const ids = new Map(sel.ids);
    if (ids.has(p.personId)) ids.delete(p.personId); else ids.set(p.personId, p);
    return { mode: "ids", ids };
  });
  const togglePage = () => setSelection((sel) => {
    if (sel.mode === "all") return EMPTY;
    const ids = new Map(sel.ids);
    if (allOnPage) pageEligible.forEach((p) => ids.delete(p.personId)); else pageEligible.forEach((p) => ids.set(p.personId, p));
    return { mode: "ids", ids };
  });
  const clearSelection = () => setSelection(EMPTY);

  const startBulk = async () => {
    setStarting(true);
    try {
      const scope = selection.mode === "all"
        ? { type: "all" as const, ...(selection.sectionId ? { sectionId: selection.sectionId as Id<"sections"> } : {}) }
        : { type: "selected" as const, studentIds: [...selection.ids.keys()] as Id<"students">[] };
      const id = await createJob({ scope });
      setRunJob({ id, autoPrepare: scope.type === "all" });
    } catch (e) {
      toast({ tone: "error", title: "Could not start", description: errorMessage(e) });
    } finally {
      setStarting(false);
    }
  };

  const selectColumn: Column<Person> = {
    key: "select",
    mobileLabel: false,
    headerClassName: "w-10",
    header: (
      <HeaderCheckbox
        checked={selection.mode === "all" || allOnPage}
        indeterminate={selection.mode === "ids" && someOnPage}
        disabled={pageEligible.length === 0}
        onChange={togglePage}
        label="Select all students without an account on this page"
      />
    ),
    cell: (p) => isEligible(p) ? (
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--color-sapphire,#1f3a5f)]"
        checked={selection.mode === "all" || (selectedIds?.has(p.personId) ?? false)}
        disabled={selection.mode === "all"}
        onChange={() => toggle(p)}
        aria-label={`Select ${p.name}`}
      />
    ) : <span className="sr-only">Already has an account</span>,
  };
  const tableColumns = bulk ? [selectColumn, ...columns] : columns;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Create sign-in accounts, reset passwords and disable access for {noun}s. Pending accounts have a Login ID but no password yet.
        </p>
        {canAdd && <Button onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add {noun}</Button>}
      </div>

      {bulk && activeJob && !runJob && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-mauve/30 bg-blush/30 px-4 py-3 text-[13px] text-ink-soft">
          <span>
            {activeJob.status === "completed"
              ? `Your last account-creation run finished, but ${activeJob.undelivered} new password(s) were never delivered.`
              : `You have an unfinished account-creation run: ${activeJob.created + activeJob.skipped + activeJob.failed} of ${activeJob.total} processed.`}
          </span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setRunJob({ id: activeJob._id, autoPrepare: true })}>{activeJob.status === "completed" ? "Review" : "Resume"}</Button>
            {activeJob.status !== "completed" && <Button size="sm" variant="outline" onClick={() => void cancelJob({ jobId: activeJob._id })}>Cancel run</Button>}
          </span>
        </div>
      )}

      {bulk && (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <FormField label="Section" className="w-full sm:w-56">
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Filter students by section">
              <option value="">All sections</option>
              {(sections ?? []).map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
            </Select>
          </FormField>
          {counts && (
            <p className="pb-2 text-[13px] text-ink-muted" data-testid="scope-counts">
              {counts.total.toLocaleString()}{counts.capped ? "+" : ""} student{counts.total === 1 ? "" : "s"} · {counts.withoutAccount.toLocaleString()} without an account
            </p>
          )}
        </div>
      )}

      {bulk && (selection.mode === "all" || selection.ids.size > 0) && (
        <div role="region" aria-label="Selection" className="sticky top-2 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sapphire/20 bg-white px-4 py-2.5 shadow-soft">
          <span className="text-sm text-ink" data-testid="selection-summary">
            <span className="font-semibold">{selectedCount.toLocaleString()}</span> student{selectedCount === 1 ? "" : "s"} selected
            {selection.mode === "all" ? <> — all without an account{sectionId ? " in this section" : ""} (snapshot taken when you continue)</> : null}
          </span>
          <span className="flex gap-2">
            <Button size="sm" onClick={startBulk} loading={starting} disabled={!!runJob}><Users className="h-4 w-4" /> Create accounts</Button>
            <Button size="sm" variant="outline" onClick={clearSelection}><X className="h-4 w-4" /> Clear selection</Button>
          </span>
        </div>
      )}
      {bulk && selection.mode === "ids" && allOnPage && counts && counts.withoutAccount > selection.ids.size && (
        <p className="mb-3 text-[13px] text-ink-soft">
          All {pageSelected} eligible students on this page are selected.{" "}
          <button type="button" className="font-medium text-lagoon underline underline-offset-2 hover:text-sapphire" onClick={() => setSelection({ mode: "all", sectionId: sectionId || null })}>
            Select all {counts.withoutAccount.toLocaleString()}{counts.capped ? "+" : ""} students without an account{sectionId ? " in this section" : ""}
          </button>
        </p>
      )}

      {list.status === "LoadingFirstPage" ? (
        <LoadingState variant="table" label={`Loading ${noun}s`} />
      ) : (
        <DataTable
          columns={tableColumns}
          rows={rows}
          getRowId={(p) => p.personId}
          rowActions={rowActions}
          caption={`${noun}s and their accounts`}
          empty={<EmptyState title={`No ${noun}s yet`} description={`Add ${noun}s one by one or import them from a spreadsheet.`} />}
        />
      )}
      {list.status === "CanLoadMore" && (
        <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => list.loadMore(50)}>Load more</Button></div>
      )}

      <Modal
        open={!!creating}
        onOpenChange={(o) => { if (!o) setCreating(null); }}
        title={`Create account for ${creating?.name ?? ""}`}
        description="A Login ID is generated automatically unless you enter one. A temporary password is issued once."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(null)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={!!loginIdError} loading={!!busy && busy.startsWith("create:")}>Create account</Button>
          </>
        }
      >
        <FormField label="Login ID (optional)" hint={`Leave empty to generate one (e.g. ${kind === "student" ? "STU-2026-00001" : "TCH-00001"}).`} error={loginIdError}>
          <Input value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="Generate automatically" autoComplete="off" />
        </FormField>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.action === "disable" ? "Disable account?" : confirm?.action === "enable" ? "Enable account?" : "Issue a new temporary password?"}
        description={
          confirm?.action === "disable"
            ? `${confirm.person.name} will be signed out everywhere and cannot sign in until the account is enabled again.`
            : confirm?.action === "enable"
              ? `${confirm?.person.name} will be able to sign in again with their existing password.`
              : `${confirm?.person.name ?? ""} will be signed out everywhere; their current password stops working. They must choose a new password after signing in.`
        }
        confirmLabel={confirm?.action === "disable" ? "Disable" : confirm?.action === "enable" ? "Enable" : "Issue password"}
        tone={confirm?.action === "disable" ? "danger" : "primary"}
        loading={!!busy && !busy.startsWith("create:")}
        onConfirm={submitConfirm}
      />

      {runJob && <BulkAccountRun jobId={runJob.id} autoPrepare={runJob.autoPrepare} onClose={() => { setRunJob(null); setSelection(EMPTY); }} />}
      <CredentialsModal open={!!issued} onClose={() => setIssued(null)} credentials={issued ?? []} />
      {canAdd && <AddPersonModal kind={kind} open={adding} onClose={() => setAdding(false)} onIssued={(c) => setIssued(c)} />}
    </Card>
  );
}

function HeaderCheckbox({ checked, indeterminate, disabled, onChange, label }: { checked: boolean; indeterminate: boolean; disabled: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="h-4 w-4" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />;
}
