"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Award, BookOpenCheck, CalendarCheck2, CalendarClock, ClipboardList, Clock, Megaphone, Wallet } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import { Badge, Card, CardHeader, EmptyState, GlassCard, ProgressRing, QueryView, StatusBadge, Avatar } from "@/components/ui";
import { AskHero } from "@/components/command/ask-hero";
import { AppIcon, IconTile, type AppIconName } from "@/components/icons/app-icon";
import { subjectTone } from "@/lib/utils/subject-tone";
import { formatClock, formatDate, formatLongDate, formatShortDate, greeting, todayISO, dueLabel, WEEKDAY_NAMES } from "@/lib/utils/dates";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { NoticeListItem } from "@/features/notices/notice-list-item";
import { cn } from "@/lib/utils/cn";

export function StudentDashboard() {
  const studentId = useActiveStudentId();
  const { user, hasModule } = useSession();
  // Demo-persona dashboard (in-browser demo data). Panels follow the school's module entitlements from the
  // server session, like the live dashboard; with every module enabled it looks exactly as before.
  const A = hasModule("attendance"), AC = hasModule("academics"), F = hasModule("finance"), AD = hasModule("administration");
  const q = useQuery(() => services.dashboard.getStudentDashboard(studentId!), [studentId], { enabled: !!studentId });

  return (
    <QueryView query={q}>
      {(d) => {
        const lowAttendance = (d.attendance.percentage ?? 100) < d.attendance.threshold;
        return (
          <div className="rise space-y-5">
            <AskHero
              title={`${greeting()}, ${d.student.firstName}`}
              subtitle={[formatLongDate(todayISO()), `Class ${d.student.grade}-${d.student.section}`, `Roll ${d.student.rollNo}`, d.student.classTeacher ? `Class teacher ${d.student.classTeacher}` : null].filter(Boolean).join(" · ")}
            />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              {A && <Link href="/student/attendance" className="group col-span-2 block rounded-[22px] focus-visible:shadow-focus xl:col-span-1">
                <GlassCard hover className="lift flex h-full items-center gap-4 rounded-[22px] p-5">
                  <ProgressRing value={d.attendance.percentage} size={84} stroke={8} tone={lowAttendance ? "plum" : "teal"} />
                  <div>
                    <p className="text-[13px] font-medium text-ink-muted">Attendance</p>
                    <p className="mt-1 text-sm text-ink-soft">{d.attendance.present + d.attendance.late} of {d.attendance.total} days</p>
                    {lowAttendance ? <Badge tone="plum" className="mt-2">Below {d.attendance.threshold}%</Badge> : <Badge tone="teal" className="mt-2">On track</Badge>}
                  </div>
                </GlassCard>
              </Link>}
              {AC && <SummaryTile href="/student/homework" icon={<ClipboardList className="h-5 w-5" />} label="Pending homework" value={String(d.homework.length)} hint={d.homework[0] ? `Next: ${dueLabel(d.homework[0].dueDate).toLowerCase()}` : "You're all caught up"} tone="purple" />}
              {AC && <SummaryTile href="/student/results" icon={<Award className="h-5 w-5" />} label="Latest result" value={d.latestResult?.percentage != null ? formatPercent(d.latestResult.percentage, 1) : "—"} hint={d.latestResult ? `${d.latestResult.examName} · Grade ${d.latestResult.grade}` : "No published results yet"} tone="sapphire" />}
              {F && <SummaryTile
                href="/student/fees"
                icon={<Wallet className="h-5 w-5" />}
                label="Fee status"
                value={d.fees.outstanding > 0 ? formatCurrency(d.fees.outstanding) : "Paid"}
                hint={d.fees.nextDue ? `${d.fees.nextDue.label} · due ${formatShortDate(d.fees.nextDue.dueDate)}` : "No dues pending"}
                tone="lavender"
                wide
                badge={<StatusBadge status={d.fees.standing} />}
              />}
            </div>

            {AC && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <GlassCard className="lg:col-span-2">
                <CardHeader
                  title={d.day.isToday ? "Today's timetable" : `${WEEKDAY_NAMES[d.day.weekday]}'s timetable`}
                  description={d.day.isToday ? `Class ${d.student.classLabel}` : `No school today — next school day is ${formatDate(d.day.date)}`}
                  icon={<CalendarClock className="h-4 w-4" />}
                  action={<Link href="/student/timetable" className="text-[13px] font-medium text-lagoon hover:underline">Full week</Link>}
                />
                <div className="p-5">
                  {d.upcomingClass && (
                    <div className="group mb-4 flex items-center gap-4 rounded-2xl bg-brand-700 p-4 text-white">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/15"><AppIcon name="timetable" live className="h-6 w-6" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-white/60">{d.day.isToday ? "Up next" : "First class"}</p>
                        <p className="truncate text-base font-semibold">{d.upcomingClass.subject}</p>
                        <p className="text-[12.5px] text-white/75">{formatClock(d.upcomingClass.startTime)} – {formatClock(d.upcomingClass.endTime)} · {d.upcomingClass.teacher} · {d.upcomingClass.room}</p>
                      </div>
                    </div>
                  )}
                  {d.timetable.length === 0 ? <EmptyState title="No classes scheduled" /> : (
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {d.timetable.map((e) => (
                        <li key={e.id} className={cn("flex items-center gap-3 rounded-2xl bg-bg/70 p-2.5", d.upcomingClass?.id === e.id && "ring-2 ring-inset ring-brand-500/40")}>
                          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold", subjectTone(e.subject).chip)}>{e.subject.slice(0, 2)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{e.subject}</span>
                            <span className="block truncate text-[12px] text-ink-muted">{e.teacher}</span>
                          </span>
                          <span className="figures shrink-0 text-[12px] font-medium text-ink-muted">{formatClock(e.startTime)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </GlassCard>

              <div className="space-y-4">
                <Card>
                  <CardHeader title="Upcoming examination" icon={<BookOpenCheck className="h-4 w-4" />} />
                  <div className="p-5">
                    {d.nextExam ? (
                      <div>
                        <p className="text-[12.5px] font-medium text-brand-700">{d.nextExam.examName}</p>
                        <p className="mt-1 text-lg font-semibold text-sapphire">{d.nextExam.subject}</p>
                        <p className="text-sm text-ink-muted">{formatLongDate(d.nextExam.date)} · {formatClock(d.nextExam.startTime)} · {d.nextExam.maxMarks} marks</p>
                      </div>
                    ) : <EmptyState title="No upcoming examinations" className="py-2" />}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Homework due" icon={<ClipboardList className="h-4 w-4" />} action={<Link href="/student/homework" className="text-[13px] font-medium text-lagoon hover:underline">All</Link>} />
                  <ul className="space-y-2 p-5">
                    {d.homework.length === 0 && <EmptyState title="No pending homework" className="py-2" />}
                    {d.homework.slice(0, 3).map((h) => (
                      <li key={h.id}>
                        <Link href="/student/homework" className="flex items-start justify-between gap-3 rounded-xl px-1 py-1 hover:bg-alabaster">
                          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{h.title}</span><span className="block text-[12px] text-ink-muted">{h.subject}</span></span>
                          <span className={cn("shrink-0 text-[12px] font-medium", h.status === "overdue" ? "text-plum" : "text-ink-soft")}>{dueLabel(h.dueDate)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>}

            {(AD || AC) && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {AD && <Card className="lg:col-span-2">
                <CardHeader title="Latest notices" icon={<Megaphone className="h-4 w-4" />} action={<Link href="/student/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
                <ul className="divide-y divide-line/60 px-5 pb-3 pt-1">
                  {d.notices.length === 0 && <EmptyState title="No notices yet" className="py-6" />}
                  {d.notices.map((n) => <NoticeListItem key={n.id} notice={n} compact />)}
                </ul>
              </Card>}
              {AC && <Card>
                <CardHeader title="Latest result" icon={<Award className="h-4 w-4" />} action={<Link href="/student/results" className="text-[13px] font-medium text-lagoon hover:underline">Details</Link>} />
                <div className="p-5">
                  {d.latestResult ? (
                    <ul className="space-y-2">
                      {d.latestResult.rows.map((r) => (
                        <li key={r.subjectId} className="flex items-center justify-between text-sm">
                          <span className="text-ink-soft">{r.subject}</span>
                          <span className="font-semibold text-ink">{r.absent ? "Absent" : `${r.marks}/${r.maxMarks}`} <span className="ml-1 rounded-md bg-[#F4E8FF] px-1.5 py-0.5 text-[11px] font-semibold text-[#9333EA]">{r.grade}</span></span>
                        </li>
                      ))}
                    </ul>
                  ) : <EmptyState title="No published results" className="py-2" />}
                </div>
              </Card>}
            </div>}
          </div>
        );
      }}
    </QueryView>
  );
}

function SummaryTile({ href, label, value, hint, tone, badge, wide }: { href: string; icon: React.ReactNode; label: string; value: string; hint: string; tone: "purple" | "sapphire" | "lavender"; badge?: React.ReactNode; wide?: boolean }) {
  const name: AppIconName = { purple: "homework", sapphire: "results", lavender: "fees" }[tone] as AppIconName;
  return (
    <Link href={href} className={cn("group lift flex h-full flex-col rounded-[22px] bg-surface p-4 shadow-card focus-visible:shadow-focus sm:p-5", wide && "col-span-2 xl:col-span-1")}>
      <div className="flex items-center gap-2.5">
        <IconTile name={name} size="md" />
        <p className="flex-1 text-[13px] font-medium text-ink-muted">{label}</p>
        <ArrowUpRight className="hidden h-4 w-4 shrink-0 text-ink-faint sm:block transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
      </div>
      <p className="mt-4 whitespace-nowrap text-[24px] font-semibold leading-none tracking-[-0.04em] text-ink sm:text-[30px]">{value}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <p className="truncate text-[12.5px] text-ink-muted">{hint}</p>
        {badge}
      </div>
    </Link>
  );
}
