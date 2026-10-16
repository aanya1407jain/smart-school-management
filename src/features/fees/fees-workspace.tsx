"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, CircleDollarSign, Clock, Download, Layers, Plus, Receipt, RotateCcw, Trash2, Users, Wallet } from "lucide-react";
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
import { ChartCard, ChartTooltip, axisProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
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

  // Live Convex queries
  const liveSummary = useSchoolQuery(api.fees.collectionSummary, live ? {} : "skip");
  const liveBalances = useSchoolQuery(api.fees.listBalances, live ? {} : "skip");

  // Demo fallback query
  const q = useQuery(() => (live ? Promise.resolve(null as any) : services.fees.getSummary()), [live]);

  const adaptedLive = useMemo(() => {
    if (!liveSummary || !liveBalances) return undefined;
    const collected = liveSummary.collectedMinor / 100;
    const outstanding = liveSummary.outstandingMinor / 100;
    const net = liveSummary.netMinor / 100;
    const collectionRate = liveSummary.collectionRate;
    const overdue = liveBalances.reduce((a, r) => a + (r.overdueMinor / 100), 0);

    const standingCounts: Record<FeeStanding, number> = { paid: 0, clear: 0, due_soon: 0, overdue: 0, not_assigned: 0 };
    for (const r of liveBalances) {
      if (r.standing === "paid") standingCounts.paid++;
      else if (r.standing === "overdue") standingCounts.overdue++;
      else if (r.standing === "partial") standingCounts.due_soon++;
      else if (r.outstandingMinor === 0) standingCounts.clear++;
      else standingCounts.due_soon++;
    }

    const dueSoon = liveBalances
      .filter((r) => r.standing === "partial" || r.standing === "unpaid")
      .reduce((a, r) => a + (r.outstandingMinor / 100), 0);

    const months = [
      { label: "Apr", amount: 0 },
      { label: "May", amount: 0 },
      { label: "Jun", amount: 0 },
      { label: "Jul", amount: 0 },
      { label: "Aug", amount: 0 },
      { label: "Sep", amount: 0 },
      { label: "Oct", amount: collected },
    ];

    const recentPayments = liveBalances
      .filter((r) => r.lastPaymentOn)
      .slice(0, 6)
      .map((r) => ({
        id: r.studentId,
        studentId: r.studentId,
        studentName: r.name,
        receiptNo: `REC-${r.admissionNo}`,
        method: "upi" as PaymentMethod,
        paidOn: r.lastPaymentOn!,
        amount: r.paidMinor / 100,
      }));

    return {
      totals: {
        gross: net,
        concession: 0,
        net,
        paid: collected,
        outstanding,
        overdue,
        dueSoon,
        collectionRate,
      },
      standing: standingCounts,
      monthly: months,
      recentPayments,
    };
  }, [liveSummary, liveBalances]);

  const queryState = useMemo<QueryState<any>>(
    () => ({
      isLoading: live ? liveSummary === undefined || liveBalances === undefined : q.isLoading,
      isRefreshing: false,
      data: live ? adaptedLive : q.data,
      error: live ? null : q.error,
      refetch: live ? () => {} : q.refetch,
    }),
    [live, liveSummary, liveBalances, adaptedLive, q.isLoading, q.data, q.error, q.refetch]
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
            <ChartCard className="lg:col-span-2" title="Monthly collections" description="Payments received per month, 2026–27">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.monthly} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={52} />
                  <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={{ fill: "rgba(188,197,204,0.18)" }} />
                  <Bar dataKey="amount" name="Collected" fill={CHART.single} radius={[4, 4, 0, 0]} maxBarSize={40} />
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

  const liveBalances = useSchoolQuery(
    api.fees.listBalances,
    live
      ? {
          classId: (classId as Id<"classes">) || undefined,
          sectionId: (sectionId as Id<"sections">) || undefined,
          standing: standing === "all" || !standing ? undefined : (standing as any),
          search: search || undefined,
        }
      : "skip"
  );

  const q = useQuery(
    () => (live ? Promise.resolve([]) : services.fees.listBalances({ search, classId, sectionId, standing: (standing || "all") as FeeStanding | "all" })),
    [live, search, classId, sectionId, standing]
  );

  const liveRows = useMemo(() => {
    if (!liveBalances) return undefined;
    return liveBalances.map((r) => ({
      studentId: r.studentId,
      name: r.name,
      admissionNo: r.admissionNo,
      classLabel: r.classLabel,
      net: r.netMinor / 100,
      paid: r.paidMinor / 100,
      outstanding: r.outstandingMinor / 100,
      overdue: r.overdueMinor / 100,
      standing: r.standing,
      nextDue: r.lastPaymentOn ? { label: "Fee installment", dueDate: r.lastPaymentOn } : null,
      lastPayment: r.lastPaymentOn,
    }));
  }, [liveBalances]);

  const rawRows = live ? (liveRows ?? []) : (q.data ?? []);
  const rows = rawRows.filter((r) => !dueBy || (r.nextDue && r.nextDue.dueDate <= dueBy));
  const total = rows.reduce((a, r) => a + r.outstanding, 0);

  const queryState = useMemo<QueryState<any>>(
    () => ({
      isLoading: live ? liveBalances === undefined : q.isLoading,
      isRefreshing: false,
      data: rows,
      error: live ? null : q.error,
      refetch: live ? () => {} : q.refetch,
    }),
    [live, liveBalances, rows, q.isLoading, q.error, q.refetch]
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

  const q = useQuery(() => (live ? Promise.resolve([]) : services.fees.listStructures()), [live]);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const assign = useMutation(services.fees.assignStructure);

  const liveRows = useMemo(() => {
    if (!liveStructures) return undefined;
    return liveStructures.map((fs) => ({
      id: fs._id,
      name: fs.name,
      classNames: fs.classNames,
      classIds: fs.classIds,
      total: fs.totalMinor / 100,
      components: fs.components.map((c, i) => ({ id: `c-${i}`, label: c.label, amount: c.amountMinor / 100 })),
      installments: fs.installments.map((ins, i) => ({
        id: `ins-${i}`,
        label: ins.label,
        dueDate: ins.dueDate,
        share: fs.totalMinor > 0 ? ins.amountMinor / fs.totalMinor : 0,
      })),
      assignedCount: fs.assignedCount,
      eligibleCount: fs.assignedCount,
    }));
  }, [liveStructures]);

  const rows = live ? (liveRows ?? []) : (q.data ?? []);
  const target = rows.find((s) => s.id === assignId);

  const queryState = useMemo<QueryState<any>>(
    () => ({
      isLoading: live ? liveStructures === undefined : q.isLoading,
      isRefreshing: false,
      data: rows,
      error: live ? null : q.error,
      refetch: live ? () => {} : q.refetch,
    }),
    [live, liveStructures, rows, q.isLoading, q.error, q.refetch]
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
                  {fs.assignedCount < fs.eligibleCount ? <Button size="sm" onClick={() => setAssignId(fs.id)}>Assign to class</Button> : <Badge tone="teal">All assigned</Badge>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      <CreateStructureModal open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setAssignId(id)} />
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
              if (target && (target as any).classIds?.length) {
                let count = 0;
                for (const cid of (target as any).classIds) {
                  const res = await assignStructureMutation({
                    structureId: assignId as Id<"feeStructures">,
                    classId: cid,
                  });
                  count += res.assignedStudents;
                }
                toast({ title: `Assigned to ${count} students`, description: "Students and guardians were notified." });
              }
            } catch (err: any) {
              toast({ title: "Assignment failed", description: err?.message, tone: "error" });
            } finally {
              setAssigning(false);
              setAssignId(null);
            }
          } else {
            const r = await assign.mutate(assignId!);
            if (r) toast({ title: `Assigned to ${r.assigned} students`, description: r.skipped ? `${r.skipped} already had it.` : "Students and guardians were notified." });
            setAssignId(null);
          }
        }}
      />
    </div>
  );
}

function CreateStructureModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const opts = useAcademicOptions();
  const [name, setName] = useState("Transport-free Activity Fee 2026–27");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [components, setComponents] = useState([{ label: "Annual activity fee", amount: 3000 }]);
  const [installments, setInstallments] = useState([{ label: "One-time", dueDate: "2026-11-15", share: 100 }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createStructureMutation = useSchoolMutation(api.fees.createStructure);
  const m = useMutation(services.fees.createStructure);

  const total = components.reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const shares = installments.reduce((a, i) => a + (Number(i.share) || 0), 0);

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
        const res = await createStructureMutation({
          name,
          classIds: classIds as Id<"classes">[],
          components: compPayload,
          installments: insPayload,
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
    <Modal open={open} onOpenChange={onOpenChange} title="New fee structure" description="Define components and how the total is split into installments." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={pending || m.isPending} onClick={submit}>Create structure</Button></>}>
      <div className="space-y-5">
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
                <Input aria-label="Component label" value={c.label} onChange={(e) => setComponents(components.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <Input aria-label="Amount" type="number" min={0} value={c.amount} onChange={(e) => setComponents(components.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                <Button variant="ghost" size="icon" aria-label="Remove component" onClick={() => setComponents(components.filter((_, j) => j !== i))} disabled={components.length === 1}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setComponents([...components, { label: "", amount: 0 }])}><Plus className="h-4 w-4" /> Add component</Button>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[13px] font-medium text-ink-soft">Installments</p><span className={shares === 100 ? "text-sm font-semibold text-lagoon" : "text-sm font-semibold text-plum"}>{shares}% allocated</span></div>
          <div className="space-y-2">
            {installments.map((ins, i) => (
              <div key={i} className="grid grid-cols-[1fr_160px_90px_36px] gap-2">
                <Input aria-label="Installment label" value={ins.label} onChange={(e) => setInstallments(installments.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                <Input aria-label="Due date" type="date" value={ins.dueDate} onChange={(e) => setInstallments(installments.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} />
                <Input aria-label="Share percent" type="number" min={0} max={100} value={ins.share} onChange={(e) => setInstallments(installments.map((x, j) => j === i ? { ...x, share: Number(e.target.value) } : x))} />
                <Button variant="ghost" size="icon" aria-label="Remove installment" onClick={() => setInstallments(installments.filter((_, j) => j !== i))} disabled={installments.length === 1}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setInstallments([...installments, { label: `Installment ${installments.length + 1}`, dueDate: "", share: 0 }])}><Plus className="h-4 w-4" /> Add installment</Button>
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

  // Live Convex query
  const livePayments = useSchoolQuery(
    api.fees.listPayments,
    live
      ? {
          classId: classId ? (classId as Id<"classes">) : undefined,
          method: method || undefined,
          from: from || undefined,
          to: to || undefined,
          search: search || undefined,
        }
      : "skip"
  );

  // Demo fallback query
  const q = useQuery(
    () => (live ? Promise.resolve(null as any) : services.fees.listPayments({ search, classId, method, from: from || undefined, to: to || undefined })),
    [live, search, classId, method, from, to]
  );

  const adaptedLive = useMemo(() => {
    if (!livePayments) return undefined;
    return livePayments.map((p) => ({
      id: p.id,
      paymentId: p.paymentId,
      receiptId: p.receiptId,
      receiptNo: p.receiptNo,
      paidOn: p.paidOn,
      studentId: p.studentId,
      studentName: p.studentName,
      admissionNo: p.admissionNo,
      classId: p.classId ?? "",
      classLabel: p.classLabel,
      method: p.method,
      reference: p.reference,
      amount: p.amountMinor / 100,
      status: p.status,
    }));
  }, [livePayments]);

  const queryState = useMemo<QueryState<any>>(
    () => ({
      isLoading: live ? livePayments === undefined : q.isLoading,
      isRefreshing: false,
      data: live ? adaptedLive : q.data,
      error: live ? null : q.error,
      refetch: live ? () => {} : q.refetch,
    }),
    [live, livePayments, adaptedLive, q.isLoading, q.data, q.error, q.refetch]
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
                {rows.length} payments · <span className="font-semibold text-ink">{formatCurrency(rows.reduce((a: number, p: any) => a + (p.amount || 0), 0))}</span>
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
                { key: "amount", header: "Amount", align: "right", cell: (p: any) => <span className="font-semibold text-ink">{formatCurrency(p.amount)}</span> },
              ]}
              rowActions={(p: any) => <Button size="sm" variant="ghost" onClick={() => setReceiptId(p.receiptId)}><Receipt className="h-4 w-4" /> View</Button>}
            />
          )}
        </QueryView>
      </div>
      <ReceiptModal receiptId={receiptId} onClose={() => setReceiptId(null)} />
    </Card>
  );
}
