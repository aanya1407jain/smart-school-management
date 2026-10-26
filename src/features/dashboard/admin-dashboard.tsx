"use client";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookOpenCheck, CalendarCheck2, ClipboardCheck, GraduationCap, Megaphone, UserPlus, Users, Wallet, ArrowRight, CalendarClock, AlertCircle } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useSession } from "@/features/auth/session-provider";
import { AlertPill, Button, CardHeader, GlassCard, Card, QueryView, StatCard, StatusBadge, ProgressBar, EmptyState, LinkButton } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps, barCursor, barProps, gridProps } from "@/components/charts/chart-card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils/format";
import { formatDate, formatShortDate, greeting, formatLongDate, todayISO } from "@/lib/utils/dates";
import { NoticeListItem } from "@/features/notices/notice-list-item";
import { useMemo } from "react";
import type { ModuleKey } from "@convex/core/modules";
import type { StudentAchievement } from "@/types/domain";
import { StudentAchievementsCard } from "./student-achievements";

const QUICK_ACTIONS: { label: string; href: string; Icon: typeof UserPlus; module: ModuleKey }[] = [
  { label: "Add student", href: "/admin/students/new", Icon: UserPlus, module: "students" },
  { label: "Review attendance", href: "/admin/attendance", Icon: CalendarCheck2, module: "attendance" },
  { label: "Collect fee", href: "/admin/fees?action=collect", Icon: Wallet, module: "finance" },
  { label: "Create examination", href: "/admin/examinations?action=new", Icon: BookOpenCheck, module: "academics" },
  { label: "Post notice", href: "/admin/notices?action=new", Icon: Megaphone, module: "administration" },
];

type AdminDashboardData = NonNullable<Awaited<ReturnType<typeof services.dashboard.getAdminDashboard>>>;

export function AdminDashboard() {
  const { user, dataSource, hasModule } = useSession();
  const live = dataSource === "live";
  // Panels follow the school's module entitlements (the server also leaves a disabled module's data out).
  const S = hasModule("students"), A = hasModule("attendance"), AC = hasModule("academics"), F = hasModule("finance"), AD = hasModule("administration");

  // Live: one server aggregate from the school's records. Sections the caller may not see come back null.
  const liveData = useSchoolQuery(api.reports.adminDashboard, live ? {} : "skip");

  // Demo data
  const q = useQuery(() => services.dashboard.getAdminDashboard(), [live], { enabled: !live });
  // The student total always follows the Students page's rule and records (academics.studentCounts):
  // admissions are written to Convex for every admin, demo personas included.
  const counts = useSchoolQuery(api.academics.studentCounts, live || !S ? "skip" : {});

  const adaptedLive = useMemo(() => {
    if (!liveData?.overview) return undefined;
    const o = liveData.overview;
    const f = liveData.fees;
    const today = liveData.today;
    return {
      school: { ...liveData.school },
      stats: {
        students: o.students,
        sections: o.sections,
        teachers: o.teachers,
        teachersOnLeave: o.teachersOnLeave,
        attendance: o.attendance ?? { date: today, isToday: true, percentage: null, absent: 0, marked: 0, totalSections: o.sections, delta: null },
        fees: {
          outstanding: (f?.outstandingMinor ?? 0) / 100,
          overdue: (f?.overdueMinor ?? 0) / 100,
          overdueStudents: f?.overdueStudents ?? 0,
          collected: (f?.collectedMinor ?? 0) / 100,
          collectionRate: f?.collectionRate ?? 0,
        },
      },
      attendanceTrend: o.attendanceTrend.filter((p) => p.percentage !== null).map((p) => ({ date: p.date, percentage: p.percentage as number, ...("counted" in p ? { present: p.present as number, counted: p.counted as number } : {}) })),
      feeByClass: (f?.byClass ?? []).map((c) => ({ name: c.name, collected: c.collectedMinor / 100, outstanding: c.outstandingMinor / 100 })),
      performance: o.performance,
      upcomingExams: o.upcomingExams.map((e) => ({ id: e.examId as string, name: e.name, status: e.status, startDate: e.startDate, endDate: e.endDate, classCount: e.classCount, paperCount: e.paperCount, marksProgress: null as number | null })),
      notices: o.notices.map((n) => ({
        id: n.noticeId as string, title: n.title, body: n.body, type: n.type, priority: n.priority, publishDate: n.publishDate, eventDate: n.eventDate,
        audienceLabel: n.audienceLabel, status: "published" as const, audience: { scope: "school" as const }, createdBy: "",
      })),
      // Achievements are not stored for live schools yet; never show demo data to a real school.
      achievements: [] as StudentAchievement[],
      tasks: o.tasks,
    };
  }, [liveData]);

  const queryState = useMemo<QueryState<AdminDashboardData>>(
    () => (live
      ? { isLoading: liveData === undefined, isRefreshing: false, data: adaptedLive as AdminDashboardData | undefined, error: null, refetch: () => {} }
      : q),
    [live, liveData, adaptedLive, q],
  );

  if (live && liveData && !liveData.academicYear) {
    return <Card><EmptyState title="No current academic year" description="Set the current academic year in Academics to see the dashboard." action={<LinkButton href="/admin/academics?tab=years">Open Academics</LinkButton>} /></Card>;
  }
  // A member with finance access only (no school-wide reports) sees just the fee figures.
  if (live && liveData && !liveData.overview) return <FinanceOnlyDashboard data={liveData} />;

  return (
    <QueryView query={queryState}>
      {(d) => {
        const att = d.stats.attendance;
        return (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(todayISO())}</p>
                <h1 className="mt-1 text-[28px] font-semibold text-sapphire">{greeting()}, {user?.displayName.split(" ")[0]}</h1>
                <p className="mt-1 text-sm text-ink-muted">Here&apos;s what&apos;s happening at {d.school.name} today.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {S && <LinkButton href="/admin/students/new" variant="outline"><UserPlus className="h-4 w-4" /> Add student</LinkButton>}
                {AD && <LinkButton href="/admin/notices?action=new"><Megaphone className="h-4 w-4" /> Post notice</LinkButton>}
              </div>
            </div>

            {A && ((d.tasks.unmarkedToday ?? 0) > 0 || (d.tasks.pendingLeave ?? 0) > 0) && (
              <div className="flex flex-col gap-2 sm:flex-row">
                {(d.tasks.unmarkedToday ?? 0) > 0 && (
                  <AlertPill href="/admin/attendance" tone="plum" icon={<AlertCircle className="h-4 w-4" aria-hidden />} className="flex-1">
                    <strong className="figures text-plum">{d.tasks.unmarkedToday} of {d.stats.sections} sections</strong> haven&apos;t marked attendance today.
                  </AlertPill>
                )}
                {(d.tasks.pendingLeave ?? 0) > 0 && (
                  <AlertPill href="/admin/teachers?tab=leave" tone="teal" icon={<ClipboardCheck className="h-4 w-4" aria-hidden />} className="flex-1">
                    <strong className="figures text-ink">{d.tasks.pendingLeave} leave request{(d.tasks.pendingLeave ?? 0) > 1 ? "s" : ""}</strong> awaiting approval
                  </AlertPill>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {S && <StatCard label="Students enrolled" value={<span data-testid="dash-students">{live ? formatNumber(d.stats.students) : counts === undefined ? "—" : formatNumber(counts?.enrolled ?? d.stats.students)}</span>} icon={<GraduationCap className="h-5 w-5" />} hint={live ? `Across ${d.stats.sections} sections` : counts ? `${counts.academicYear.name} · same count as the Students page` : `Across ${d.stats.sections} sections`} href="/admin/students" />}
              <StatCard label="Teaching staff" value={formatNumber(d.stats.teachers)} icon={<Users className="h-5 w-5" />} tone="sapphire" hint={A && d.stats.teachersOnLeave ? `${d.stats.teachersOnLeave} on leave today` : "All available"} href="/admin/teachers" />
              {A && <StatCard
                label={att.isToday ? "Today's attendance" : `Attendance · ${formatShortDate(att.date)}`}
                value={formatPercent(att.percentage, 1)}
                icon={<CalendarCheck2 className="h-5 w-5" />}
                tone="purple"
                delta={att.delta}
                hint={`${att.absent} absent · ${att.marked}/${att.totalSections} marked`}
                href="/admin/attendance"
              />}
              {F && <StatCard label="Pending fees" value={formatCurrency(d.stats.fees.outstanding)} icon={<Wallet className="h-5 w-5" />} tone="lavender" hint={`${formatCurrency(d.stats.fees.overdue)} overdue · ${d.stats.fees.overdueStudents} students`} href="/admin/fees" />}
            </div>

            {(A || AC) && <div className="grid gap-4 lg:grid-cols-3">
              {A && <ChartCard className="lg:col-span-2" title="Attendance overview" description="School-wide daily attendance, last 15 school days" action={<Link href="/admin/reports?tab=attendance" className="text-[13px] font-medium text-lagoon hover:underline">Full report</Link>}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.attendanceTrend.map((p) => ({ ...p, label: formatShortDate(p.date) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis domain={[70, 100]} ticks={[70, 80, 90, 100]} allowDataOverflow {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                    <Tooltip
                      content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} extra={(r) => (typeof r.counted === "number" ? `${r.present} of ${r.counted} students present` : null)} />}
                      cursor={barCursor}
                    />
                    <Bar dataKey="percentage" name="Attendance" {...barProps("single")} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>}

              {AC && <GlassCard>
                <CardHeader title="Examinations" description="Upcoming and in progress" icon={<CalendarClock className="h-4 w-4" />} action={<Link href="/admin/examinations" className="text-[13px] font-medium text-lagoon hover:underline">View all</Link>} />
                <ul className="space-y-2.5 p-5">
                  {d.upcomingExams.length === 0 && <EmptyState title="No upcoming examinations" className="py-6" />}
                  {d.upcomingExams.map((e) => (
                    <li key={e.id}>
                      <Link href={`/admin/examinations/${e.id}`} className="block rounded-xl border border-white/60 bg-white/60 p-3.5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-ambient-lg">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">{e.name}</p>
                          <StatusBadge status={e.status} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-ink-muted">{formatDate(e.startDate)} – {formatDate(e.endDate)} · {e.classCount} classes · {e.paperCount} papers</p>
                        {e.marksProgress !== null && (
                          <div className="mt-2.5 flex items-center gap-2">
                            <ProgressBar value={e.marksProgress} label="Marks entry progress" />
                            <span className="figures text-[12px] font-medium text-ink-soft">{Math.round(e.marksProgress)}%</span>
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </GlassCard>}
            </div>}

            {(F || AC) && <div className="grid gap-4 lg:grid-cols-2">
              {F && <ChartCard title="Fee overview" description={`${formatPercent(d.stats.fees.collectionRate, 1)} of the year's fees collected`} action={<Link href="/admin/fees" className="text-[13px] font-medium text-lagoon hover:underline">Manage fees</Link>}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.feeByClass} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={48} />
                    <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={barCursor} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="collected" name="Collected" stackId="f" {...barProps("collected", { top: false })} maxBarSize={36} stroke="#fff" strokeWidth={1} />
                    <Bar dataKey="outstanding" name="Outstanding" stackId="f" {...barProps("outstanding")} maxBarSize={36} stroke="#fff" strokeWidth={1} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>}

              {AC && <ChartCard title="Academic performance" description={d.performance.examName ? `Average score by class — ${d.performance.examName}` : "No published results yet"} action={<Link href="/admin/reports?tab=exams" className="text-[13px] font-medium text-lagoon hover:underline">Details</Link>}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.performance.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={barCursor} />
                    <Bar dataKey="average" name="Class average" {...barProps("secondary")} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>}
            </div>}

            {S && <StudentAchievementsCard achievements={d.achievements} live={live} />}

            <div className="grid gap-4 lg:grid-cols-3">
              {AD && <Card className="lg:col-span-2">
                <CardHeader title="Recent notices" description="Latest published communication" icon={<Megaphone className="h-4 w-4" />} action={<Link href="/admin/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
                <ul className="divide-y divide-line/60 px-5 pb-3 pt-2">
                  {d.notices.map((n) => <NoticeListItem key={n.id} notice={n} compact />)}
                </ul>
              </Card>}
              <GlassCard className="relative overflow-hidden">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lavender/40 blur-2xl" />
                <CardHeader title="Quick actions" description="Common tasks for today" />
                <ul className="grid gap-2 p-5">
                  {QUICK_ACTIONS.filter((a) => hasModule(a.module)).map(({ label, href, Icon }) => (
                    <li key={href}>
                      <Link href={href} className="group flex items-center gap-3 rounded-xl border border-white/70 bg-white/60 px-3.5 py-3 text-sm font-medium text-ink transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-soft">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-soft text-lagoon transition-all duration-200 group-hover:bg-gradient-to-br group-hover:from-teal group-hover:to-cyan group-hover:text-white group-hover:shadow-glow"><Icon className="h-4 w-4" aria-hidden /></span>
                        {label}
                        <ArrowRight className="ml-auto h-4 w-4 -translate-x-1 text-ink-muted opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>
          </div>
        );
      }}
    </QueryView>
  );
}

function FinanceOnlyDashboard({ data }: { data: FunctionReturnType<typeof api.reports.adminDashboard> }) {
  const f = data.fees;
  const F = useSession().hasModule("finance");
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(data.today)}</p>
        <h1 className="mt-1 text-[28px] font-semibold text-sapphire">Fees · {data.school.name}</h1>
      </div>
      {!f ? <Card><EmptyState title="Nothing to show" description={F ? "Your account has no dashboard figures." : "Accounts & Finance is not enabled for your school."} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Collected" value={formatCurrency(f.collectedMinor / 100)} icon={<Wallet className="h-5 w-5" />} hint={`${formatPercent(f.collectionRate, 1)} of net fees`} href="/admin/fees" />
          <StatCard label="Outstanding" value={formatCurrency(f.outstandingMinor / 100)} icon={<Wallet className="h-5 w-5" />} tone="sapphire" href="/admin/fees?tab=balances" />
          <StatCard label="Overdue" value={formatCurrency(f.overdueMinor / 100)} icon={<AlertCircle className="h-5 w-5" />} tone="lavender" hint={`${f.overdueStudents} students`} href="/admin/fees?tab=balances&standing=overdue" />
          <StatCard label="Net fees" value={formatCurrency(f.netMinor / 100)} icon={<Wallet className="h-5 w-5" />} tone="purple" />
        </div>
      )}
    </div>
  );
}
