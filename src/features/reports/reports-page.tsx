"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { AlertCircle, Award, Download, GraduationCap, RotateCcw, Users, Wallet } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSession } from "@/features/auth/session-provider";
import type { FeeStanding } from "@/lib/services/derive";
import {
  Avatar, Badge, Button, Card, CardHeader, DataTable, EmptyState, FilterBar, FilterSelect,
  Input, PageHeader, QueryView, SearchInput, Select, StatCard, StatusBadge, Tabs, TabsContent, TabsList,
} from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { downloadCsv } from "@/lib/utils/csv";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { PAYMENT_METHOD_LABELS } from "@/lib/constants/labels";
import { LiveLowAttendance } from "./low-attendance-live";

export function ReportsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { can, hasModule } = useSession();
  // Tabs follow the server's permissions: school-wide reports need reports:read (attendance also
  // attendance:read:all); finance needs reports:finance or fees:manage (e.g. an accountant-only login).
  const schoolWide = can("reports:read");
  const tabs = [
    // Each report also needs the module its data comes from (module entitlements; the server checks too).
    ...(schoolWide && hasModule("students") ? [{ value: "students", label: "Student statistics" }] : []),
    ...((schoolWide || can("attendance:read:all")) && hasModule("attendance") ? [{ value: "attendance", label: "Attendance" }] : []),
    ...((can("reports:finance") || can("fees:manage")) && hasModule("finance") ? [{ value: "fees", label: "Fees" }] : []),
    ...(schoolWide && hasModule("academics") ? [{ value: "exams", label: "Examination performance" }, { value: "academic", label: "Academic performance" }] : []),
  ];
  const allowed = new Set(tabs.map((t) => t.value));
  const fallback = tabs[0]?.value ?? "students";
  const [tab, setTabState] = useState(params.get("tab") ?? fallback);
  const setTab = (t: string) => setTabState(allowed.has(t) ? t : fallback);
  useEffect(() => { const t = params.get("tab"); if (t) setTabState(allowed.has(t) ? t : fallback); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = allowed.has(tab) ? tab : fallback;
  return (
    <div>
      <PageHeader title="Reports" description="Every figure and chart is computed live from school records — change the data and the reports follow." />
      <Tabs value={current} onValueChange={(t) => { setTab(t); router.replace(`/admin/reports?tab=${t}`, { scroll: false }); }}>
        <TabsList items={tabs} />
        {allowed.has("students") && <TabsContent value="students"><StudentStats /></TabsContent>}
        {allowed.has("attendance") && <TabsContent value="attendance"><AttendanceReport /></TabsContent>}
        {allowed.has("fees") && <TabsContent value="fees"><FeeReport /></TabsContent>}
        {allowed.has("exams") && <TabsContent value="exams"><ExamReport /></TabsContent>}
        {allowed.has("academic") && <TabsContent value="academic"><AcademicReport /></TabsContent>}
      </Tabs>
    </div>
  );
}

const pctTick = (v: number) => `${v}%`;
const barCursor = { fill: "rgba(188,197,204,0.18)" };

function StudentStats() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  // Live: enrolled-student statistics computed on the server from the school's records.
  const liveStats = useSchoolQuery(api.reports.studentStatistics, live ? {} : "skip");
  const q = useQuery(() => services.reports.getStudentStatistics(), [live], { enabled: !live });

  const adaptedLive = useMemo(() => {
    if (!liveStats) return undefined;
    return {
      total: liveStats.total,
      status: liveStats.status,
      bySection: liveStats.bySection.map((s) => ({ label: s.label, students: s.students, capacity: s.capacity })),
      parentContacts: liveStats.parentContacts,
      byClass: liveStats.byClass.map((c) => ({ name: c.name, male: c.male, female: c.female, total: c.total })),
    };
  }, [liveStats]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, adaptedLive, q],
  );

  return (
    <QueryView query={queryState}>
      {(d) => (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Enrolled students" value={d.total} icon={<GraduationCap className="h-5 w-5" />} hint={`${d.status?.active ?? d.total} active`} />
            <StatCard label="Sections" value={d.bySection.length} icon={<Users className="h-5 w-5" />} tone="sapphire" hint={`Avg ${(d.total / Math.max(1, d.bySection.length)).toFixed(1)} per section`} />
            <StatCard label="Parent contacts" value={d.parentContacts} icon={<Users className="h-5 w-5" />} tone="purple" hint="Contact records linked to enrolled students" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Students by class" description="Split by gender">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.byClass} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="female" name="Girls" stackId="g" fill={CHART.primary} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="male" name="Boys" stackId="g" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Section strength" description="Students per section (capacity 40)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bySection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="label" {...axisProps} interval={0} fontSize={11} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Bar dataKey="students" name="Students" fill={CHART.single} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}
    </QueryView>
  );
}

function AttendanceReport() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  // Live: register totals per month and per section (this academic year, school-local dates).
  // Per-student bands are not computed for live data (shown as such); the below-threshold list is LiveLowAttendance.
  const liveAtt = useSchoolQuery(api.reports.attendanceReport, live ? {} : "skip");
  const q = useQuery(() => services.reports.getAttendanceReport(), [live], { enabled: !live });

  const adaptedLive = useMemo(() => {
    if (!liveAtt) return undefined;
    return {
      monthly: liveAtt.monthly.filter((m) => m.percentage !== null).map((m) => ({
        month: new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }),
        percentage: m.percentage as number, late: m.late, absent: m.absent,
      })),
      bySection: liveAtt.bySection.filter((s) => s.percentage !== null).map((s) => ({ label: s.label, percentage: s.percentage as number })),
      bands: null,
      lowAttendance: null,
      threshold: liveAtt.threshold,
    };
  }, [liveAtt]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, adaptedLive, q],
  );

  return (
    <QueryView query={queryState}>
      {(d) => (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Monthly attendance" description={`School-wide · dashed line = ${d.threshold}% requirement`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis domain={live ? [0, 100] : [80, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} />
                  <ReferenceLine y={d.threshold} stroke={CHART.highlight} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="percentage" name="Attendance" stroke={CHART.single} strokeWidth={2} dot={{ r: 4, fill: CHART.single, stroke: "#fff", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            {d.bands === null ? (
              <Card className="p-6"><EmptyState title="Attendance bands per student" description="Per-student attendance bands are not calculated for live school data yet. Section and monthly figures are complete." /></Card>
            ) : (
            <ChartCard title="Students by attendance band" description="How many students fall in each range">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bands} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="band" {...axisProps} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Bar dataKey="students" name="Students" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}
          </div>
          <ChartCard title="Attendance by section" description="Year to date" height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.bySection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART_GRID} />
                <XAxis dataKey="label" {...axisProps} interval={0} fontSize={11} />
                <YAxis domain={live ? [0, 100] : [80, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
                <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                <Bar dataKey="percentage" name="Attendance" fill={CHART.single} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          {live && <LiveLowAttendance />}
          {d.lowAttendance !== null && <Card>
            <CardHeader title={`Students below ${d.threshold}%`} description="Follow up with these students and their parents" />
            <div className="p-5">
              <DataTable rows={d.lowAttendance as any[]} getRowId={(s: any) => s.id} empty={<EmptyState title="No students below the threshold" />}
                columns={[
                  { key: "n", header: "Student", primary: true, cell: (s: any) => <Link href={`/admin/students/${s.id}`} className="flex items-center gap-2.5 hover:text-lagoon"><Avatar name={s.name} size="sm" /><span className="font-semibold text-ink">{s.name}</span></Link> },
                  { key: "c", header: "Class", cell: (s: any) => s.classLabel },
                  { key: "a", header: "Absent days", cell: (s: any) => s.absent },
                  { key: "p", header: "Attendance", align: "right", cell: (s: any) => <span className="font-semibold text-plum">{formatPercent(s.percentage, 1)}</span> },
                ]} />
            </div>
          </Card>}
        </div>
      )}
    </QueryView>
  );
}

function FeeReport() {
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
  const liveByClass = useSchoolQuery(api.reports.feeSummary, live ? {} : "skip");
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
  const q = useQuery(() => services.fees.getSummary(), [live], { enabled: !live });
  const payments = useQuery(() => services.fees.listPayments({}), [live], { enabled: !live });
  const balances = useQuery(
    () =>
      services.fees.listBalances({
        search,
        classId,
        sectionId,
        academicYearId: academicYearId || undefined,
        standing: (standing || "all") as FeeStanding | "all",
      }),
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
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={52} />
                  <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="collected" name="Collected" stackId="f" fill={CHART.primary} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="outstanding" name="Outstanding" stackId="f" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={40} stroke="#fff" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Collections by payment method">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMethod} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_GRID} />
                  <XAxis type="number" {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="method" {...axisProps} width={96} />
                  <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
                  <Bar dataKey="amount" name="Collected" fill={CHART.single} radius={[0, 4, 4, 0]} maxBarSize={24} />
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

function ExamReport() {
  const { dataSource } = useSession();
  if (dataSource === "live") return <LiveExamReport />;
  return <DemoExamReport />;
}

/** Live: published examinations only, from the result snapshots written at publication. */
function LiveExamReport() {
  const exams = useSchoolQuery(api.exams.list, {});
  const published = useMemo(() => (exams ?? []).filter((e) => e.status === "published"), [exams]);
  const [examId, setExamId] = useState<string>("");
  const selected = examId || published[0]?.examId || "";
  const perf = useSchoolQuery(api.reports.examPerformance, selected ? { examId: selected as Id<"exams"> } : "skip");
  if (exams === undefined || (selected && perf === undefined)) return <Card className="p-6"><p className="text-sm text-ink-muted">Loading examination results…</p></Card>;
  if (!selected || !perf) return <Card><EmptyState title="No published examination results yet" description="Results appear here once an examination's results are published." /></Card>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Examination" value={selected} onChange={(e) => setExamId(e.target.value)} className="w-64">{published.map((e) => <option key={e.examId} value={e.examId}>{e.name}</option>)}</Select>
        <p className="text-sm text-ink-muted">{perf.students} students · average <span className="font-semibold text-ink">{perf.averagePercentage === null ? "—" : formatPercent(perf.averagePercentage, 1)}</span> · pass rate <span className="font-semibold text-ink">{perf.passRate === null ? "—" : formatPercent(perf.passRate, 1)}</span></p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Average by section" description="Percentage of total marks">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perf.sections.map((x) => ({ name: x.section, average: x.averagePercentage ?? 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART_GRID} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis domain={[0, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
              <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
              <Bar dataKey="average" name="Average" fill={CHART.single} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card>
          <CardHeader title="Subjects" description="Average and pass rate per subject" />
          <div className="p-5">
            <DataTable rows={perf.subjects} getRowId={(x) => x.subjectId} empty={<EmptyState title="No subject results" />}
              columns={[
                { key: "s", header: "Subject", primary: true, cell: (x) => x.subject },
                { key: "a", header: "Average", align: "right", cell: (x) => (x.averagePercentage === null ? "—" : formatPercent(x.averagePercentage, 1)) },
                { key: "p", header: "Pass rate", align: "right", cell: (x) => (x.passRate === null ? "—" : formatPercent(x.passRate, 1)) },
                { key: "n", header: "Students", align: "right", cell: (x) => x.students },
              ]} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function DemoExamReport() {
  const [examId, setExamId] = useState<string | undefined>(undefined);
  const q = useQuery(() => services.reports.getExamPerformance(examId), [examId]);
  return (
    <QueryView query={q}>
      {(d) => !d.exam ? <Card><EmptyState title="No examination data yet" /></Card> : (
        <div className="space-y-5">
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Select aria-label="Examination" value={d.exam.id} onChange={(e) => setExamId(e.target.value)} className="w-64">{d.exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
              <StatusBadge status={d.exam.status} />
            </div>
            <p className="text-sm text-ink-muted">Pass rate <span className="font-semibold text-ink">{formatPercent(d.passRate, 1)}</span>{d.exam.status !== "published" && " · includes unpublished marks"}</p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Average by class" description="Class average vs highest score">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.byClass} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis domain={[0, 100]} {...axisProps} tickFormatter={pctTick} width={46} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="average" name="Average" fill={CHART.primary} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="highest" name="Highest" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Grade distribution" description="Students by overall grade">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.gradeDistribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="grade" {...axisProps} />
                  <YAxis {...axisProps} width={32} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                  <Bar dataKey="students" name="Students" fill={CHART.single} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Subject averages" description="All classes combined">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bySubject} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={CHART_GRID} />
                  <XAxis type="number" domain={[0, 100]} {...axisProps} tickFormatter={pctTick} />
                  <YAxis type="category" dataKey="subject" {...axisProps} width={118} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                  <Bar dataKey="average" name="Average" fill={CHART.secondary} radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <Card>
              <CardHeader title="Top performers" description={d.exam.name} />
              <ol className="space-y-2.5 p-5">
                {d.toppers.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-sapphire text-[12px] font-semibold text-white">{i + 1}</span>
                    <Avatar name={t.name} size="sm" />
                    <Link href={`/admin/students/${t.id}`} className="min-w-0 flex-1 hover:text-lagoon"><p className="truncate text-sm font-semibold text-ink">{t.name}</p><p className="text-[12px] text-ink-muted">Class {t.classLabel}</p></Link>
                    <Badge tone="lavender">{t.grade}</Badge>
                    <span className="w-14 text-right text-sm font-semibold text-sapphire">{formatPercent(t.percentage, 1)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      )}
    </QueryView>
  );
}

function AcademicReport() {
  const { dataSource } = useSession();
  if (dataSource === "live") {
    return <Card><EmptyState title="Academic trend not available yet" description="The exam-over-exam subject trend is not calculated for live school data yet. Use Examination performance for published results." /></Card>;
  }
  return <DemoAcademicReport />;
}

function DemoAcademicReport() {
  const q = useQuery(() => services.reports.getAcademicTrend(), []);
  const subjects = ["Mathematics", "Science", "English", "Computer Science", "Social Science", "Hindi"];
  return (
    <QueryView query={q}>
      {(rows) => rows.length < 1 ? <Card><EmptyState title="Not enough exam data" /></Card> : (
        <div className="space-y-5">
          <p className="text-sm text-ink-muted">Subject averages across examinations this year — one small chart per subject so every line stays readable.</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {subjects.filter((s) => s in rows[0]).map((s) => {
              const data = rows.map((r) => ({ exam: String(r.exam).replace(" Examination", ""), value: Number(r[s]) }));
              const last = data[data.length - 1]?.value ?? 0;
              const first = data[0]?.value ?? 0;
              return (
                <ChartCard key={s} title={s} description={data.length > 1 ? `${last >= first ? "+" : ""}${(last - first).toFixed(1)} pts since ${data[0].exam}` : data[0]?.exam} height={170}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={CHART_GRID} />
                      <XAxis dataKey="exam" {...axisProps} fontSize={11} />
                      <YAxis domain={[50, 90]} {...axisProps} tickFormatter={pctTick} width={42} />
                      <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} />
                      <Line type="monotone" dataKey="value" name="Average" stroke={CHART.single} strokeWidth={2} dot={{ r: 4, fill: CHART.single, stroke: "#fff", strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              );
            })}
          </div>
        </div>
      )}
    </QueryView>
  );
}
