"use client";
/**
 * Reports → Fees (Fees; contributed to the Core reports page).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, Award, Download, RotateCcw, Wallet } from "lucide-react";
import { requireDemo } from "@/lib/demo/runtime";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSession } from "@/features/auth/session-provider";
import type { FeeStanding } from "@/types/fees";
import { Avatar, Button, Card, CardHeader, DataTable, EmptyState, FilterBar, FilterSelect, Input, QueryView, SearchInput, StatCard, StatusBadge } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { CHART_GRID } from "@/lib/constants/theme";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { downloadCsv } from "@/lib/utils/csv";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { PAYMENT_METHOD_LABELS } from "@/features/fees/labels";

const pctTick = (v: number) => `${v}%`;

export function FeeReport() {
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const opts = useAcademicOptions();
  const [search, setSearch] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [standing, setStanding] = useState<string>("");
  const [paidFrom, setPaidFrom] = useState("");
  const [paidTo, setPaidTo] = useState("");

  // Live: the same server aggregates as the Fees workspace (one shared ledger calculation).
  const liveOverview = useSchoolQuery(api.fees.overview, live ? {} : "skip");
  const liveByClass = useSchoolQuery(api.feeReports.feeSummary, live ? {} : "skip");
  const liveMethods = useSchoolQuery(
    api.fees.collectionSummary,
    live && liveOverview ? { from: liveOverview.academicYear.startDate, to: liveOverview.today < liveOverview.academicYear.endDate ? liveOverview.today : liveOverview.academicYear.endDate } : "skip",
  );
  const liveBalances = useSchoolQuery(
    api.fees.listBalances,
    live
      ? {
          search: search.trim() || undefined,
          academicYearId: (academicYearId || undefined) as Id<"academicYears"> | undefined,
          classId: (classId || undefined) as Id<"classes"> | undefined,
          sectionId: (sectionId || undefined) as Id<"sections"> | undefined,
          standing: (standing || undefined) as FeeStanding | undefined,
        }
      : "skip"
  );

  // Demo data
  const q = useQuery(() => requireDemo().data("fees.summary") as Promise<any>, [live], { enabled: !live }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const payments = useQuery(() => requireDemo().data("fees.payments") as Promise<any[]>, [live], { enabled: !live }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const balances = useQuery(
    () =>
      requireDemo().data("fees.balances", {
        search,
        classId,
        sectionId,
        academicYearId: academicYearId || undefined,
        standing: (standing || "all") as FeeStanding | "all",
      }) as Promise<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    [live, search, classId, sectionId, academicYearId, standing],
    { enabled: !live },
  );

  interface FeeReportRow {
    id: string;
    studentId: string;
    name: string;
    admissionNo: string;
    classLabel: string;
    net: number;
    paid: number;
    outstanding: number;
    overdue: number;
    standing: any;
    lastPayment?: string | null;
  }

  const liveRows = useMemo<FeeReportRow[] | undefined>(() => {
    if (!liveBalances) return undefined;
    return liveBalances.rows.map((r) => ({
      id: r.studentId,
      studentId: r.studentId,
      name: r.name,
      admissionNo: r.admissionNo,
      classLabel: r.classLabel,
      net: r.netMinor / 100,
      paid: r.paidMinor / 100,
      outstanding: r.outstandingMinor / 100,
      overdue: r.overdueMinor / 100,
      standing: r.standing,
      lastPayment: r.lastPaymentOn,
    }));
  }, [liveBalances]);

  const rawBalancesData: FeeReportRow[] | undefined = (live ? liveRows : (balances.data as any)) as FeeReportRow[] | undefined;

  const sectionOptions = useMemo(
    () =>
      (opts.data?.sections ?? [])
        .filter((s) => !classId || s.classId === classId)
        .map((s) => ({ value: s.id, label: classId ? `Section ${s.name}` : `Class ${s.label}` })),
    [opts.data, classId]
  );

  const filteredRows: FeeReportRow[] = useMemo(() => {
    let rows: FeeReportRow[] = rawBalancesData ?? [];
    if (paidFrom) {
      rows = rows.filter((r) => r.lastPayment && r.lastPayment >= paidFrom);
    }
    if (paidTo) {
      rows = rows.filter((r) => r.lastPayment && r.lastPayment <= paidTo);
    }
    return rows;
  }, [rawBalancesData, paidFrom, paidTo]);

  const hasActiveFilters = Boolean(
    search || academicYearId || classId || sectionId || standing || paidFrom || paidTo
  );

  const resetFilters = () => {
    setSearch("");
    setAcademicYearId("");
    setClassId("");
    setSectionId("");
    setStanding("");
    setPaidFrom("");
    setPaidTo("");
  };

  const filteredTotals = useMemo(() => {
    const net = filteredRows.reduce((a: number, r: FeeReportRow) => a + r.net, 0);
    const paid = filteredRows.reduce((a: number, r: FeeReportRow) => a + r.paid, 0);
    const outstanding = filteredRows.reduce((a: number, r: FeeReportRow) => a + r.outstanding, 0);
    const overdue = filteredRows.reduce((a: number, r: FeeReportRow) => a + r.overdue, 0);
    const collectionRate = net > 0 ? (paid / net) * 100 : 0;
    return { net, paid, outstanding, overdue, collectionRate };
  }, [filteredRows]);

  const adaptedSummary = useMemo(() => {
    if (!liveOverview || !liveByClass) return undefined;
    const t = liveOverview.totals;
    return {
      totals: {
        paid: t.paidMinor / 100, outstanding: t.outstandingMinor / 100, net: t.netMinor / 100, concession: t.concessionMinor / 100,
        collectionRate: liveOverview.collectionRate, overdue: t.overdueMinor / 100, dueSoon: t.dueSoonMinor / 100,
      },
      standing: liveOverview.standing,
      byClass: liveByClass.classes.map((c) => ({ name: c.className, collected: c.paidMinor / 100, outstanding: c.outstandingMinor / 100 })),
    };
  }, [liveOverview, liveByClass]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedSummary === undefined, isRefreshing: false, data: adaptedSummary, error: null, refetch: () => {} } : q),
    [live, adaptedSummary, q],
  );

  const byMethod = useMemo(
    () => {
      const record: Record<string, number> = {};
      if (live) {
        for (const [m, minor] of Object.entries(liveMethods?.byMethod ?? {})) record[m] = minor / 100;
      } else {
        for (const p of payments.data ?? []) record[p.method] = (record[p.method] ?? 0) + Number(p.amount || 0);
      }
      return Object.entries(record)
        .map(([m, amount]) => ({
          method: PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount);
    },
    [live, liveMethods, payments.data]
  );

  const handleExportCsv = () => {
    if (!filteredRows.length) return;
    const selectedClassLabel = opts.data?.classes.find((c) => c.id === classId)?.name.replace(/\s+/g, "_") ?? "all_classes";
    const filename = `fee_collection_report_${selectedClassLabel}_${todayISO()}`;
    const headers = [
      "Student Name",
      "Admission No",
      "Class",
      "Net Fees (INR)",
      "Amount Paid (INR)",
      "Outstanding (INR)",
      "Payment Status",
      "Last Payment Date",
    ];
    const dataRows = filteredRows.map((r) => [
      r.name,
      r.admissionNo,
      r.classLabel,
      r.net,
      r.paid,
      r.outstanding,
      r.standing,
      r.lastPayment ?? "—",
    ]);
    downloadCsv(filename, headers, dataRows);
  };

  return (
    <QueryView query={queryState}>
      {(s) => (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={hasActiveFilters ? "Filtered Net Fees" : "Net fees"}
              value={formatCurrency(hasActiveFilters ? filteredTotals.net : s.totals.net)}
              icon={<Award className="h-5 w-5" />}
              hint={hasActiveFilters ? `${filteredRows.length} matching students` : `Concessions ${formatCurrency(s.totals.concession)}`}
            />
            <StatCard
              label={hasActiveFilters ? "Filtered Collected" : "Collected"}
              value={formatCurrency(hasActiveFilters ? filteredTotals.paid : s.totals.paid)}
              icon={<Award className="h-5 w-5" />}
              tone="sapphire"
              hint={`${formatPercent(hasActiveFilters ? filteredTotals.collectionRate : s.totals.collectionRate, 1)} collection rate`}
            />
            <StatCard
              label={hasActiveFilters ? "Filtered Outstanding" : "Outstanding"}
              value={formatCurrency(hasActiveFilters ? filteredTotals.outstanding : s.totals.outstanding)}
              icon={<Wallet className="h-5 w-5" />}
              tone="purple"
            />
            <StatCard
              label={hasActiveFilters ? "Filtered Overdue" : "Overdue"}
              value={formatCurrency(hasActiveFilters ? filteredTotals.overdue : s.totals.overdue)}
              icon={<AlertCircle className="h-5 w-5" />}
              tone="lavender"
              hint={hasActiveFilters ? undefined : `${s.standing.overdue} students`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Collected vs outstanding by class">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.byClass} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={52} />
                  <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="collected" name="Collected" stackId="f" {...barProps("collected", { top: false })} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="outstanding" name="Outstanding" stackId="f" {...barProps("outstanding")} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Collections by payment method">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMethod} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeDasharray="3 3" />
                  <XAxis type="number" {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="method" {...axisProps} width={96} />
                  <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
                  <Bar dataKey="amount" name="Collected" {...barProps("single", { horizontal: true })} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <Card className="p-4 sm:p-5">
            <CardHeader
              title="Student Fee Ledger & Collection Report"
              description="Filter by academic year, class, standing, and payment dates. Export report data to CSV."
              action={
                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset filters">
                      <RotateCcw className="h-4 w-4" /> Reset
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCsv}
                    disabled={filteredRows.length === 0}
                    aria-label="Export filtered fee report to CSV"
                  >
                    <Download className="h-4 w-4" /> Export CSV
                  </Button>
                </div>
              }
            />

            <div className="mt-4">
              <FilterBar
                actions={
                  <p className="text-[13px] text-ink-muted">
                    {filteredRows.length} record{filteredRows.length === 1 ? "" : "s"} ·{" "}
                    <span className="font-semibold text-ink">{formatCurrency(filteredTotals.outstanding)}</span>{" "}
                    outstanding
                  </p>
                }
              >
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Student name or admission no."
                  className="col-span-2 sm:w-60"
                  label="Search student"
                />
                <FilterSelect
                  label="Academic year"
                  value={academicYearId}
                  onChange={setAcademicYearId}
                  allLabel="All academic years"
                  options={(opts.data?.years ?? []).map((y) => ({ value: y.id, label: y.name }))}
                />
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
                <FilterSelect
                  label="Section"
                  value={sectionId}
                  onChange={setSectionId}
                  allLabel="All sections"
                  options={sectionOptions}
                />
                <FilterSelect
                  label="Status"
                  value={standing}
                  onChange={setStanding}
                  allLabel="All statuses"
                  options={[
                    { value: "overdue", label: "Overdue" },
                    { value: "due_soon", label: "Due soon" },
                    { value: "clear", label: "Up to date" },
                    { value: "paid", label: "Fully paid" },
                    { value: "not_assigned", label: "Not assigned" },
                  ]}
                />
                <div className="flex items-center gap-1.5">
                  <label htmlFor="paid-from" className="whitespace-nowrap text-[12.5px] text-ink-muted">
                    Paid from
                  </label>
                  <Input
                    id="paid-from"
                    type="date"
                    value={paidFrom}
                    onChange={(e) => setPaidFrom(e.target.value)}
                    className="w-36 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="paid-to" className="whitespace-nowrap text-[12.5px] text-ink-muted">
                    Paid to
                  </label>
                  <Input
                    id="paid-to"
                    type="date"
                    value={paidTo}
                    onChange={(e) => setPaidTo(e.target.value)}
                    className="w-36 text-xs"
                  />
                </div>
              </FilterBar>
            </div>

            <div className="mt-5">
              <QueryView query={balances} loading="table" wrapError={false}>
                {() =>
                  filteredRows.length === 0 ? (
                    <EmptyState
                      title="No fee records match the selected filters"
                      description="Try clearing or adjusting your search, class, status, or date range filters."
                      action={
                        hasActiveFilters ? (
                          <Button variant="outline" onClick={resetFilters}>
                            <RotateCcw className="h-4 w-4" /> Reset all filters
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <DataTable
                      caption="Student fee report"
                      rows={filteredRows}
                      getRowId={(r: FeeReportRow) => r.studentId}
                      columns={[
                        {
                          key: "student",
                          header: "Student",
                          primary: true,
                          cell: (r: FeeReportRow) => (
                            <div className="flex items-center gap-3">
                              <Avatar name={r.name} size="sm" />
                              <div>
                                <p className="font-semibold text-ink">{r.name}</p>
                                <p className="font-mono text-[11.5px] text-ink-muted">{r.admissionNo}</p>
                              </div>
                            </div>
                          ),
                        },
                        { key: "class", header: "Class", cell: (r: FeeReportRow) => r.classLabel },
                        { key: "net", header: "Net fees", align: "right", cell: (r: FeeReportRow) => formatCurrency(r.net) },
                        { key: "paid", header: "Amount paid", align: "right", cell: (r: FeeReportRow) => formatCurrency(r.paid) },
                        {
                          key: "outstanding",
                          header: "Outstanding",
                          align: "right",
                          cell: (r: FeeReportRow) => (
                            <span
                              className={
                                r.overdue > 0
                                  ? "font-semibold text-plum"
                                  : r.outstanding > 0
                                  ? "font-semibold text-ink"
                                  : "text-ink-muted"
                              }
                            >
                              {formatCurrency(r.outstanding)}
                            </span>
                          ),
                        },
                        { key: "status", header: "Status", cell: (r: FeeReportRow) => <StatusBadge status={r.standing} /> },
                        {
                          key: "lastPayment",
                          header: "Last payment",
                          cell: (r: FeeReportRow) => (r.lastPayment ? formatDate(r.lastPayment) : "—"),
                        },
                      ]}
                      rowActions={(r: FeeReportRow) => (
                        <Link
                          href={`/admin/fees/${r.studentId}`}
                          className="inline-flex items-center text-[12.5px] font-medium text-lagoon hover:underline"
                        >
                          View ledger →
                        </Link>
                      )}
                    />
                  )
                }
              </QueryView>
            </div>
          </Card>
        </div>
      )}
    </QueryView>
  );
}
