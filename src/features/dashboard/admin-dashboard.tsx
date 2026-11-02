"use client";
/**
 * The admin (Principal) dashboard — Core shell. Live schools: one server
 * aggregate (reports.adminDashboard; module figures come through providers).
 * Demo personas: the internal demo dataset. Module metrics, attention items,
 * overview cards and agenda rows are contributed by the modules shipped in the
 * build (src/lib/contributions) and follow the school's module entitlements.
 *
 * Reading order: header → four key metrics → needs attention + upcoming
 * schedule → compact attendance / fee overview → recent notices + reports.
 * Detailed breakdowns live on the existing Reports, Fees and Attendance pages.
 */
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { BarChart3, CheckCircle2, Megaphone, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { requireDemo } from "@/lib/demo/runtime";
import { useSession } from "@/features/auth/session-provider";
import { QueryView } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";
import { formatLongDate, formatShortDate, greeting, todayISO } from "@/lib/utils/dates";
import { NOTICE_TYPE_LABELS } from "@/lib/constants/labels";
import { contributionsTo, type AdminAgendaItem, type AdminDashboardAction, type AdminDashboardContribution, type AdminDashboardVM, type AdminFeesOnly } from "@/lib/contributions";
import { cn } from "@/lib/utils/cn";
import { MetricCard, Panel, PanelEmpty, PanelLink, StatusTag } from "./principal-ui";

/** Core's own header action (notices belong to Administration, which Core hosts). */
const POST_NOTICE: AdminDashboardAction = { label: "Post notice", href: "/admin/notices?action=new", order: 30, permission: "notices:manage", Icon: Megaphone };

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pd-accent";

export function AdminDashboard() {
  const { dataSource, hasModule } = useSession();
  const live = dataSource === "live";
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
      term: liveData.academicYear?.name ?? null,
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
    return (
      <Surface>
        <Panel title="No current academic year">
          <p className="text-sm text-pd-muted">Set the current academic year in Academics to see the dashboard.</p>
          <Link href="/admin/academics?tab=years" className={cn("mt-3 inline-flex min-h-11 items-center rounded-lg bg-pd-accent px-4 text-sm font-semibold text-white hover:bg-pd-accent-hover", focusRing)}>Open Academics</Link>
        </Panel>
      </Surface>
    );
  }
  // A member with finance access only (no school-wide reports) sees just the fee figures.
  if (live && liveData && !liveData.overview) return <FinanceOnlyDashboard school={liveData.school.name} today={liveData.today} fees={liveData.fees} />;

  return (
    <Surface>
      <QueryView query={queryState}>{(d) => <DashboardBody d={d} live={live} parts={parts} />}</QueryView>
    </Surface>
  );
}

/** Flat neutral page surface (globals.css drops the shell's ambient glows behind it). */
function Surface({ children }: { children: ReactNode }) {
  return <div data-surface="principal-dashboard" className="space-y-4 text-pd-ink sm:space-y-6">{children}</div>;
}

function DashboardBody({ d, live, parts }: { d: AdminDashboardVM; live: boolean; parts: AdminDashboardContribution[] }) {
  const { user, can, hasModule } = useSession();
  const notices = hasModule("administration");
  const today = todayISO();

  const actions = [...parts.flatMap((c) => c.headerActions ?? []), ...(notices ? [POST_NOTICE] : [])]
    .filter((a) => can(a.permission))
    .sort((a, b) => a.order - b.order)
    .slice(0, 2);
  const attention = parts.flatMap((c) => c.attention?.(d) ?? []);
  const agenda = [...parts.flatMap((c) => c.agenda?.(d) ?? []), ...(notices ? noticeAgenda(d, today) : [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  const overview = parts.filter((c) => c.Overview);
  const secondary = parts.filter((c) => c.Secondary);
  const onLeave = d.stats.teachersOnLeave;
  const firstName = user?.displayName.split(" ")[0] ?? "";

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-8 tracking-tight text-pd-ink sm:text-2xl">{greeting()}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="mt-0.5 text-[13.5px] leading-5 text-pd-muted">{[d.school.name, d.term, formatLongDate(today)].filter(Boolean).join(" · ")}</p>
        </div>
        {actions.length > 0 && (
          <div className={cn("grid gap-2 sm:flex sm:shrink-0", actions.length > 1 && "grid-cols-2")}>
            {actions.map(({ label, href, Icon }, i) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
                  focusRing,
                  i === 0 ? "bg-pd-accent text-white hover:bg-pd-accent-hover" : "border border-pd-line bg-white text-pd-ink hover:border-pd-accent/40 hover:text-pd-accent",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            ))}
          </div>
        )}
      </header>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {parts.filter((c) => c.order < 0).map((c, i) => c.Metric && <c.Metric key={i} d={d} live={live} />)}
        <MetricCard
          label="Teaching staff"
          value={formatNumber(d.stats.teachers)}
          support={onLeave === null ? undefined : onLeave ? `${onLeave} on leave today` : "All on duty today"}
          icon={Users}
          href="/admin/teachers"
        />
        {parts.filter((c) => c.order >= 0).map((c, i) => c.Metric && <c.Metric key={i} d={d} live={live} />)}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 xl:grid-cols-12">
        <Panel title="Needs attention" className="xl:col-span-7" testId="dash-attention">
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 py-1 text-[13.5px] text-pd-muted">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-pd-ok" aria-hidden /> Nothing needs your attention right now.
            </p>
          ) : (
            <ul className="divide-y divide-pd-line">
              {attention.map((a) => (
                <li key={a.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.tone === "danger" ? "bg-pd-danger" : "bg-pd-warning")} />
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium leading-5 text-pd-ink">{a.title}</p>
                      {a.detail && <p className="mt-0.5 text-[12.5px] leading-[18px] text-pd-muted">{a.detail}</p>}
                    </div>
                  </div>
                  <Link href={a.href} className={cn("ml-[18px] inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-lg border border-pd-line px-3 text-[13px] font-semibold text-pd-accent hover:border-pd-accent/40 hover:bg-pd-accent-soft sm:ml-0 sm:self-center", focusRing)}>
                    {a.action}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Upcoming"
          description="Exams, events and deadlines"
          className="xl:col-span-5"
          testId="dash-agenda"
          action={hasModule("academics") ? <PanelLink href="/admin/examinations">Exams</PanelLink> : undefined}
        >
          {agenda.length === 0 ? <PanelEmpty>Nothing scheduled.</PanelEmpty> : (
            <ul className="-my-3 divide-y divide-pd-line">
              {agenda.map((a) => <AgendaRow key={a.key} item={a} />)}
            </ul>
          )}
        </Panel>
      </div>

      {overview.length > 0 && (
        <div className={cn("grid grid-cols-1 gap-4 sm:gap-6", overview.length > 1 && "md:grid-cols-2")}>
          {overview.map((c, i) => c.Overview && <c.Overview key={i} d={d} live={live} />)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 xl:grid-cols-12">
        {notices && (
          <Panel title="Recent notices" className="xl:col-span-7" testId="dash-notices" action={<PanelLink href="/admin/notices">All notices</PanelLink>}>
            {d.notices.length === 0 ? <PanelEmpty>No notices published yet.</PanelEmpty> : (
              <ul className="-my-3 divide-y divide-pd-line">
                {d.notices.slice(0, 3).map((n) => (
                  <li key={n.id}>
                    <Link href="/admin/notices" className={cn("flex items-start gap-3 rounded-lg py-3 hover:bg-pd-bg/70", focusRing)}>
                      <span className="w-12 shrink-0 pt-0.5 text-[12px] font-semibold leading-4 text-pd-muted tabular-nums">{formatShortDate(n.publishDate)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 break-words text-[14px] font-medium leading-5 text-pd-ink">{n.title}</span>
                        <span className="mt-0.5 block truncate text-[12.5px] leading-[18px] text-pd-muted">{NOTICE_TYPE_LABELS[n.type]} · {n.audienceLabel}</span>
                      </span>
                      {(n.priority === "urgent" || n.priority === "high") && <StatusTag tone={n.priority === "urgent" ? "danger" : "warning"}>{n.priority === "urgent" ? "Urgent" : "High priority"}</StatusTag>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
        {(can("reports:read") || secondary.length > 0) && (
          <Panel title="Reports & highlights" className={notices ? "xl:col-span-5" : "lg:col-span-2 xl:col-span-12"}>
            <ul className="-my-2 divide-y divide-pd-line">
              {can("reports:read") && (
                <li>
                  <Link href="/admin/reports" className={cn("flex min-h-11 items-center gap-3 py-2 text-[14px] font-medium text-pd-ink hover:text-pd-accent", focusRing)}>
                    <BarChart3 className="h-4 w-4 shrink-0 text-pd-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      Detailed reports
                      <span className="block text-[12.5px] font-normal text-pd-muted">Attendance, fees and academic performance by class</span>
                    </span>
                  </Link>
                </li>
              )}
              {secondary.map((c, i) => c.Secondary && <li key={i}><c.Secondary d={d} live={live} /></li>)}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

function AgendaRow({ item: a }: { item: AdminAgendaItem }) {
  return (
    <li>
      <Link href={a.href} className={cn("flex items-start gap-3 rounded-lg py-3 hover:bg-pd-bg/70", focusRing)}>
        <span className="w-16 shrink-0 pt-0.5 text-[12px] font-semibold leading-4 text-pd-muted tabular-nums">{a.when}</span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[14px] font-medium leading-5 text-pd-ink">{a.title}</span>
          {a.meta && <span className="mt-0.5 block text-[12.5px] leading-[18px] text-pd-muted">{a.meta}</span>}
        </span>
        <StatusTag tone={a.tone ?? "neutral"}>{a.status}</StatusTag>
      </Link>
    </li>
  );
}

/** Published notices that announce an event or holiday still to come. */
function noticeAgenda(d: AdminDashboardVM, today: string): AdminAgendaItem[] {
  return d.notices
    .filter((n) => n.type !== "notice" && !!n.eventDate && n.eventDate >= today)
    .map((n) => ({
      key: `notice-${n.id}`,
      date: n.eventDate as string,
      when: n.eventDate === today ? "Today" : formatShortDate(n.eventDate as string),
      title: n.title,
      meta: n.audienceLabel,
      status: NOTICE_TYPE_LABELS[n.type],
      href: "/admin/notices",
    }));
}

function FinanceOnlyDashboard({ school, today, fees }: { school: string; today: string; fees: AdminFeesOnly | null }) {
  const { hasModule } = useSession();
  const view = contributionsTo("adminDashboard", hasModule).find((c) => c.FinanceOnly);
  return (
    <Surface>
      <header>
        <h1 className="text-[22px] font-semibold leading-8 tracking-tight text-pd-ink sm:text-2xl">Fees</h1>
        <p className="mt-0.5 text-[13.5px] text-pd-muted">{school} · {formatLongDate(today)}</p>
      </header>
      {!fees || !view?.FinanceOnly
        ? <Panel title="Nothing to show"><p className="text-sm text-pd-muted">{view ? "Your account has no dashboard figures." : "Accounts & Finance is not enabled for your school."}</p></Panel>
        : <view.FinanceOnly fees={fees} />}
    </Surface>
  );
}
