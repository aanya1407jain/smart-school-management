"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, CircleDollarSign, Clock, Download, Layers, Pencil, Plus, Receipt, RotateCcw, Trash2, Users, Wallet } from "lucide-react";
import type { FeeStanding } from "@/lib/services/derive";
import type { PaymentMethod } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSession } from "@/features/auth/session-provider";
import {
  Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, FilterBar, FilterSelect, FormField, Input, Modal,
  PageHeader, QueryView, SearchInput, StatCard, StatusBadge, Tabs, TabsContent, TabsList, useToast, Avatar,
} from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { FormError } from "@/features/shared/form-error";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { formatDate, formatShortDate, todayISO } from "@/lib/utils/dates";
import { downloadCsv } from "@/lib/utils/csv";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants/labels";
import { ReceiptModal } from "./fee-tables";
import { StudentPickerModal } from "./student-picker";

export function FeesWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  const [pickerOpen, setPickerOpen] = useState(params.get("action") === "collect");
  useEffect(() => { if (params.get("action") === "collect") setPickerOpen(true); }, [params]);

  return (
    <div>
      <PageHeader
        title="Fees"
        description="Fee structures, student assignments, payments, receipts, concessions and outstanding balances."
        actions={<Button onClick={() => setPickerOpen(true)}><Wallet className="h-4 w-4" /> Collect fee</Button>}
      />
      <Tabs value={tab} onValueChange={(t) => { setTab(t); router.replace(`/admin/fees?tab=${t}`, { scroll: false }); }}>
        <TabsList items={[{ value: "overview", label: "Overview" }, { value: "balances", label: "Student balances" }, { value: "structures", label: "Fee structures" }, { value: "payments", label: "Payments & receipts" }]} />
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="balances"><Balances /></TabsContent>
        <TabsContent value="structures"><Structures /></TabsContent>
        <TabsContent value="payments"><Payments /></TabsContent>
      </Tabs>
      <StudentPickerModal open={pickerOpen} onOpenChange={setPickerOpen} onPick={(id) => router.push(`/admin/fees/${id}?pay=1`)} />
    </div>
  );
}

function Overview() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  // Live: one server aggregate over the school's real fee records (model/feeMath.ts).
  const liveOverview = useSchoolQuery(api.fees.overview, live ? {} : "skip");

  // Demo data
  const q = useQuery(() => services.fees.getSummary(), [live], { enabled: !live });

  const adaptedLive = useMemo(() => {
    if (!liveOverview) return undefined;
    const t = liveOverview.totals;
    return {
      yearLabel: liveOverview.academicYear.name,
      totals: {
        gross: t.grossMinor / 100, concession: t.concessionMinor / 100, net: t.netMinor / 100, paid: t.paidMinor / 100,
        outstanding: t.outstandingMinor / 100, overdue: t.overdueMinor / 100, dueSoon: t.dueSoonMinor / 100, collectionRate: liveOverview.collectionRate,
      },
      standing: liveOverview.standing,
      monthly: liveOverview.monthly.map((m) => ({ label: new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }), amount: m.amountMinor / 100 })),
      recentPayments: liveOverview.recentPayments.map((p) => ({
        id: p.paymentId, studentId: p.studentId, studentName: p.studentName, receiptNo: p.receiptNo ?? "—", method: p.method as PaymentMethod, paidOn: p.paidOn, amount: p.amountMinor / 100,
      })),
    };
  }, [liveOverview]);

  const queryState = useMemo<QueryState<any>>(
    () => (live
      ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} }
      : q),
    [live, adaptedLive, q],
  );

  return (
    <QueryView query={queryState}>
      {(s) => (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Collected this year" value={formatCurrency(s.totals.paid)} icon={<CircleDollarSign className="h-5 w-5" />} hint={`${formatPercent(s.totals.collectionRate, 1)} of net fees`} />
            <StatCard label="Outstanding" value={formatCurrency(s.totals.outstanding)} icon={<Wallet className="h-5 w-5" />} tone="sapphire" hint={`Net fees ${formatCurrency(s.totals.net)}`} />
            <StatCard label="Overdue" value={formatCurrency(s.totals.overdue)} icon={<AlertCircle className="h-5 w-5" />} tone="lavender" hint={`${s.standing.overdue} students`} />
            <StatCard label="Due in 30 days" value={formatCurrency(s.totals.dueSoon)} icon={<Clock className="h-5 w-5" />} tone="purple" hint={`${s.standing.due_soon} students · concessions ${formatCurrency(s.totals.concession)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title="Monthly collections" description={`Payments received per month, ${s.yearLabel ?? "2026–27"}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.monthly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={52} />
                  <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
                  <Bar dataKey="amount" name="Collected" {...barProps("single")} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <Card>
              <CardHeader title="Student standing" description="Where every student's account stands today" />
              <ul className="space-y-2.5 p-5">
                {(["paid", "clear", "due_soon", "overdue"] as FeeStanding[]).map((k) => (
                  <li key={k}>
                    <Link href={`/admin/fees?tab=balances&standing=${k}`} className="flex items-center justify-between rounded-xl border border-line/70 px-3.5 py-2.5 hover:bg-alabaster">
                      <StatusBadge status={k} />
                      <span className="text-sm font-semibold text-ink">{s.standing[k]} students</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card>
            <CardHeader title="Recent payments" action={<Link href="/admin/fees?tab=payments" className="text-[13px] font-medium text-lagoon hover:underline">All payments</Link>} />
            {s.recentPayments.length === 0 && <EmptyState title="No payments yet" description="Payments recorded by the school office appear here." />}
            <ul className="divide-y divide-line/60 px-5 pb-2">
              {s.recentPayments.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <Link href={`/admin/fees/${p.studentId}`} className="flex min-w-0 items-center gap-3 hover:text-lagoon">
                    <Avatar name={p.studentName} size="sm" />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{p.studentName}</span><span className="block text-[12px] text-ink-muted">{p.receiptNo} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method} · {formatShortDate(p.paidOn)}</span></span>
                  </Link>
                  <span className="text-sm font-semibold text-sapphire">{formatCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </QueryView>
  );
}

function Balances() {
  const router = useRouter();
  const params = useSearchParams();
  const opts = useAcademicOptions();
  const { dataSource } = useSession();
  const live = dataSource === "live";

  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [standing, setStanding] = useState<string>(params.get("standing") ?? "");
  const [dueBy, setDueBy] = useState("");

  // Live: balances computed on the server from real fee records; all filters applied there.
  const liveBalances = useSchoolQuery(
    api.fees.listBalances,
    live
      ? {
          classId: (classId as Id<"classes">) || undefined,
          sectionId: (sectionId as Id<"sections">) || undefined,
          standing: (standing || undefined) as FeeStanding | undefined,
          search: search.trim() || undefined,
          dueBy: dueBy || undefined,
        }
      : "skip"
  );

  // Demo data
  const q = useQuery(
    () => services.fees.listBalances({ search, classId, sectionId, standing: (standing || "all") as FeeStanding | "all" }),
    [live, search, classId, sectionId, standing],
    { enabled: !live },
  );

  const liveRows = useMemo(() => {
    if (!liveBalances) return undefined;
    return liveBalances.rows.map((r) => ({
      studentId: r.studentId,
      name: r.name,
      admissionNo: r.admissionNo,
      classLabel: r.classLabel,
      net: r.netMinor / 100,
      paid: r.paidMinor / 100,
      outstanding: r.outstandingMinor / 100,
      overdue: r.overdueMinor / 100,
      standing: r.standing,
      nextDue: r.nextDue ? { label: r.nextDue.label, dueDate: r.nextDue.dueDate } : null,
      lastPayment: r.lastPaymentOn,
    }));
  }, [liveBalances]);

  type BalanceRow = { studentId: string; name: string; admissionNo: string; classLabel: string; net: number; paid: number; outstanding: number; standing: FeeStanding; nextDue: { label: string; dueDate: string } | null; lastPayment: string | null };
  const rows: BalanceRow[] = live ? (liveRows ?? []) : (q.data ?? []).filter((r) => !dueBy || (r.nextDue && r.nextDue.dueDate <= dueBy));
  const total = rows.reduce((a, r) => a + r.outstanding, 0);

  const queryState = useMemo<QueryState<any>>(
    () => (live
      ? { isLoading: liveRows === undefined, isRefreshing: false, data: liveRows, error: null, refetch: () => {} }
      : { ...q, data: q.data === undefined ? undefined : rows }),
    [live, liveRows, rows, q],
  );

  const sectionOptions = useMemo(
    () =>
      (opts.data?.sections ?? [])
        .filter((s) => !classId || s.classId === classId)
        .map((s) => ({ value: s.id, label: classId ? `Section ${s.name}` : `Class ${s.label}` })),
    [opts.data, classId]
  );

  const hasActiveFilters = Boolean(search || classId || sectionId || standing || dueBy);

  const resetFilters = () => {
    setSearch("");
    setClassId("");
    setSectionId("");
    setStanding("");
    setDueBy("");
  };

  const handleExport = () => {
    if (!rows.length) return;
    const selectedClass = opts.data?.classes.find((c) => c.id === classId)?.name.replace(/\s+/g, "_") ?? "all_classes";
    const filename = `student_balances_${selectedClass}_${todayISO()}`;
    const headers = [
      "Student Name",
      "Admission No",
      "Class",
      "Net Fees (INR)",
      "Amount Paid (INR)",
      "Outstanding (INR)",
      "Payment Status",
      "Next Due Date",
      "Last Payment Date",
    ];
    const dataRows = rows.map((r) => [
      r.name,
      r.admissionNo,
      r.classLabel,
      r.net,
      r.paid,
      r.outstanding,
      r.standing,
      r.nextDue?.dueDate ?? "—",
      r.lastPayment ?? "—",
    ]);
    downloadCsv(filename, headers, dataRows);
  };

  return (
    <Card className="p-4 sm:p-5">
      <FilterBar
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-ink-muted">
              {rows.length} students · <span className="font-semibold text-ink">{formatCurrency(total)}</span> outstanding
            </p>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset filters">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!rows.length} aria-label="Export balances to CSV">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Student name or admission no." className="col-span-2 sm:w-64" label="Search student" />
        <FilterSelect
          label="Class"
          value={classId}
          onChange={(val) => {
            setClassId(val);
            setSectionId("");
          }}
          allLabel="All classes"
          options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect label="Section" value={sectionId} onChange={setSectionId} allLabel="All sections" options={sectionOptions} />
        <FilterSelect label="Status" value={standing} onChange={setStanding} allLabel="All statuses" options={[{ value: "overdue", label: "Overdue" }, { value: "due_soon", label: "Due soon" }, { value: "clear", label: "Up to date" }, { value: "paid", label: "Fully paid" }, { value: "not_assigned", label: "Not assigned" }]} />
        <div className="flex items-center gap-2"><label htmlFor="dueby" className="whitespace-nowrap text-[13px] text-ink-muted">Due by</label><Input id="dueby" type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} className="w-40" /></div>
      </FilterBar>
      <div className="mt-5">
        <QueryView query={queryState} loading="table" wrapError={false}>
          {() => (
            <DataTable
              caption="Student fee balances"
              rows={rows}
              getRowId={(r) => r.studentId}
              onRowClick={(r) => router.push(`/admin/fees/${r.studentId}`)}
              empty={
                <EmptyState
                  title="No fee records available"
                  description="No students match these filters."
                  action={
                    hasActiveFilters ? (
                      <Button variant="outline" onClick={resetFilters}>
                        <RotateCcw className="h-4 w-4" /> Reset filters
                      </Button>
                    ) : undefined
                  }
                />
              }
              columns={[
                { key: "student", header: "Student", primary: true, cell: (r) => <div className="flex items-center gap-3"><Avatar name={r.name} size="sm" /><div><p className="font-semibold text-ink">{r.name}</p><p className="font-mono text-[11.5px] text-ink-muted">{r.admissionNo}</p></div></div> },
                { key: "class", header: "Class", cell: (r) => r.classLabel },
                { key: "net", header: "Net fees", align: "right", cell: (r) => formatCurrency(r.net) },
                { key: "paid", header: "Paid", align: "right", cell: (r) => formatCurrency(r.paid) },
                { key: "out", header: "Outstanding", align: "right", cell: (r) => <span className={r.outstanding ? "font-semibold text-ink" : "text-ink-muted"}>{formatCurrency(r.outstanding)}</span> },
                { key: "next", header: "Next due", cell: (r) => r.nextDue ? <span className="text-[13px]">{r.nextDue.label} · {formatShortDate(r.nextDue.dueDate)}</span> : "—" },
                { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.standing} /> },
              ]}
              rowActions={(r) => r.outstanding > 0 ? <Button size="sm" variant="soft" onClick={() => router.push(`/admin/fees/${r.studentId}?pay=1`)}>Record payment</Button> : null}
            />
          )}
        </QueryView>
      </div>
    </Card>
  );
}

function Structures() {
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";

  const liveStructures = useSchoolQuery(api.fees.listStructures, live ? {} : "skip");
  const assignStructureMutation = useSchoolMutation(api.fees.assignStructure);
  const setStatusMutation = useSchoolMutation(api.fees.setStructureStatus);

  const q = useQuery(() => services.fees.listStructures(), [live], { enabled: !live });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StructureEdit | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const assign = useMutation(services.fees.assignStructure);

  const liveRows = useMemo(() => {
    if (!liveStructures) return undefined;
    return liveStructures.map((fs) => ({
      id: fs.structureId as string,
      name: fs.name,
      status: fs.status,
      classNames: fs.classNames,
      classIds: fs.classIds as string[],
      total: fs.totalMinor / 100,
      components: fs.components.map((c, i) => ({ id: `c-${i}`, label: c.label, amount: c.amountMinor / 100 })),
      installments: fs.installments.map((ins, i) => ({ id: `ins-${i}`, label: ins.label, dueDate: ins.dueDate, share: fs.totalMinor > 0 ? ins.amountMinor / fs.totalMinor : 0 })),
      assignedCount: fs.assignedCount,
      eligibleCount: fs.eligibleCount,
      inUse: fs.inUse,
    }));
  }, [liveStructures]);

  const rows = live ? (liveRows ?? []) : (q.data ?? []);
  const target = rows.find((s) => s.id === assignId);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: liveRows === undefined, isRefreshing: false, data: liveRows, error: null, refetch: () => {} } : q),
    [live, liveRows, q],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New fee structure</Button></div>
      <QueryView query={queryState} loading="cards">
        {(structList) => structList.length === 0 ? <Card><EmptyState title="No fee structures" action={<Button onClick={() => setCreateOpen(true)}>Create one</Button>} /></Card> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {structList.map((fs: any) => (
              <Card key={fs.id}>
                <CardHeader title={fs.name} description={fs.classNames.join(", ")} icon={<Layers className="h-4 w-4" />} action={<span className="text-lg font-semibold text-sapphire">{formatCurrency(fs.total)}</span>} />
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Components</p>
                    <ul className="space-y-1 text-sm">{fs.components.map((c: any) => <li key={c.id} className="flex justify-between"><span className="text-ink-soft">{c.label}</span><span className="font-medium text-ink">{formatCurrency(c.amount)}</span></li>)}</ul>
                  </div>
                  <div>
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Installments</p>
                    <ul className="space-y-1 text-sm">{fs.installments.map((i: any) => <li key={i.id} className="flex justify-between"><span className="text-ink-soft">{i.label} · {formatShortDate(i.dueDate)}</span><span className="font-medium text-ink">{Math.round(i.share * 100)}%</span></li>)}</ul>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-line/60 px-5 py-3">
                  <span className="flex items-center gap-1.5 text-[13px] text-ink-muted"><Users className="h-4 w-4" /> Assigned to {fs.assignedCount} of {fs.eligibleCount} students</span>
                  <span className="flex items-center gap-2">
                  {live && fs.status !== "archived" && (
                    <Button size="sm" variant="ghost" aria-label={`Edit ${fs.name}`} onClick={() => setEditing({ id: fs.id, name: fs.name, classIds: fs.classIds, inUse: fs.inUse, components: fs.components.map((c: any) => ({ label: c.label, amount: c.amount })), installments: fs.installments.map((i: any) => ({ label: i.label, dueDate: i.dueDate, share: Math.round(i.share * 10000) / 100 })) })}><Pencil className="h-4 w-4" /> Edit</Button>
                  )}
                  {fs.status === "draft" ? (
                    <Button size="sm" variant="outline" onClick={async () => { try { await setStatusMutation({ structureId: fs.id as Id<"feeStructures">, status: "active" }); toast({ title: "Structure activated", description: "It can now be assigned." }); } catch (e) { toast({ title: "Could not activate", description: (e as Error).message, tone: "error" }); } }}>Activate</Button>
                  ) : fs.status === "archived" ? <Badge>Archived</Badge>
                  : fs.assignedCount < fs.eligibleCount ? <Button size="sm" onClick={() => setAssignId(fs.id)}>Assign to class</Button> : <Badge tone="teal">{fs.eligibleCount ? "All assigned" : "No enrolled students"}</Badge>}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      <CreateStructureModal open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setAssignId(id)} />
      {editing && <CreateStructureModal key={editing.id} open editing={editing} onOpenChange={(o) => !o && setEditing(null)} onCreated={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!assignId}
        onOpenChange={(o) => !o && setAssignId(null)}
        title="Assign fee structure"
        description={target ? `Assign "${target.name}" to every enrolled student in ${target.classNames.join(", ")} who doesn't have it yet? Their installments will appear in their fee ledger and student portal.` : ""}
        confirmLabel="Assign"
        loading={assigning || assign.isPending}
        onConfirm={async () => {
          if (live) {
            setAssigning(true);
            try {
              let assigned = 0;
              let skipped = 0;
              for (const cid of (target as { classIds?: string[] } | undefined)?.classIds ?? []) {
                const res = await assignStructureMutation({ structureId: assignId as Id<"feeStructures">, target: { kind: "class", classId: cid as Id<"classes"> } });
                assigned += res.assigned;
                skipped += res.skipped.length;
              }
              toast({ title: `Assigned to ${assigned} student${assigned === 1 ? "" : "s"}`, description: skipped ? `${skipped} already had it or are not eligible.` : undefined });
            } catch (err) {
              toast({ title: "Assignment failed", description: (err as Error).message, tone: "error" });
            } finally {
              setAssigning(false);
              setAssignId(null);
            }
          } else {
            const r = await assign.mutate(assignId!);
            if (r) toast({ title: `Assigned to ${r.assigned} students`, description: r.skipped ? `${r.skipped} already had it.` : "Students were notified." });
            setAssignId(null);
          }
        }}
      />
    </div>
  );
}

/** A LIVE structure being edited. Amounts/installments are locked once any student has been assigned it (server-enforced too). */
type StructureEdit = { id: string; name: string; classIds: string[]; inUse: boolean; components: { label: string; amount: number }[]; installments: { label: string; dueDate: string; share: number }[] };

function CreateStructureModal({ open, onOpenChange, onCreated, editing }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void; editing?: StructureEdit }) {
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const opts = useAcademicOptions();
  // Demo personas get the sample values; real accounts start from an empty form.
  const [name, setName] = useState(editing ? editing.name : live ? "" : "Transport-free Activity Fee 2026–27");
  const [classIds, setClassIds] = useState<string[]>(editing?.classIds ?? []);
  const [components, setComponents] = useState(editing ? editing.components : live ? [{ label: "", amount: 0 }] : [{ label: "Annual activity fee", amount: 3000 }]);
  const [installments, setInstallments] = useState(editing ? editing.installments : live ? [{ label: "Installment 1", dueDate: "", share: 100 }] : [{ label: "One-time", dueDate: "2026-11-15", share: 100 }]);
  const locked = !!editing?.inUse;
  const updateStructureMutation = useSchoolMutation(api.fees.updateStructure);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createStructureMutation = useSchoolMutation(api.fees.createStructure);
  const m = useMutation(services.fees.createStructure);
  useEffect(() => { if (open) setError(null); }, [open]);

  const total = components.reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const shares = Math.round(installments.reduce((a, i) => a + (Number(i.share) || 0), 0) * 100) / 100;

  const submit = async () => {
    if (live) {
      setError(null);
      setPending(true);
      try {
        const compTotalMinor = components.reduce((sum, c) => sum + Math.round((Number(c.amount) || 0) * 100), 0);
        let allocatedMinor = 0;
        const insPayload = installments.map((ins, idx) => {
          const isLast = idx === installments.length - 1;
          const amt = isLast ? compTotalMinor - allocatedMinor : Math.round(compTotalMinor * ((Number(ins.share) || 0) / 100));
          allocatedMinor += amt;
          return {
            label: ins.label,
            dueDate: ins.dueDate,
            amountMinor: amt,
          };
        });
        const compPayload = components.map((c) => ({
          label: c.label,
          amountMinor: Math.round((Number(c.amount) || 0) * 100),
        }));
        if (editing) {
          if (!locked && shares !== 100) throw new Error("Installment shares must add up to 100%.");
          await updateStructureMutation({
            structureId: editing.id as Id<"feeStructures">,
            name,
            classIds: classIds as Id<"classes">[],
            ...(locked ? {} : { components: compPayload, installments: insPayload }),
          });
          toast({ title: "Fee structure updated" });
          onCreated(editing.id);
          return;
        }
        if (shares !== 100) throw new Error("Installment shares must add up to 100%.");
        const res = await createStructureMutation({
          name,
          classIds: classIds as Id<"classes">[],
          components: compPayload,
          installments: insPayload,
          activate: true,
        });
        if (res?.structureId) {
          toast({ title: "Fee structure created", description: "Now assign it to students." });
          onOpenChange(false);
          onCreated(res.structureId);
        }
      } catch (err: any) {
        setError(err?.message ?? "Failed to create fee structure");
      } finally {
        setPending(false);
      }
    } else {
      const r = await m.mutate({ name, classIds, components, installments: installments.map((i) => ({ ...i, share: i.share / 100 })) });
      if (r) { toast({ title: "Fee structure created", description: "Now assign it to students." }); onOpenChange(false); onCreated(r.id); }
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? "Edit fee structure" : "New fee structure"} description="Define components and how the total is split into installments." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={pending || m.isPending} onClick={submit}>{editing ? "Save changes" : "Create structure"}</Button></>}>
      <div className="space-y-5">
        {locked && <p role="note" className="rounded-lg bg-lavender/30 px-3 py-2 text-[13px] text-ink-soft">Students are already assigned this structure, so amounts and installments are locked. Use a concession, or create a new structure. The name and classes can still change.</p>}
        <FormField label="Name" required error={m.fieldErrors.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-soft">Applies to classes <span className="text-plum">*</span></legend>
          <div className="flex flex-wrap gap-4">{(opts.data?.classes ?? []).map((c) => <Checkbox key={c.id} label={c.name} checked={classIds.includes(c.id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))} />)}</div>
        </fieldset>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[13px] font-medium text-ink-soft">Components</p><span className="text-sm font-semibold text-sapphire">Total {formatCurrency(total)}</span></div>
          <div className="space-y-2">
            {components.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_36px] gap-2">
                <Input aria-label="Component label" disabled={locked} value={c.label} onChange={(e) => setComponents(components.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <Input aria-label="Amount" disabled={locked} type="number" min={0} value={c.amount} onChange={(e) => setComponents(components.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                <Button variant="ghost" size="icon" aria-label="Remove component" onClick={() => setComponents(components.filter((_, j) => j !== i))} disabled={locked || components.length === 1}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setComponents([...components, { label: "", amount: 0 }])}><Plus className="h-4 w-4" /> Add component</Button>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[13px] font-medium text-ink-soft">Installments</p><span className={shares === 100 ? "text-sm font-semibold text-lagoon" : "text-sm font-semibold text-plum"}>{shares}% allocated</span></div>
          <div className="space-y-2">
            {installments.map((ins, i) => (
              <div key={i} className="grid grid-cols-[1fr_160px_90px_36px] gap-2">
                <Input aria-label="Installment label" disabled={locked} value={ins.label} onChange={(e) => setInstallments(installments.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <Input aria-label="Due date" disabled={locked} type="date" value={ins.dueDate} onChange={(e) => setInstallments(installments.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} />
                <Input aria-label="Share percent" disabled={locked} type="number" min={0} max={100} value={ins.share} onChange={(e) => setInstallments(installments.map((x, j) => j === i ? { ...x, share: Number(e.target.value) } : x))} />
                <Button variant="ghost" size="icon" aria-label="Remove installment" onClick={() => setInstallments(installments.filter((_, j) => j !== i))} disabled={locked || installments.length === 1}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setInstallments([...installments, { label: `Installment ${installments.length + 1}`, dueDate: "", share: 0 }])}><Plus className="h-4 w-4" /> Add installment</Button>
          </div>
        </div>
        <FormError error={error ? new Error(error) : m.error} />
      </div>
    </Modal>
  );
}

function Payments() {
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const opts = useAcademicOptions();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [method, setMethod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);

  // Live: payments of the current year with their real receipt numbers (filters applied on the server).
  const livePayments = useSchoolQuery(
    api.fees.listPayments,
    live
      ? {
          classId: classId ? (classId as Id<"classes">) : undefined,
          method: (method || undefined) as PaymentMethod | undefined,
          from: from || undefined,
          to: to || undefined,
          search: search.trim() || undefined,
        }
      : "skip"
  );

  // Demo data
  const q = useQuery(
    () => services.fees.listPayments({ search, classId, method, from: from || undefined, to: to || undefined }),
    [live, search, classId, method, from, to],
    { enabled: !live },
  );

  const adaptedLive = useMemo(() => {
    if (!livePayments) return undefined;
    return livePayments.rows.map((p) => ({
      id: p.paymentId as string,
      paymentId: p.paymentId,
      receiptId: p.receiptId,
      receiptNo: p.receiptNo ?? "—",
      paidOn: p.paidOn,
      studentId: p.studentId,
      studentName: p.studentName,
      admissionNo: p.admissionNo,
      classLabel: p.classLabel,
      method: p.method,
      reference: p.reference ?? "—",
      amount: p.amountMinor / 100,
      reversed: p.reversed,
    }));
  }, [livePayments]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, adaptedLive, q],
  );

  const rows = queryState.data ?? [];
  const hasActiveFilters = Boolean(search || classId || method || from || to);
  const resetFilters = () => {
    setSearch("");
    setClassId("");
    setMethod("");
    setFrom("");
    setTo("");
  };

  const handleExport = () => {
    if (!rows.length) return;
    const filename = `fee-payments-${todayISO()}`;
    const headers = [
      "Receipt No",
      "Date",
      "Student Name",
      "Class",
      "Payment Method",
      "Reference",
      "Amount (INR)",
    ];
    const dataRows = rows.map((p: any) => [
      p.receiptNo,
      p.paidOn,
      p.studentName,
      p.classLabel,
      (PAYMENT_METHOD_LABELS as Record<string, string>)[p.method] ?? p.method,
      p.reference,
      p.amount,
    ]);
    downloadCsv(filename, headers, dataRows);
  };

  return (
    <Card className="p-4 sm:p-5">
      <FilterBar
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {queryState.data && (
              <p className="text-[13px] text-ink-muted">
                {rows.length} payments{livePayments?.truncated ? " (showing the latest)" : ""} · <span className="font-semibold text-ink">{formatCurrency(rows.filter((p: any) => !p.reversed).reduce((a: number, p: any) => a + (p.amount || 0), 0))}</span>
              </p>
            )}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset payment filters">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!rows.length}
              aria-label="Export payments to CSV"
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Student or receipt no." className="col-span-2 sm:w-56" label="Search payments" />
        <FilterSelect label="Class" value={classId} onChange={setClassId} allLabel="All classes" options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Method" value={method} onChange={setMethod} allLabel="All methods" options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))} />
        <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" />
        <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="sm:w-40" />
      </FilterBar>
      <div className="mt-5">
        <QueryView query={queryState} loading="table" wrapError={false}>
          {() => (
            <DataTable
              caption="Payments"
              rows={rows}
              getRowId={(p: any) => p.id}
              empty={
                <EmptyState
                  title="No payments found"
                  description="No payment records match the current filters."
                  action={
                    hasActiveFilters ? (
                      <Button variant="outline" onClick={resetFilters}>
                        <RotateCcw className="h-4 w-4" /> Reset filters
                      </Button>
                    ) : undefined
                  }
                />
              }
              columns={[
                { key: "receipt", header: "Receipt", primary: true, cell: (p: any) => <div><p className="font-mono text-[13px] font-semibold text-ink">{p.receiptNo}</p><p className="text-[12px] text-ink-muted">{formatDate(p.paidOn)}</p></div> },
                { key: "student", header: "Student", cell: (p: any) => <Link href={`/admin/fees/${p.studentId}`} className="hover:text-lagoon"><span className="font-medium text-ink">{p.studentName}</span> <span className="text-[12px] text-ink-muted">· {p.classLabel}</span></Link> },
                { key: "method", header: "Method", cell: (p: any) => (PAYMENT_METHOD_LABELS as Record<string, string>)[p.method] ?? p.method },
                { key: "ref", header: "Reference", cell: (p: any) => <span className="font-mono text-[12.5px]">{p.reference}</span> },
                { key: "amount", header: "Amount", align: "right", cell: (p: any) => <span className={p.reversed ? "font-semibold text-ink-muted line-through" : "font-semibold text-ink"}>{formatCurrency(p.amount)}</span> },
                { key: "state", header: "", cell: (p: any) => (p.reversed ? <Badge tone="lavender">Reversed</Badge> : null) },
              ]}
              rowActions={(p: any) => (p.receiptId ? <Button size="sm" variant="ghost" onClick={() => setReceiptId(p.receiptId)}><Receipt className="h-4 w-4" /> View</Button> : null)}
            />
          )}
        </QueryView>
      </div>
      <ReceiptModal receiptId={receiptId} onClose={() => setReceiptId(null)} />
    </Card>
  );
}
