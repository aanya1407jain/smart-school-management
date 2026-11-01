"use client";
/**
 * The admin dashboard (Core shell). Live schools: one server aggregate
 * (reports.adminDashboard; module figures come through providers). Demo
 * personas: the internal demo dataset. Module stats, alerts, panels and quick
 * actions are contributed by the modules shipped in the build
 * (src/lib/contributions) and follow the school's module entitlements.
 */
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Megaphone, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { requireDemo } from "@/lib/demo/runtime";
import { useSession } from "@/features/auth/session-provider";
import { Card, CardHeader, EmptyState, GlassCard, LinkButton, QueryView, StatCard } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";
import { formatLongDate, greeting, todayISO } from "@/lib/utils/dates";
import { NoticeListItem } from "@/features/notices/notice-list-item";
import { contributionsTo, type AdminDashboardVM, type AdminFeesOnly } from "@/lib/contributions";
import { cn } from "@/lib/utils/cn";

export function AdminDashboard() {
  const { user, dataSource, hasModule } = useSession();
  const live = dataSource === "live";
  const AD = hasModule("administration");
  const parts = contributionsTo("adminDashboard", hasModule);

  // Live: one server aggregate from the school's records. Sections the caller may not see come back null.
  const liveData = useSchoolQuery(api.reports.adminDashboard, live ? {} : "skip");
  // Demo personas: the internal demo dataset (never shown to a real school).
  const q = useQuery(() => requireDemo().data("dashboard.admin") as Promise<AdminDashboardVM>, [live], { enabled: !live });

  const adaptedLive = useMemo<AdminDashboardVM | undefined>(() => {
    if (!liveData?.overview) return undefined;
    const o = liveData.overview;
    const f = liveData.fees;
    return {
      school: { ...liveData.school },
      stats: {
        students: o.students, sections: o.sections, teachers: o.teachers, teachersOnLeave: o.teachersOnLeave,
        attendance: o.attendance ?? { date: liveData.today, isToday: true, percentage: null, absent: 0, marked: 0, totalSections: o.sections, delta: null },
        fees: { outstanding: (f?.outstandingMinor ?? 0) / 100, overdue: (f?.overdueMinor ?? 0) / 100, overdueStudents: f?.overdueStudents ?? 0, collected: (f?.collectedMinor ?? 0) / 100, collectionRate: f?.collectionRate ?? 0 },
      },
      attendanceTrend: o.attendanceTrend.filter((p) => p.percentage !== null).map((p) => ({ date: p.date, percentage: p.percentage as number, present: p.present, counted: p.counted })),
      feeByClass: (f?.byClass ?? []).map((c) => ({ name: c.name, collected: c.collectedMinor / 100, outstanding: c.outstandingMinor / 100 })),
      performance: o.performance,
      upcomingExams: o.upcomingExams.map((e) => ({ id: e.examId as string, name: e.name, status: e.status, startDate: e.startDate, endDate: e.endDate, classCount: e.classCount, paperCount: e.paperCount, marksProgress: null })),
      notices: o.notices.map((n) => ({
        id: n.noticeId as string, title: n.title, body: n.body, type: n.type, priority: n.priority, publishDate: n.publishDate, eventDate: n.eventDate,
        audienceLabel: n.audienceLabel, status: "published" as const, audience: { scope: "school" as const }, createdBy: "",
      })),
      // Achievements are not stored for live schools yet; never show demo data to a real school.
      achievements: [],
      tasks: o.tasks,
    };
  }, [liveData]);

  const queryState = useMemo<QueryState<AdminDashboardVM>>(
    () => (live ? { isLoading: liveData === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, liveData, adaptedLive, q],
  );

  if (live && liveData && !liveData.academicYear) {
    return <Card><EmptyState title="No current academic year" description="Set the current academic year in Academics to see the dashboard." action={<LinkButton href="/admin/academics?tab=years">Open Academics</LinkButton>} /></Card>;
  }
  // A member with finance access only (no school-wide reports) sees just the fee figures.
  if (live && liveData && !liveData.overview) return <FinanceOnlyDashboard school={liveData.school.name} today={liveData.today} fees={liveData.fees} />;

  const quickActions = parts.flatMap((c) => c.quickActions ?? []);
  const panels = parts.flatMap((c) => c.panels ?? []);
  return (
    <QueryView query={queryState}>
      {(d) => (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(todayISO())}</p>
              <h1 className="mt-1 text-[28px] font-semibold text-sapphire">{greeting()}, {user?.displayName.split(" ")[0]}</h1>
              <p className="mt-1 text-sm text-ink-muted">Here&apos;s what&apos;s happening at {d.school.name} today.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {parts.map((c, i) => c.HeaderActions && <c.HeaderActions key={i} d={d} live={live} />)}
              {AD && <LinkButton href="/admin/notices?action=new"><Megaphone className="h-4 w-4" /> Post notice</LinkButton>}
            </div>
          </div>

          {parts.map((c, i) => c.Alerts && <c.Alerts key={i} d={d} live={live} />)}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {parts.filter((c) => c.order < 0).map((c, i) => c.Stats && <c.Stats key={i} d={d} live={live} />)}
            <StatCard label="Teaching staff" value={formatNumber(d.stats.teachers)} icon={<Users className="h-5 w-5" />} tone="sapphire" hint={d.stats.teachersOnLeave ? `${d.stats.teachersOnLeave} on leave today` : "All available"} href="/admin/teachers" />
            {parts.filter((c) => c.order >= 0).map((c, i) => c.Stats && <c.Stats key={i} d={d} live={live} />)}
          </div>

          {panels.length > 0 && <div className="grid gap-4 lg:grid-cols-2">
            {panels.map(({ wide, Panel }, i) => <div key={i} className={cn(wide && "lg:col-span-2")}><Panel d={d} live={live} /></div>)}
          </div>}

          {parts.map((c, i) => c.Sections && <c.Sections key={i} d={d} live={live} />)}

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
                {[...quickActions, ...(AD ? [{ label: "Post notice", href: "/admin/notices?action=new", Icon: Megaphone }] : [])].map(({ label, href, Icon }) => (
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
      )}
    </QueryView>
  );
}

function FinanceOnlyDashboard({ school, today, fees }: { school: string; today: string; fees: AdminFeesOnly | null }) {
  const { hasModule } = useSession();
  const view = contributionsTo("adminDashboard", hasModule).find((c) => c.FinanceOnly);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(today)}</p>
        <h1 className="mt-1 text-[28px] font-semibold text-sapphire">Fees · {school}</h1>
      </div>
      {!fees || !view?.FinanceOnly
        ? <Card><EmptyState title="Nothing to show" description={view ? "Your account has no dashboard figures." : "Accounts & Finance is not enabled for your school."} /></Card>
        : <view.FinanceOnly fees={fees} />}
    </div>
  );
}
