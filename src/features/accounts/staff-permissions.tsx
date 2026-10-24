"use client";
/**
 * Admin → Staff & Permissions (the Principal). Per-member module × action
 * grants for office (admin) and teacher logins, optional section limits for
 * teachers, and the history of every access change.
 *
 * Everything here is decided and enforced by the server
 * (memberships.staffAccess / setPermissions / permissionHistory,
 * convex/core/grants.ts). This page only shows the rules: cells that share a
 * server control toggle together, cells that cannot be granted say why, and
 * the Principal's own row is read-only (no self-elevation).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, Lock, ShieldCheck, UserCog } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ACTIONS, ACTION_LABELS, CAPABILITIES, GRANT_PRESETS, LINK_NOTES, PRINCIPAL_ONLY, normalizeGrants, type Action, type Grant } from "@convex/core/grants";
import { MODULE_KEYS, MODULES, type ModuleKey } from "@convex/core/modules";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, FormField, Input, LoadingState, PageHeader, SearchInput, Segmented, Select, useToast,
} from "@/components/ui";
import { isConvexConfigured } from "@/lib/convex/config";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { useSession } from "@/features/auth/session-provider";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type StaffRow = NonNullable<ReturnType<typeof useStaff>>[number];
function useStaff() {
  return useSchoolQuery(api.memberships.staffAccess, {});
}

type Draft = { full: boolean; grants: Grant[]; profile: string; sectionIds: Id<"sections">[] };

const has = (grants: Grant[], m: ModuleKey, a: Action) => grants.some((g) => g.module === m && g.actions.includes(a));

/** Toggle one cell; cells sharing a server control (same `link`) toggle together. */
function toggle(grants: Grant[], m: ModuleKey, a: Action, on: boolean): Grant[] {
  const cell = CAPABILITIES[m][a];
  if (cell.kind !== "grantable") return grants;
  const group = cell.link ? ACTIONS.filter((x) => { const c = CAPABILITIES[m][x]; return c.kind === "grantable" && c.link === cell.link; }) : [a];
  const current = new Set(grants.find((g) => g.module === m)?.actions ?? []);
  for (const x of group) (on ? current.add(x) : current.delete(x));
  return normalizeGrants([...grants.filter((g) => g.module !== m), { module: m, actions: [...current] }]);
}

function draftOf(r: StaffRow): Draft {
  return { full: r.fullAdministrator, grants: r.grants as Grant[], profile: r.accessProfile ?? "", sectionIds: r.sectionIds as Id<"sections">[] };
}

function sameDraft(a: Draft, b: Draft) {
  return a.full === b.full && a.profile.trim() === b.profile.trim() && JSON.stringify(normalizeGrants(a.grants)) === JSON.stringify(normalizeGrants(b.grants))
    && JSON.stringify([...a.sectionIds].sort()) === JSON.stringify([...b.sectionIds].sort());
}

/** Plain-language list of what a save changes (for the confirmation). */
function changesBetween(before: Draft, after: Draft): string[] {
  const out: string[] = [];
  if (before.full !== after.full) out.push(after.full ? "Becomes a FULL administrator (every permission, including accounts and settings)." : "Loses full administrator access; keeps only the modules ticked below.");
  for (const m of MODULE_KEYS) for (const a of ACTIONS) {
    const was = !before.full && has(before.grants, m, a);
    const now = !after.full && has(after.grants, m, a);
    if (was !== now) out.push(`${now ? "Grant" : "Remove"}: ${MODULES[m].label} — ${ACTION_LABELS[a]}`);
  }
  if (JSON.stringify([...before.sectionIds].sort()) !== JSON.stringify([...after.sectionIds].sort())) out.push(after.sectionIds.length ? `Section limits: ${after.sectionIds.length} section(s)` : "Section limits removed (view grants become school-wide)");
  if (before.profile.trim() !== after.profile.trim()) out.push(`Label: ${after.profile.trim() || "(none)"}`);
  return out;
}

const isSensitive = (before: Draft, after: Draft) =>
  before.full !== after.full || MODULE_KEYS.some((m) => ["finance", "students"].includes(m) && ACTIONS.some((a) => !has(before.grants, m, a) && has(after.grants, m, a))) || ACTIONS.some((a) => a === "approve" && MODULE_KEYS.some((m) => !has(before.grants, m, a) && has(after.grants, m, a)));

export function StaffPermissionsPage() {
  const header = (
    <PageHeader
      eyebrow="Principal"
      title="Staff & Permissions"
      description="Give each office or teaching login exactly the modules and actions it needs. The server enforces every permission; changes take effect on the person's next action and are recorded in the history below."
      actions={<Link href="/admin/accounts" className="text-sm font-medium text-lagoon hover:underline">Add logins, reset passwords, suspend →</Link>}
    />
  );
  if (!isConvexConfigured) return <div>{header}<Card><EmptyState title="Backend not connected" description="Staff permissions need the Convex backend." /></Card></div>;
  return <div>{header}<StaffPermissionsBody /></div>;
}

function StaffPermissionsBody() {
  const rows = useStaff();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"all" | "admin" | "teacher">("all");
  const [selectedId, setSelectedId] = useState<Id<"schoolMemberships"> | null>(null);
  const filtered = useMemo(() => (rows ?? []).filter((r) => (role === "all" || r.role === role) && (!search.trim() || `${r.displayName} ${r.loginId ?? ""} ${r.accessProfile ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))), [rows, role, search]);
  const selected = (rows ?? []).find((r) => r.membershipId === selectedId) ?? null;

  if (rows === undefined) return <LoadingState variant="table" label="Loading staff" />;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader title="Staff logins" description="Office (admin) and teacher logins. Students never get staff permissions." icon={<UserCog className="h-4 w-4" />} />
          <div className="space-y-3 p-5 pb-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, Login ID or label" />
            <Segmented label="Role" size="sm" value={role} onChange={setRole} options={[{ value: "all", label: "All" }, { value: "admin", label: "Office" }, { value: "teacher", label: "Teachers" }]} />
          </div>
          {filtered.length === 0 ? <EmptyState title="No staff match" className="py-8" /> : (
            <ul className="max-h-[560px] divide-y divide-line/60 overflow-y-auto border-t border-line/60">
              {filtered.map((r) => (
                <li key={r.membershipId}>
                  <button type="button" onClick={() => setSelectedId(r.membershipId)} className={cn("flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-teal-soft/30", selectedId === r.membershipId && "bg-teal-soft/50")}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{r.displayName}{r.isSelf && <span className="ml-1.5 text-[12px] font-normal text-ink-muted">(you)</span>}</span>
                      <span className="block truncate text-[12px] text-ink-muted">{r.loginId ?? "No Login ID yet"} · {r.summary}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={r.fullAdministrator ? "sapphire" : r.role === "teacher" ? "teal" : "plum"}>{r.fullAdministrator ? "Full admin" : r.role === "teacher" ? "Teacher" : r.legacyAccountant ? "Accountant" : "Office"}</Badge>
                      {r.status !== "active" && <Badge tone="neutral">{r.status === "invited" ? "No password yet" : "Suspended"}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected ? <PermissionEditor key={selected.membershipId} row={selected} /> : (
          <Card><EmptyState title="Choose a staff member" description="Select a login on the left to see and change what it can do." icon={<ShieldCheck className="h-6 w-6" />} /></Card>
        )}
      </div>
      <PermissionHistory targetMembershipId={selected?.membershipId ?? null} name={selected?.displayName ?? null} />
    </div>
  );
}

function PermissionEditor({ row }: { row: StaffRow }) {
  const { toast } = useToast();
  const { hasModule } = useSession();
  const save = useSchoolMutation(api.memberships.setPermissions);
  const sections = useSchoolQuery(api.academics.listSections, row.role === "teacher" ? {} : "skip");
  const initial = useMemo(() => draftOf(row), [row]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(initial), [initial]);

  const readOnly = row.isSelf;
  const isAdmin = row.role === "admin";
  const dirty = !sameDraft(initial, draft);
  const scopable = has(draft.grants, "students", "view") || has(draft.grants, "attendance", "view");
  const changes = changesBetween(initial, draft);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await save({
        targetMembershipId: row.membershipId,
        fullAdministrator: draft.full,
        grants: draft.full ? [] : draft.grants,
        accessProfile: draft.full ? null : draft.profile.trim() || null,
        sectionIds: draft.full || !scopable ? [] : draft.sectionIds,
      });
      toast({ title: "Permissions saved", description: `${row.displayName}: ${r.summary}` });
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={row.displayName}
        description={`${row.role === "admin" ? "Office login" : "Teacher login"} · ${row.loginId ?? "no Login ID yet"}${row.teacherEmployeeId ? ` · ${row.teacherEmployeeId}` : ""}`}
        icon={<ShieldCheck className="h-4 w-4" />}
        action={row.accessProfile ? <Badge tone="lavender">{row.accessProfile}</Badge> : undefined}
      />
      <div className="space-y-5 p-5">
        {readOnly && (
          <p className="flex items-start gap-2 rounded-xl bg-lavender/30 px-3 py-2.5 text-[13px] text-ink-soft"><Lock className="mt-0.5 h-4 w-4 shrink-0" /> This is your own login. Nobody can change their own access — another full administrator must do it.</p>
        )}
        {row.legacyAccountant && <p className="rounded-xl bg-teal-soft/40 px-3 py-2.5 text-[13px] text-ink-soft">This login uses the older “Accountant only” restriction. Saving here replaces it with the grants below (the Accountant preset gives the same access).</p>}

        {isAdmin && (
          <Segmented<"full" | "custom">
            label="Access level"
            value={draft.full ? "full" : "custom"}
            onChange={(v) => !readOnly && setDraft(v === "full" ? { full: true, grants: [], profile: "", sectionIds: [] } : { ...draft, full: false })}
            options={[{ value: "full", label: "Full administrator" }, { value: "custom", label: "Only selected modules" }]}
          />
        )}

        {draft.full ? (
          <p className="text-[13px] text-ink-muted">A full administrator (Principal) can do everything in every enabled module, including managing accounts, permissions, settings and the audit log.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Start from a preset" hint="Pre-fills the table; adjust before saving.">
                <Select disabled={readOnly} value="" onChange={(e) => { const p = GRANT_PRESETS.find((x) => x.key === e.target.value); if (p) setDraft({ ...draft, grants: normalizeGrants(p.grants), profile: draft.profile || p.label }); }}>
                  <option value="">Choose a preset…</option>
                  {GRANT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </Select>
              </FormField>
              <FormField label="Label" hint="Shown to you only, e.g. “Accountant”. Never grants anything.">
                <Input disabled={readOnly} value={draft.profile} maxLength={60} onChange={(e) => setDraft({ ...draft, profile: e.target.value })} placeholder="e.g. Exam coordinator" />
              </FormField>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line/70">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-teal-soft/30 text-[12px] uppercase tracking-wide text-ink-muted">
                  <tr><th className="px-3 py-2 text-left font-semibold">Module</th>{ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center font-semibold">{ACTION_LABELS[a]}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {MODULE_KEYS.map((m) => (
                    <tr key={m}>
                      <td className="px-3 py-2.5 align-top">
                        <span className="block font-medium text-ink">{MODULES[m].label}</span>
                        {!hasModule(m) && <span className="text-[12px] text-plum">Not enabled for your school — grants have no effect</span>}
                      </td>
                      {ACTIONS.map((a) => {
                        const cell = CAPABILITIES[m][a];
                        if (cell.kind === "unavailable") return <td key={a} className="px-2 py-2.5 text-center text-ink-muted" title={cell.reason}><span aria-label={`${ACTION_LABELS[a]} cannot be granted: ${cell.reason}`}>—</span></td>;
                        const on = has(draft.grants, m, a);
                        return (
                          <td key={a} className="px-2 py-2.5 text-center" title={cell.description + (cell.link ? ` · ${LINK_NOTES[cell.link] ?? ""}` : "")}>
                            <input
                              type="checkbox" className="h-4 w-4 cursor-pointer accent-lagoon disabled:cursor-not-allowed" checked={on} disabled={readOnly}
                              aria-label={`${MODULES[m].label}: ${ACTION_LABELS[a]} — ${cell.description}`}
                              onChange={(e) => setDraft({ ...draft, grants: toggle(draft.grants, m, a, e.target.checked) })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-1 text-[12px] text-ink-muted">
              <li>— means the action cannot be granted (hover to see why). Linked boxes are one server control and switch together.</li>
              <li>Attendance is marked and corrected only by each section&apos;s class teacher — no one else can be given that.</li>
              <li>Only full administrators can: {PRINCIPAL_ONLY.map((p) => p.label.toLowerCase()).join("; ")}.</li>
              {row.role === "teacher" && <li>A teacher keeps their normal teaching access; school-wide grants add an “Additional duties” menu.</li>}
            </ul>

            {row.role === "teacher" && scopable && (
              <div className="rounded-xl border border-line/70 p-4">
                <p className="text-sm font-semibold text-ink">Limit Students / Attendance viewing to sections (optional)</p>
                <p className="mb-3 text-[12px] text-ink-muted">With sections chosen, the view grants cover only these sections (plus the teacher&apos;s own classes) instead of the whole school. Other grants stay school-wide.</p>
                {sections === undefined ? <LoadingState variant="inline" /> : (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {sections.map((s) => (
                      <Checkbox key={s._id} label={s.displayName} disabled={readOnly} checked={draft.sectionIds.includes(s._id)}
                        onChange={(e) => setDraft({ ...draft, sectionIds: e.target.checked ? [...draft.sectionIds, s._id] : draft.sectionIds.filter((x) => x !== s._id) })} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
        {!readOnly && (
          <div className="flex flex-col-reverse gap-2 border-t border-line/70 pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={!dirty || busy} onClick={() => { setDraft(initial); setError(null); }}>Discard changes</Button>
            <Button disabled={!dirty} loading={busy} onClick={() => setConfirming(true)}>Save permissions</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Change ${row.displayName}'s permissions?`}
        tone={isSensitive(initial, draft) ? "danger" : "primary"}
        confirmLabel="Save permissions"
        loading={busy}
        onConfirm={submit}
        description={<span className="block space-y-1">{changes.map((c) => <span key={c} className="block">• {c}</span>)}<span className="mt-2 block text-ink-muted">Takes effect on their next action and is recorded in the history.</span></span>}
      />
    </Card>
  );
}

function PermissionHistory({ targetMembershipId, name }: { targetMembershipId: Id<"schoolMemberships"> | null; name: string | null }) {
  const history = useSchoolQuery(api.memberships.permissionHistory, targetMembershipId ? { targetMembershipId, limit: 50 } : { limit: 50 });
  return (
    <Card>
      <CardHeader title={name ? `History — ${name}` : "Recent permission changes"} description="Every change to staff permissions and access, newest first. Kept permanently in the audit log." icon={<History className="h-4 w-4" />} />
      <div className="p-5 pt-3">
        {history === undefined ? <LoadingState variant="inline" /> : history.length === 0 ? <EmptyState title="No changes yet" className="py-6" /> : (
          <ul className="divide-y divide-line/60">
            {history.map((h) => (
              <li key={h.auditId} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="w-40 shrink-0 text-[12px] text-ink-muted">{formatDate(new Date(h.at).toISOString().slice(0, 10))} {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 text-sm text-ink">{h.summary}</span>
                <span className="shrink-0 text-[12px] text-ink-muted">by {h.by}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
