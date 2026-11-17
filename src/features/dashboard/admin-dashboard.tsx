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
import { ArrowRight, BarChart3, CheckCircle2, Megaphone, Users } from "lucide-react";
import { IconTile, type AppIconName } from "@/components/icons/app-icon";
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
import { DotRow, MetricCard, Panel, PanelEmpty, PanelLink, QuickActions, StatusTag } from "./principal-ui";
import { AskHero } from "@/components/command/ask-hero";

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
  return <div data-surface="principal-dashboard" className="rise space-y-4 text-pd-ink sm:space-y-5">{children}</div>;
}

function DashboardBody({ d, live, parts }: { d: AdminDashboardVM; live: boolean; parts: AdminDashboardContribution[] }) {
  const { user, can, hasModule } = useSession();
  const notices = hasModule("administration");
  const today = todayISO();

  const actions = [...parts.flatMap((c) => c.headerActions ?? []), ...(notices ? [POST_NOTICE] : [])]
    .filter((a) => can(a.permission))
    .sort((a, b) => a.order - b.order)
    .slice(0, 3);
  const attention = parts.flatMap((c) => c.attention?.(d) ?? []);
  const agenda = [...parts.flatMap((c) => c.agenda?.(d) ?? []), ...(notices ? noticeAgenda(d, today) : [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  const overview = parts.filter((c) => c.Overview);
  const secondary = parts.filter((c) => c.Secondary);
  const onLeave = d.stats.teachersOnLeave;
  const firstName = user?.displayName.split(" ")[0] ?? "";
  // Header actions first (from the modules), then common jobs the user can open.
  const quick = [
    ...actions.map((a) => ({ label: a.label, href: a.href, icon: actionIcon(a.href) })),
    ...(can("attendance:read:all") && hasModule("attendance") ? [{ label: "Attendance today", href: "/admin/attendance", icon: "attendance" as AppIconName }] : []),
    ...(can("reports:read") ? [{ label: "Open reports", href: "/admin/reports", icon: "reports" as AppIconName }] : []),
    ...(can("exams:manage") && hasModule("academics") ? [{ label: "Schedule exam", href: "/admin/examinations?action=new", icon: "exams" as AppIconName }] : []),
  ].filter((x, i, arr) => arr.findIndex((y) => y.href === x.href) === i).slice(0, 4);

  return (
    <>
      <AskHero
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        subtitle={[d.school.name, d.term, formatLongDate(today)].filter(Boolean).join(" · ")}
      />

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {parts.filter((c) => c.order < 0).map((c, i) => c.Metric && <c.Metric key={i} d={d} live={live} />)}
        <MetricCard
          label="Teaching staff"
          value={formatNumber(d.stats.teachers)}
          support={onLeave === null ? undefined : onLeave ? `${onLeave} on leave today` : "All on duty today"}
          icon={Users}
          accent="teachers"
          viz={<DotRow total={d.stats.teachers} away={onLeave ?? 0} />}
          href="/admin/teachers"
        />
        {parts.filter((c) => c.order >= 0).map((c, i) => c.Metric && <c.Metric key={i} d={d} live={live} />)}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 xl:grid-cols-12">
        <Panel title="Needs attention" icon="notifications" className="xl:col-span-7" testId="dash-attention">
          <div className="flex h-full flex-col gap-4">
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-pd-ok-soft px-4 py-3.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-pd-ok" aria-hidden />
              <p className="text-[13.5px] font-medium text-pd-ok">All clear. Nothing needs you right now.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className={cn("group flex items-center gap-3 rounded-2xl bg-bg/70 p-2.5 pr-3 transition-colors duration-150 hover:bg-bg", focusRing)}>
                    <span className="relative">
                      <IconTile name={attentionIcon(a.href)} size="md" />
                      <span aria-hidden className={cn("live-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface", a.tone === "danger" ? "bg-coral text-coral" : "bg-marigold text-marigold")} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium leading-5 text-pd-ink">{a.title}</span>
                      {a.detail && <span className="block truncate text-[12.5px] leading-[18px] text-pd-muted">{a.detail}</span>}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-medium text-pd-ink shadow-card transition-colors group-hover:bg-brand-600 group-hover:text-white sm:inline-flex">
                      {a.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto">
            <p className="mb-2 text-[12px] font-medium text-pd-muted">Quick actions</p>
            <QuickActions items={quick} />
          </div>
          </div>
        </Panel>

        <Panel
          title="Upcoming"
          icon="timetable"
          className="xl:col-span-5"
          testId="dash-agenda"
          action={hasModule("academics") ? <PanelLink href="/admin/examinations">Exams</PanelLink> : undefined}
        >
          {agenda.length === 0 ? <PanelEmpty>Nothing scheduled.</PanelEmpty> : (
            <ul className="space-y-1">
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
          <Panel title="Recent notices" icon="notices" className="xl:col-span-7" testId="dash-notices" action={<PanelLink href="/admin/notices">All</PanelLink>}>
            {d.notices.length === 0 ? <PanelEmpty>No notices yet.</PanelEmpty> : (
              <ul className="space-y-1">
                {d.notices.slice(0, 3).map((n) => (
                  <li key={n.id}>
                    <Link href="/admin/notices" className={cn("group flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-bg/70", focusRing)}>
                      <IconTile name={n.type === "event" ? "classes" : n.type === "holiday" ? "spark" : "notices"} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium leading-5 text-pd-ink">{n.title}</span>
                        <span className="block truncate text-[12.5px] leading-[18px] text-pd-muted">{n.audienceLabel} · {formatShortDate(n.publishDate)}</span>
                      </span>
                      {(n.priority === "urgent" || n.priority === "high") && <StatusTag tone={n.priority === "urgent" ? "danger" : "warning"}>{n.priority === "urgent" ? "Urgent" : "High"}</StatusTag>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
        {(can("reports:read") || secondary.length > 0) && (
          <Panel title="Reports" icon="reports" className={notices ? "xl:col-span-5" : "lg:col-span-2 xl:col-span-12"}>
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
  const d = new Date(`${a.date}T00:00:00`);
  const day = Number.isNaN(d.getTime()) ? "" : String(d.getDate());
  const mon = Number.isNaN(d.getTime()) ? a.when : d.toLocaleDateString("en-IN", { month: "short" });
  return (
    <li>
      <Link href={a.href} className={cn("group flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-bg/70", focusRing)}>
        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center overflow-hidden rounded-[14px] bg-surface shadow-card transition-transform duration-200 group-hover:-rotate-3">
          <span className="w-full bg-coral py-[1px] text-center text-[9.5px] font-semibold uppercase tracking-[0.06em] text-white">{mon}</span>
          <span className="figures flex-1 pt-0.5 text-[18px] font-semibold leading-none text-pd-ink">{day}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-5 text-pd-ink">{a.title}</span>
          {a.meta && <span className="block truncate text-[12.5px] leading-[18px] text-pd-muted">{a.meta}</span>}
        </span>
        <StatusTag tone={a.tone ?? "neutral"}>{a.status}</StatusTag>
      </Link>
    </li>
  );
}

/** Icon for a header action, from its destination. */
function actionIcon(href: string): AppIconName {
  if (href.includes("/students")) return "students";
  if (href.includes("/fees")) return "fees";
  if (href.includes("/notices")) return "notices";
  if (href.includes("/attendance")) return "attendance";
  return "plus";
}

/** Which module icon an attention item gets, from where it leads. */
function attentionIcon(href: string): AppIconName {
  if (href.includes("/attendance")) return "attendance";
  if (href.includes("/fees")) return "fees";
  if (href.includes("/teachers")) return "teachers";
  if (href.includes("/examinations")) return "exams";
  if (href.includes("/students")) return "students";
  return "notices";
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
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.035em] text-pd-ink">Fees</h1>
        <p className="mt-0.5 text-[13.5px] text-pd-muted">{school} · {formatLongDate(today)}</p>
      </header>
      {!fees || !view?.FinanceOnly
        ? <Panel title="Nothing to show"><p className="text-sm text-pd-muted">{view ? "Your account has no dashboard figures." : "Accounts & Finance is not enabled for your school."}</p></Panel>
        : <view.FinanceOnly fees={fees} />}
    </Surface>
  );
}
