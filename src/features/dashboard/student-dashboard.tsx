"use client";
import Link from "next/link";
import { ArrowRight, Award, BookOpenCheck, CalendarCheck2, CalendarClock, ClipboardList, Clock, Megaphone, Wallet } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import { Badge, Card, CardHeader, EmptyState, GlassCard, ProgressRing, QueryView, StatusBadge, Avatar } from "@/components/ui";
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
          <div className="space-y-6">
            {/* Identity header */}
            <GlassCard className="relative overflow-hidden p-6">
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lavender/40 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -bottom-24 right-40 h-48 w-48 rounded-full bg-teal/20 blur-3xl" />
              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <Avatar name={d.student.name} size="lg" />
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(todayISO())}</p>
                    <h1 className="text-[26px] font-semibold text-sapphire">
                      {`${greeting()}, ${d.student.firstName}`}
                    </h1>
                    <p className="text-sm text-ink-muted">
                                            Class {d.student.grade} · Section {d.student.section} · Roll {d.student.rollNo}
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
                  <dt className="text-ink-muted">Class teacher</dt><dd className="font-medium text-ink">{d.student.classTeacher ?? "—"}</dd>
                  <dt className="text-ink-muted">Classroom</dt><dd className="font-medium text-ink">{d.student.room ?? "—"}</dd>
                </dl>
              </div>
            </GlassCard>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {A && <Link href="/student/attendance" className="block rounded-2xl focus-visible:shadow-focus">
                <GlassCard hover className="flex h-full items-center gap-4 p-5">
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
                badge={<StatusBadge status={d.fees.standing} />}
              />}
            </div>

            {AC && <div className="grid gap-4 lg:grid-cols-3">
              <GlassCard className="lg:col-span-2">
                <CardHeader
                  title={d.day.isToday ? "Today's timetable" : `${WEEKDAY_NAMES[d.day.weekday]}'s timetable`}
                  description={d.day.isToday ? `Class ${d.student.classLabel}` : `No school today — next school day is ${formatDate(d.day.date)}`}
                  icon={<CalendarClock className="h-4 w-4" />}
                  action={<Link href="/student/timetable" className="text-[13px] font-medium text-lagoon hover:underline">Full week</Link>}
                />
                <div className="p-5">
                  {d.upcomingClass && (
                    <div className="mb-4 flex items-center gap-4 rounded-2xl bg-gradient-to-r from-sapphire to-lagoon p-4 text-white">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/15"><Clock className="h-5 w-5" aria-hidden /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">{d.day.isToday ? "Up next" : "First class"}</p>
                        <p className="truncate text-base font-semibold">{d.upcomingClass.subject}</p>
                        <p className="text-[12.5px] text-white/75">{formatClock(d.upcomingClass.startTime)} – {formatClock(d.upcomingClass.endTime)} · {d.upcomingClass.teacher} · {d.upcomingClass.room}</p>
                      </div>
                    </div>
                  )}
                  {d.timetable.length === 0 ? <EmptyState title="No classes scheduled" /> : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {d.timetable.map((e) => (
                        <li key={e.id} className={cn("flex items-center gap-3 rounded-xl border border-line/70 bg-white/70 px-3.5 py-2.5", d.upcomingClass?.id === e.id && "border-teal/40 bg-teal-soft/60")}>
                          <span className="w-16 shrink-0 text-[12px] font-medium text-ink-muted">{formatClock(e.startTime)}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink">{e.subject}</span>
                            <span className="block truncate text-[12px] text-ink-muted">{e.teacher}</span>
                          </span>
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
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-plum">{d.nextExam.examName}</p>
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

            {(AD || AC) && <div className="grid gap-4 lg:grid-cols-3">
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
                          <span className="font-semibold text-ink">{r.absent ? "Absent" : `${r.marks}/${r.maxMarks}`} <span className="ml-1 text-[12px] font-medium text-plum">{r.grade}</span></span>
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

function SummaryTile({ href, icon, label, value, hint, tone, badge }: { href: string; icon: React.ReactNode; label: string; value: string; hint: string; tone: "purple" | "sapphire" | "lavender"; badge?: React.ReactNode }) {
  const iconTone = { purple: "bg-lavender/30 text-plum", sapphire: "bg-sapphire/[0.08] text-sapphire", lavender: "bg-blush/60 text-plum" }[tone];
  return (
    <Link href={href} className="block rounded-2xl focus-visible:shadow-focus">
      <GlassCard hover className="h-full p-5">
        <div className="flex items-start justify-between">
          <p className="text-[13px] font-medium text-ink-muted">{label}</p>
          <span className={cn("grid h-10 w-10 place-items-center rounded-xl", iconTone)}>{icon}</span>
        </div>
        <p className="mt-1 text-[26px] font-semibold leading-none text-sapphire">{value}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="truncate text-[12.5px] text-ink-muted">{hint}</p>
          {badge ?? <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />}
        </div>
      </GlassCard>
    </Link>
  );
}
