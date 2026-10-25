"use client";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Award,
  BookOpenCheck,
  CalendarCheck2,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  Layers,
  Megaphone,
  Sparkles,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { services } from "@/lib/services";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import { useSession } from "@/features/auth/session-provider";
import { Button, CardHeader, GlassCard, Card, QueryView, StatCard, StatusBadge, ProgressBar, EmptyState, LinkButton } from "@/components/ui";
import { ChartCard, ChartTooltip, axisProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils/format";
import { formatDate, formatShortDate, greeting, formatLongDate, todayISO } from "@/lib/utils/dates";
import { NoticeListItem } from "@/features/notices/notice-list-item";
import { useMemo } from "react";

const QUICK_ACTIONS = [
  { label: "Add student", href: "/admin/students/new", Icon: UserPlus },
  { label: "Review attendance", href: "/admin/attendance", Icon: CalendarCheck2 },
  { label: "Collect fee", href: "/admin/fees?action=collect", Icon: Wallet },
  { label: "Create examination", href: "/admin/examinations?action=new", Icon: BookOpenCheck },
  { label: "Post notice", href: "/admin/notices?action=new", Icon: Megaphone },
];

type AdminDashboardData = NonNullable<Awaited<ReturnType<typeof services.dashboard.getAdminDashboard>>>;

export function AdminDashboard() {
  const { user, dataSource } = useSession();
  const live = dataSource === "live";

  // Live Convex queries
  const liveData = useSchoolQuery(api.reports.adminDashboard, live ? {} : "skip");
  const studentCountsData = useSchoolQuery(api.academics.studentCounts, live ? {} : "skip");

  // Demo fallback query
  const q = useQuery(() => (live ? Promise.resolve(null as any) : services.dashboard.getAdminDashboard()), [live]);

  const adaptedLive = useMemo(() => {
    if (!liveData) return undefined;
    const today = todayISO();
    const attDate = liveData.latestAttendanceDate ?? today;
    const attPct = liveData.attendancePercentage ?? 100;

    const studentBreakdown = studentCountsData
      ? {
          registered: studentCountsData.registered,
          active: studentCountsData.active,
          tcIssued: studentCountsData.tcIssued,
          alumni: studentCountsData.alumni,
          inactive: studentCountsData.inactive,
        }
      : {
          registered: liveData.studentCount,
          active: liveData.studentCount,
          tcIssued: 0,
          alumni: 0,
          inactive: 0,
        };

    const classSectionTotals = studentCountsData?.classSectionTotals ?? [];
    const admissionsOverTime = studentCountsData?.admissionsOverTime ?? [];
    const academicPerformanceAverage = studentCountsData?.academicPerformance?.averageScore ?? null;

    const sectionsCount = classSectionTotals.length > 0
      ? classSectionTotals.reduce((sum, c) => sum + c.sections.length, 0)
      : (liveData.fees.feeByClass.length || 1);

    return {
      school: {
        name: liveData.school.name,
        shortName: liveData.school.shortName,
        code: liveData.school.code,
      },
      stats: {
        students: studentBreakdown.active,
        sections: sectionsCount,
        teachers: liveData.teacherCount,
        teachersOnLeave: 0,
        attendance: {
          date: attDate,
          isToday: attDate === today,
          percentage: attPct,
          absent: 0,
          marked: liveData.attendancePercentage !== null ? 1 : 0,
          totalSections: sectionsCount,
          delta: null,
        },
        fees: {
          outstanding: liveData.fees.totalOutstandingMinor / 100,
          overdue: liveData.fees.totalOverdueMinor / 100,
          overdueStudents: liveData.fees.overdueStudentsCount,
          collected: liveData.fees.totalCollectedMinor / 100,
          collectionRate: liveData.fees.feeCollectionRate,
        },
      },
      studentBreakdown,
      admissionsOverTime,
      classSectionTotals,
      academicPerformanceAverage,
      attendanceTrend: [
        { date: attDate, percentage: attPct },
      ],
      feeByClass: liveData.fees.feeByClass.map((c) => ({
        name: c.name,
        collected: c.collected / 100,
        outstanding: c.outstanding / 100,
      })),
      performance: {
        examName: null,
        rows: classSectionTotals.map((c) => ({
          name: c.className,
          average: academicPerformanceAverage ?? 0,
        })),
      },
      upcomingExams: [],
      notices: liveData.recentNotices.map((n) => ({
        id: n.id,
        title: n.title,
        type: n.type as any,
        priority: n.priority as any,
        publishDate: n.publishDate,
        eventDate: null,
        audienceLabel: n.audienceKind === "all" ? "School-wide" : `Audience: ${n.audienceKind}`,
        body: "",
        createdBy: "",
        status: "published" as const,
        audience: { scope: "all" as const },
      })),
      tasks: { unmarkedToday: 0, pendingLeave: 0, isSchoolDay: true },
    };
  }, [liveData, studentCountsData]);

  const queryState = useMemo<QueryState<AdminDashboardData>>(
    () => ({
      isLoading: live ? liveData === undefined || studentCountsData === undefined : q.isLoading,
      isRefreshing: false,
      data: (live ? adaptedLive : q.data) as AdminDashboardData,
      error: live ? null : q.error,
      refetch: live ? () => {} : q.refetch,
    }),
    [live, liveData, studentCountsData, adaptedLive, q.isLoading, q.data, q.error, q.refetch]
  );

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
                <LinkButton href="/admin/students/new" variant="outline"><UserPlus className="h-4 w-4" /> Add student</LinkButton>
                <LinkButton href="/admin/notices?action=new"><Megaphone className="h-4 w-4" /> Post notice</LinkButton>
              </div>
            </div>

            {(d.tasks.unmarkedToday > 0 || d.tasks.pendingLeave > 0) && (
              <div className="flex flex-col gap-2 sm:flex-row">
                {d.tasks.unmarkedToday > 0 && (
                  <Link href="/admin/attendance" className="flex flex-1 items-center gap-3 rounded-2xl border border-lavender/50 bg-blush/30 px-4 py-3 text-sm text-plum hover:bg-blush/45">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                    <span><strong>{d.tasks.unmarkedToday} of {d.stats.sections} sections</strong> haven&apos;t marked attendance today.</span>
                    <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
                  </Link>
                )}
                {d.tasks.pendingLeave > 0 && (
                  <Link href="/admin/teachers?tab=leave" className="flex flex-1 items-center gap-3 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm text-ink-soft hover:bg-white">
                    <ClipboardCheck className="h-4 w-4 shrink-0 text-lagoon" aria-hidden />
                    <span><strong className="text-ink">{d.tasks.pendingLeave} leave request{d.tasks.pendingLeave > 1 ? "s" : ""}</strong> awaiting approval</span>
                    <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
                  </Link>
                )}
              </div>
            )}

            {/* Principal's Executive Student Overview */}
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">Principal&apos;s Overview</h2>
                  <p className="text-xs text-ink-muted">Read-only executive summary of student body, status breakdown, and capacity</p>
                </div>
                {d.academicPerformanceAverage !== null && (
                  <div className="flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-3 py-1 text-xs font-semibold text-lagoon shadow-sm">
                    <Sparkles className="h-3.5 w-3.5 text-lagoon" aria-hidden />
                    <span>Academic average: {formatPercent(d.academicPerformanceAverage, 1)}</span>
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Registered students"
                  value={formatNumber(d.studentBreakdown.registered)}
                  icon={<GraduationCap className="h-5 w-5" />}
                  tone="sapphire"
                  hint="All-time student records"
                  href="/admin/students"
                />
                <StatCard
                  label="Active students"
                  value={formatNumber(d.studentBreakdown.active)}
                  icon={<UserCheck className="h-5 w-5" />}
                  tone="teal"
                  hint={`${d.studentBreakdown.registered ? Math.round((d.studentBreakdown.active / d.studentBreakdown.registered) * 100) : 100}% currently enrolled`}
                  href="/admin/students"
                />
                <StatCard
                  label="TC issued (Transferred)"
                  value={formatNumber(d.studentBreakdown.tcIssued)}
                  icon={<UserMinus className="h-5 w-5" />}
                  tone="purple"
                  hint="Official transfer certificates"
                  href="/admin/students?status=transferred"
                />
                <StatCard
                  label="Pass-outs (Alumni)"
                  value={formatNumber(d.studentBreakdown.alumni)}
                  icon={<Award className="h-5 w-5" />}
                  tone="lavender"
                  hint="Graduated alumni"
                  href="/admin/students?status=alumni"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Teaching staff" value={formatNumber(d.stats.teachers)} icon={<Users className="h-5 w-5" />} tone="sapphire" hint={d.stats.teachersOnLeave ? `${d.stats.teachersOnLeave} on leave today` : "All available"} href="/admin/teachers" />
              <StatCard
                label={att.isToday ? "Today's attendance" : `Attendance · ${formatShortDate(att.date)}`}
                value={formatPercent(att.percentage, 1)}
                icon={<CalendarCheck2 className="h-5 w-5" />}
                tone="purple"
                delta={att.delta}
                hint={`${att.absent} absent · ${att.marked}/${att.totalSections} marked`}
                href="/admin/attendance"
              />
              <StatCard label="Pending fees" value={formatCurrency(d.stats.fees.outstanding)} icon={<Wallet className="h-5 w-5" />} tone="lavender" hint={`${formatCurrency(d.stats.fees.overdue)} overdue · ${d.stats.fees.overdueStudents} students`} href="/admin/fees" />
              <StatCard
                label="Class & sections"
                value={formatNumber(d.classSectionTotals.length)}
                icon={<Layers className="h-5 w-5" />}
                tone="teal"
                hint={`${d.stats.sections} active sections total`}
                href="/admin/academics"
              />
            </div>

            {/* Admissions Over Time & Attendance Overview */}
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Admissions over time"
                description="Monthly new student enrollment trajectory"
              >
                {d.admissionsOverTime.length === 0 ? (
                  <EmptyState title="No admission timeline data" className="py-12" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.admissionsOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={CHART_GRID} />
                      <XAxis dataKey="month" {...axisProps} />
                      <YAxis allowDecimals={false} {...axisProps} width={36} />
                      <Tooltip content={<ChartTooltip format={(v) => `${v} students`} />} cursor={{ fill: "rgba(188,197,204,0.18)" }} />
                      <Bar dataKey="count" name="Admissions" fill={CHART.primary} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard title="Attendance overview" description="School-wide daily attendance, last 15 school days" action={<Link href="/admin/reports?tab=attendance" className="text-[13px] font-medium text-lagoon hover:underline">Full report</Link>}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.attendanceTrend.map((p) => ({ ...p, label: formatShortDate(p.date) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="attFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={CHART.secondary} stopOpacity={0.28} />
                        <stop offset="1" stopColor={CHART.secondary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={CHART_GRID} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis domain={[70, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={{ stroke: CHART.muted }} />
                    <Area type="monotone" dataKey="percentage" name="Attendance" stroke={CHART.secondary} strokeWidth={2} fill="url(#attFill)" activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Class & Section Enrollment & Capacity */}
            <Card>
              <CardHeader
                title="Class & section student totals"
                description="Enrollment counts vs section capacities for the active academic session"
                icon={<Layers className="h-4 w-4" />}
                action={<Link href="/admin/academics" className="text-[13px] font-medium text-lagoon hover:underline">Academic structure</Link>}
              />
              {d.classSectionTotals.length === 0 ? (
                <EmptyState title="No active class records" className="py-8" />
              ) : (
                <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {d.classSectionTotals.map((cls) => {
                    const occPct = cls.capacity > 0 ? Math.round((cls.studentCount / cls.capacity) * 100) : 0;
                    return (
                      <div key={cls.classId} className="flex flex-col justify-between rounded-2xl border border-line/70 bg-white/70 p-4 transition-shadow hover:shadow-soft">
                        <div>
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-ink">{cls.className}</h3>
                            <span className="text-xs font-medium text-ink-muted">{cls.sections.length} section{cls.sections.length > 1 ? "s" : ""}</span>
                          </div>
                          <div className="mt-2 flex items-baseline gap-1.5">
                            <span className="text-2xl font-bold text-sapphire">{cls.studentCount}</span>
                            <span className="text-xs text-ink-muted">/ {cls.capacity} capacity ({occPct}%)</span>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={Math.min(occPct, 100)} label={`${cls.className} capacity`} />
                          </div>
                        </div>
                        <div className="mt-4 border-t border-line/50 pt-3">
                          <div className="flex flex-wrap gap-1.5">
                            {cls.sections.map((sec) => (
                              <span
                                key={sec.sectionId}
                                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-muted/60 px-2 py-0.5 text-[11px] font-medium text-ink-soft"
                              >
                                <span>{sec.name}:</span>
                                <strong className="text-ink">{sec.studentCount}</strong>
                                <span className="text-ink-muted">/{sec.capacity}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Fee overview" description={`${formatPercent(d.stats.fees.collectionRate, 1)} of the year's fees collected`} action={<Link href="/admin/fees" className="text-[13px] font-medium text-lagoon hover:underline">Manage fees</Link>}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.feeByClass} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke={CHART_GRID} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} width={48} />
                    <Tooltip content={<ChartTooltip format={(v) => formatCurrency(v)} />} cursor={{ fill: "rgba(188,197,204,0.18)" }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="collected" name="Collected" stackId="f" fill={CHART.primary} radius={[0, 0, 0, 0]} maxBarSize={36} stroke="#fff" strokeWidth={1} />
                    <Bar dataKey="outstanding" name="Outstanding" stackId="f" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={36} stroke="#fff" strokeWidth={1} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Academic performance" description={d.performance.examName ? `Average score by class — ${d.performance.examName}` : "No published results yet"} action={<Link href="/admin/reports?tab=exams" className="text-[13px] font-medium text-lagoon hover:underline">Details</Link>}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.performance.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART_GRID} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} width={46} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(1)}%`} />} cursor={{ fill: "rgba(188,197,204,0.18)" }} />
                    <Bar dataKey="average" name="Class average" fill={CHART.single} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Recent notices" description="Latest published communication" icon={<Megaphone className="h-4 w-4" />} action={<Link href="/admin/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
                <ul className="divide-y divide-line/60 px-5 pb-3 pt-2">
                  {d.notices.map((n) => <NoticeListItem key={n.id} notice={n} compact />)}
                </ul>
              </Card>
              <GlassCard className="relative overflow-hidden">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-lavender/40 blur-2xl" />
                <CardHeader title="Quick actions" description="Common tasks for today" />
                <ul className="grid gap-2 p-5">
                  {QUICK_ACTIONS.map(({ label, href, Icon }) => (
                    <li key={href}>
                      <Link href={href} className="group flex items-center gap-3 rounded-xl border border-white/70 bg-white/60 px-3.5 py-3 text-sm font-medium text-ink transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-soft">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-soft text-lagoon group-hover:bg-lagoon group-hover:text-white"><Icon className="h-4 w-4" aria-hidden /></span>
                        {label}
                        <ArrowRight className="ml-auto h-4 w-4 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
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
