"use client";
/**
 * Promote: a section's students move into a later academic year — each with
 * an action (promote / repeat / hold) and a destination section. Roll numbers
 * in the destination are previewed, not chosen: they stay system-assigned
 * (alphabetical, 1..n — convex/model/rollNumbers.ts). Every run is recorded
 * and can be rolled back while nothing in the new year depends on it.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowRight, History, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { compareRosterEntries } from "@convex/model/rollNumbers";
import {
  AlertPill, Avatar, Badge, BadgeChip, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, GlassCard, LoadingState, Modal, Select, Tooltip, useToast,
} from "@/components/ui";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { StandingPill, YearSectionPicker, rupees, type Standing } from "./shared";

type Action = "promote" | "repeat" | "hold";
type Decision = { action: Action; target: Id<"sections"> | "" };
type TargetSection = { sectionId: Id<"sections">; label: string; level: number; capacity: number | null; kind: "promote" | "repeat"; roster: { enrollmentId: string; studentId: string; firstName: string; lastName: string }[] };

const DEFAULT_ACTION: Record<Standing, Action> = { eligible: "promote", no_result: "promote", compartment: "hold", detained: "repeat" };

export function PromoteTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState<Id<"sections"> | "">("");
  const [to, setTo] = useState<Id<"sections"> | "">("");
  const [toYear, setToYear] = useState<Id<"academicYears"> | "">("");
  const plan = useSchoolQuery(api.studentLifecycle.promotionPlan, from && to ? { fromSectionId: from, toSectionId: to } : "skip");
  const targets = useSchoolQuery(api.studentLifecycle.promotionTargets, from && toYear ? { fromSectionId: from, toAcademicYearId: toYear } : "skip");
  const runs = useSchoolQuery(api.studentLifecycle.promotionRuns, from ? { fromSectionId: from } : "skip");
  const promote = useSchoolMutation(api.studentLifecycle.promoteBatch);
  const rollback = useSchoolMutation(api.studentLifecycle.rollbackPromotion);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rollbackRun, setRollbackRun] = useState<Id<"promotionRuns"> | null>(null);

  const sections: TargetSection[] = useMemo(() => targets?.sections ?? [], [targets]);
  const byId = useMemo(() => new Map(sections.map((s) => [s.sectionId as string, s])), [sections]);
  const optionsFor = (action: Action) => sections.filter((s) => (action === "promote" ? s.kind === "promote" : action === "repeat" ? s.kind === "repeat" : false));
  const defaultTarget = (action: Action): Id<"sections"> | "" => {
    if (action === "hold") return "";
    const chosen = to ? byId.get(to) : undefined;
    if (chosen && chosen.kind === action) return chosen.sectionId;
    // Same section letter as the source when possible (8-A → 8-A when repeating).
    const letter = plan?.from.label.split("-").pop();
    const opts = optionsFor(action);
    return (opts.find((s) => s.label.split("-").pop() === letter) ?? opts[0])?.sectionId ?? "";
  };

  // (Re)build the per-student decisions when the plan or the destinations change.
  const planKey = plan && targets ? `${plan.from.sectionId}:${plan.to.sectionId}:${plan.rows.length}:${sections.length}` : "";
  useEffect(() => {
    if (!plan || !targets) return;
    const next: Record<string, Decision> = {};
    for (const r of plan.rows) {
      const action = DEFAULT_ACTION[r.standing];
      next[r.studentId] = { action, target: defaultTarget(action) };
    }
    setDecisions(next);
    setPicked(new Set(plan.rows.filter((r) => r.eligible).map((r) => r.studentId)));
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = plan?.rows ?? [];
  const eligible = rows.filter((r) => r.eligible);
  const moving = eligible.filter((r) => picked.has(r.studentId) && decisions[r.studentId]?.action !== "hold" && decisions[r.studentId]?.target);
  const promoteCount = moving.filter((r) => decisions[r.studentId].action === "promote").length;
  const repeatCount = moving.length - promoteCount;
  const holdCount = eligible.length - moving.length;
  const arrears = moving.flatMap((r) => (r.fees && r.fees.outstandingMinor > 0 ? [{ ...r, fees: r.fees }] : []));

  // Roll numbers each moving student will get: destination roster + incoming, alphabetical.
  const rollPreview = useMemo(() => {
    const out = new Map<string, number>();
    const incoming = new Map<string, { studentId: string; firstName: string; lastName: string; enrollmentId: string }[]>();
    for (const r of moving) {
      const t = decisions[r.studentId].target;
      if (!incoming.has(t)) incoming.set(t, []);
      incoming.get(t)!.push({ studentId: r.studentId, firstName: r.firstName, lastName: r.lastName, enrollmentId: `new:${r.studentId}` });
    }
    for (const [sectionId, list] of incoming) {
      const all = [...(byId.get(sectionId)?.roster ?? []), ...list].sort(compareRosterEntries);
      all.forEach((e, i) => { if (e.enrollmentId.startsWith("new:")) out.set(e.studentId, i + 1); });
    }
    return out;
  }, [moving, decisions, byId]);

  const incomingTo = (sectionId: string) => moving.filter((r) => decisions[r.studentId].target === sectionId).length;
  const groups = [...new Set(moving.map((r) => decisions[r.studentId].target))].map((id) => ({ section: byId.get(id)!, count: incomingTo(id) })).filter((g) => g.section);

  const setDecision = (studentId: string, patch: Partial<Decision>) => setDecisions((d) => {
    const cur = d[studentId];
    const action = patch.action ?? cur.action;
    return { ...d, [studentId]: { action, target: patch.target ?? (patch.action ? defaultTarget(action) : cur.target) } };
  });

  const run = async () => {
    if (!from || !toYear) return;
    setBusy(true);
    setError(null);
    try {
      const r = await promote({ fromSectionId: from, toAcademicYearId: toYear, moves: moving.map((m) => ({ studentId: m.studentId, toSectionId: decisions[m.studentId].target as Id<"sections"> })) });
      toast({ title: "Promotion complete", description: `${r.promoted} promoted, ${r.repeated} repeating. You can roll this back from the audit log while nothing is recorded in the new year.` });
      setStep(0);
      setAck(false);
    } catch (e) {
      setError(errorMessage(e));
      setStep(0);
    } finally {
      setBusy(false);
    }
  };

  const doRollback = async () => {
    if (!rollbackRun) return;
    setBusy(true);
    try {
      const r = await rollback({ runId: rollbackRun });
      toast({ title: "Promotion rolled back", description: `${r.restored} student(s) are back in ${plan?.from.label ?? "their section"}.` });
    } catch (e) {
      toast({ tone: "error", title: "Could not roll back", description: errorMessage(e) });
    } finally {
      setBusy(false);
      setRollbackRun(null);
    }
  };

  const toChosen = to ? byId.get(to) : undefined;
  const seatsAfter = toChosen ? toChosen.roster.length + incomingTo(toChosen.sectionId) : null;
  const allPicked = eligible.length > 0 && eligible.every((r) => picked.has(r.studentId));

  return (
    <div className="space-y-4 pb-24">
      <GlassCard className="spatial">
        <CardHeader title="Promote a section" description="Pick the section students are in now and where they go next year. Each student can be promoted, repeat the class or stay on hold." icon={<ArrowRight className="h-4 w-4" />} />
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <YearSectionPicker label="From" value={from} onChange={setFrom} placeholder="Current section" />
          <YearSectionPicker label="To" value={to} onChange={setTo} onYear={setToYear} placeholder="Destination section" />
        </div>
        {plan && (
          <div className="px-5 pb-5">
            <AlertPill tone={plan.sectionProblem ? "plum" : "teal"} icon={<Users className="h-4 w-4" aria-hidden />} className="flex-wrap rounded-2xl">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong className="figures text-ink">{rows.length} students loaded</strong>
                <span className="inline-flex items-center gap-1.5"><BadgeChip tone="sapphire">{plan.from.label}</BadgeChip><span className="text-ink-muted">{plan.from.year}</span><ArrowRight className="h-3.5 w-3.5 text-ink-muted" aria-hidden /><BadgeChip>{plan.to.label}</BadgeChip><span className="text-ink-muted">{plan.to.year}</span></span>
                <span className="figures">
                  Target capacity: {plan.to.capacity ? <strong className={cn(seatsAfter !== null && seatsAfter > plan.to.capacity ? "text-plum" : "text-ink")}>{seatsAfter ?? plan.to.enrolled}/{plan.to.capacity} seats after this run</strong> : <strong className="text-ink">{plan.to.enrolled} enrolled · no limit set</strong>}
                </span>
                {plan.kind === "repeat" && <Badge tone="plum">Repeating the class</Badge>}
              </span>
            </AlertPill>
            {plan.sectionProblem && <p role="alert" className="mt-2 text-[13px] text-plum">{plan.sectionProblem}</p>}
          </div>
        )}
      </GlassCard>

      {from && to && (plan === undefined || targets === undefined) && <Card><LoadingState variant="inline" label="Loading the roster" /></Card>}

      {plan && targets && !plan.sectionProblem && (
        <Card className="overflow-hidden">
          <CardHeader title="Roster & promotion" description="Suggested actions follow the latest published result: eligible → promote, compartment → hold, three or more subjects not passed → repeat. Change any row." />
          {rows.length === 0 ? <EmptyState title="No students currently enrolled in this section" className="py-8" /> : (
            <div className="scrollbar-thin relative overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <caption className="sr-only">Students of {plan.from.label} and their promotion</caption>
                <thead>
                  <tr className="border-b border-line/60 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <Checkbox label={<span className="sr-only">Select all eligible students</span>} checked={allPicked} disabled={!eligible.length} onChange={(e) => setPicked(new Set(e.target.checked ? eligible.map((r) => r.studentId) : []))} />
                    </th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">Student</th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">Academic standing</th>
                    <th scope="col" className="px-2 py-2.5 font-semibold">Fees</th>
                    <th scope="col" className="w-40 px-2 py-2.5 font-semibold">Action</th>
                    <th scope="col" className="w-40 px-2 py-2.5 font-semibold">Destination</th>
                    <th scope="col" className="w-24 px-4 py-2.5 text-right font-semibold">New roll</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const d = decisions[r.studentId] ?? { action: "hold" as Action, target: "" as const };
                    const on = picked.has(r.studentId) && r.eligible;
                    const roll = rollPreview.get(r.studentId);
                    return (
                      <tr key={r.studentId} style={{ "--stagger-i": i } as CSSProperties} className={cn("stagger border-b border-line/40 transition-colors hover:bg-teal-soft/20", !r.eligible && "opacity-60", on && d.action !== "hold" && "bg-white/40")}>
                        <td className="px-4 py-2.5">
                          <Checkbox
                            label={<span className="sr-only">Include {r.name}</span>}
                            disabled={!r.eligible}
                            checked={on}
                            onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.studentId); else n.delete(r.studentId); return n; })}
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={r.name} size="sm" />
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 font-semibold text-ink"><BadgeChip tone="neutral" title="Current roll number">{r.rollNo ?? "—"}</BadgeChip><span className="truncate">{r.name}</span></p>
                              <p className="mono-id mt-0.5 text-ink-muted">{r.admissionNo}{!r.eligible && r.reason ? <span className="ml-2 font-sans text-plum">{r.reason}</span> : null}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-col items-start gap-1">
                            <StandingPill standing={r.standing} />
                            {r.result && <span className="figures text-[12px] text-ink-muted">{r.result.percentage.toFixed(1)}%{r.result.grade ? ` · ${r.result.grade}` : ""} · {r.result.examName}</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          {r.fees === null ? <Badge tone="neutral" dot>Not checked</Badge> : r.fees.outstandingMinor > 0 ? (
                            <Tooltip content={<>Outstanding {rupees(r.fees.outstandingMinor)} for {plan.from.year}{r.fees.overdueMinor ? <>, of which {rupees(r.fees.overdueMinor)} is overdue</> : null}. Promotion is allowed; the balance stays on the student&apos;s ledger.</>}>
                              <button type="button" className="rounded-full focus-visible:outline-none focus-visible:shadow-focus"><Badge tone="plum" dot className="figures">Arrears due: {rupees(r.fees.outstandingMinor)}</Badge></button>
                            </Tooltip>
                          ) : <Badge tone="teal" dot>Clear</Badge>}
                        </td>
                        <td className="px-2 py-2.5">
                          <Select aria-label={`Action for ${r.name}`} value={d.action} disabled={!on} onChange={(e) => setDecision(r.studentId, { action: e.target.value as Action })} className="h-9">
                            <option value="promote">Promote</option>
                            <option value="repeat">Repeat grade</option>
                            <option value="hold">Hold / pending</option>
                          </Select>
                        </td>
                        <td className="px-2 py-2.5">
                          {d.action === "hold" || !on ? <span className="text-[12.5px] text-ink-muted">Stays in {plan.from.label}</span> : (
                            <Select aria-label={`Destination for ${r.name}`} value={d.target} onChange={(e) => setDecision(r.studentId, { target: e.target.value as Id<"sections"> })} className="h-9">
                              {optionsFor(d.action).length === 0 && <option value="">No {d.action === "repeat" ? "same-class" : "next-class"} section in {targets.year.name}</option>}
                              {optionsFor(d.action).map((s) => <option key={s.sectionId} value={s.sectionId}>{s.label}</option>)}
                            </Select>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {roll ? <Tooltip content="Assigned automatically (alphabetical in the new section)"><span tabIndex={0} className="inline-flex rounded-full focus-visible:outline-none focus-visible:shadow-focus"><BadgeChip>{roll}</BadgeChip></span></Tooltip> : <span className="text-ink-muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {error && <p role="alert" className="px-5 py-3 text-[13px] text-plum">{error}</p>}
        </Card>
      )}

      {from && runs && runs.length > 0 && (
        <Card>
          <CardHeader title="Audit & rollback" description="Promotion runs out of this section. A run can be rolled back until attendance, fees or results are recorded for its students in the new year." icon={<History className="h-4 w-4" />} />
          <ul className="divide-y divide-line/60 px-5 pb-3">
            {runs.map((r) => (
              <li key={r.runId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink"><span className="figures">{r.promoted}</span> promoted · <span className="figures">{r.repeated}</span> repeating → {r.toYear}</p>
                  <p className="text-[12.5px] text-ink-muted"><span className="mono-id">{formatDateTime(new Date(r.createdAt).toISOString())}</span> · by {r.by}{r.rolledBackAt ? ` · rolled back ${formatDateTime(new Date(r.rolledBackAt).toISOString())}` : ""}</p>
                </div>
                {r.status === "rolled_back" ? <Badge tone="neutral">Rolled back</Badge> : r.rollbackBlockedBy ? (
                  <Tooltip content={r.rollbackBlockedBy}><span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:shadow-focus"><Badge tone="sapphire"><ShieldCheck className="h-3 w-3" aria-hidden /> Final</Badge></span></Tooltip>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setRollbackRun(r.runId)}><RotateCcw className="h-4 w-4" /> Roll back</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {plan && targets && !plan.sectionProblem && rows.length > 0 && (
        <div className="sticky bottom-4 z-30">
          <div className="glass-strong spatial flex flex-col gap-3 rounded-2xl bg-white/90 px-4 py-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-ink-soft" aria-live="polite">
              <strong className="figures text-lagoon">{promoteCount}</strong> selected to promote <span className="text-ink-muted">•</span> <strong className="figures text-plum">{repeatCount}</strong> repeating <span className="text-ink-muted">•</span> <strong className="figures text-ink">{holdCount}</strong> on hold
            </p>
            <Button disabled={!moving.length} onClick={() => { setAck(false); setStep(1); }}>Review &amp; confirm promotion</Button>
          </div>
        </div>
      )}

      <Modal
        open={step > 0}
        onOpenChange={(o) => { if (!o && !busy) setStep(0); }}
        title={step === 1 ? "Review the promotion" : "Confirm the promotion"}
        description={plan ? `${plan.from.label} (${plan.from.year}) → ${targets?.year.name ?? ""}` : undefined}
        size="lg"
        footer={step === 1 ? (
          <><Button variant="outline" onClick={() => setStep(0)}>Back to roster</Button><Button onClick={() => setStep(2)}>Continue</Button></>
        ) : (
          <><Button variant="outline" onClick={() => setStep(1)} disabled={busy}>Back</Button><Button loading={busy} disabled={!ack} onClick={run}>Promote {moving.length} student{moving.length === 1 ? "" : "s"}</Button></>
        )}
      >
        {step === 1 ? (
          <div className="space-y-4">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {groups.map((g) => (
                <li key={g.section.sectionId} className="rounded-xl border border-line bg-white p-3 shadow-sm">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink"><BadgeChip>{g.section.label}</BadgeChip>{g.section.kind === "repeat" ? "Repeating" : "Promoted"}</p>
                  <p className="figures mt-1 text-[12.5px] text-ink-muted">{g.count} incoming · {g.section.roster.length + g.count}{g.section.capacity ? `/${g.section.capacity}` : ""} after this run</p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-soft"><strong className="figures">{holdCount}</strong> student(s) stay in {plan?.from.label} on hold.</p>
            {arrears.length > 0 && (
              <div role="note" className="tint-glass rounded-2xl p-3 text-sm" style={{ ["--tint" as string]: "var(--c-purple)" }}>
                <p className="flex items-center gap-2 font-semibold text-plum"><AlertTriangle className="h-4 w-4" aria-hidden /> {arrears.length} student(s) moving with unpaid fees</p>
                <p className="mt-1 text-[12.5px] text-ink-soft">{arrears.slice(0, 6).map((r) => `${r.name} (${rupees(r.fees.outstandingMinor)})`).join(", ")}{arrears.length > 6 ? ` and ${arrears.length - 6} more` : ""}. Balances stay on their {plan?.from.year} ledgers.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              Students leave {plan?.from.label} — that enrollment and its roll number stay in their history — and join their new sections, where roll numbers are assigned alphabetically. This cannot be edited afterwards; it can only be <strong>rolled back</strong> from the audit log, and only until attendance, fees or results are recorded for them in {targets?.year.name}.
            </p>
            <Checkbox label="I have reviewed the destinations, fee warnings and students on hold." checked={ack} onChange={(e) => setAck(e.target.checked)} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!rollbackRun} onOpenChange={(o) => { if (!o) setRollbackRun(null); }} loading={busy} onConfirm={doRollback} tone="danger" confirmLabel="Roll back"
        title="Roll back this promotion?"
        description="The new-year enrollments it created are removed and the students return to their previous section; both rosters are renumbered. The run stays in the audit log."
      />
    </div>
  );
}
