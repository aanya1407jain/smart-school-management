"use client";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, CalendarCheck2, CalendarClock, CheckCircle2, ClipboardList, Megaphone, PenLine, Plus, Presentation, Users } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Button, Card, CardHeader, EmptyState, GlassCard, QueryView, StatCard, Badge, ProgressBar, LinkButton } from "@/components/ui";
import { formatClock, formatLongDate, formatShortDate, greeting, todayISO, dueLabel, WEEKDAY_NAMES, formatDate } from "@/lib/utils/dates";
import { NoticeListItem } from "@/features/notices/notice-list-item";
import { cn } from "@/lib/utils/cn";

export function TeacherDashboard() {
  const q = useQuery(() => services.dashboard.getTeacherDashboard(), []);
  const marks = useQuery(() => services.exams.getMarkEntryTasks(), []);
  const upcoming = useQuery(() => services.exams.getUpcoming(4), []);

  return (
    <QueryView query={q}>
      {(d) => {
        const pendingAttendance = d.isSchoolDay ? d.attendanceTasks.filter((t) => !t.marked) : [];
        const classTeacherTask = d.attendanceTasks.find((t) => t.isClassTeacher);
        const toReview = d.homework.reduce((a, h) => a + h.toReview, 0);
        const nowHHMM = new Date().toTimeString().slice(0, 5);
        return (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(todayISO())}</p>
                <h1 className="mt-1 text-[28px] font-semibold text-sapphire">{greeting()}, {d.teacher.title} {d.teacher.name.split(" ").slice(-1)[0]}</h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {d.teacher.designation}
                  {classTeacherTask && <> · Class teacher of <strong className="text-ink">{classTeacherTask.label}</strong></>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <LinkButton href="/teacher/homework?action=new" variant="outline"><Plus className="h-4 w-4" /> Create homework</LinkButton>
                <LinkButton href="/teacher/attendance"><CalendarCheck2 className="h-4 w-4" /> {classTeacherTask ? "Mark attendance" : "View attendance"}</LinkButton>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={d.day.isToday ? "Classes today" : `Classes on ${WEEKDAY_NAMES[d.day.weekday]}`} value={d.classes.length} icon={<Presentation className="h-5 w-5" />} hint={d.classes[0] ? `First at ${formatClock(d.classes[0].startTime)}` : "No classes scheduled"} href="/teacher/timetable" />
              <StatCard label="Attendance to mark" value={pendingAttendance.length} icon={<CalendarCheck2 className="h-5 w-5" />} tone="purple" hint={!d.isSchoolDay ? "No school today" : pendingAttendance.length ? `For today, ${formatShortDate(todayISO())}` : "All registers are done"} href="/teacher/attendance" />
              <StatCard label="Submissions to review" value={toReview} icon={<ClipboardList className="h-5 w-5" />} tone="sapphire" hint={`${d.homework.length} active homework`} href="/teacher/homework" />
              <StatCard label="My students" value={d.studentCount} icon={<Users className="h-5 w-5" />} tone="lavender" hint={`${d.assignments.length} subject–class assignments`} href="/teacher/classes" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <GlassCard className="lg:col-span-2">
                <CardHeader
                  title={d.day.isToday ? "Today's classes" : `Next school day · ${formatDate(d.day.date)}`}
                  description={d.day.isToday ? "Your teaching schedule for today" : "No school today — here's what's coming up"}
                  icon={<CalendarClock className="h-4 w-4" />}
                  action={<Link href="/teacher/timetable" className="text-[13px] font-medium text-lagoon hover:underline">Full timetable</Link>}
                />
                <div className="p-5">
                  {d.classes.length === 0 ? <EmptyState title="No classes scheduled" description="Enjoy a free day — or catch up on reviews." /> : (
                    <ol className="relative space-y-2.5 before:absolute before:bottom-3 before:left-[52px] before:top-3 before:w-px before:bg-line">
                      {d.classes.map((c) => {
                        const isNow = d.day.isToday && c.startTime <= nowHHMM && c.endTime > nowHHMM;
                        const done = d.day.isToday && c.endTime <= nowHHMM;
                        return (
                          <li key={c.id} className="relative flex items-center gap-4">
                            <span className={cn("w-[44px] shrink-0 text-right text-[12px] font-medium", done ? "text-ink-muted/60" : "text-ink-muted")}>{formatClock(c.startTime).replace(" ", " ")}</span>
                            <span className={cn("relative z-10 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-alabaster", isNow ? "bg-teal" : done ? "bg-heather" : "bg-sapphire")} aria-hidden />
                            <Link href={`/teacher/classes/${c.sectionId}`} className={cn("flex flex-1 items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors", isNow ? "border-teal/40 bg-teal-soft/70" : "border-line/70 bg-white/70 hover:bg-white", done && "opacity-60")}>
                              <span>
                                <span className="block text-sm font-semibold text-ink">{c.subject} · Class {c.sectionLabel}</span>
                                <span className="block text-[12.5px] text-ink-muted">{formatClock(c.startTime)} – {formatClock(c.endTime)} · {c.room}</span>
                              </span>
                              {isNow ? <Badge tone="teal" dot>Now</Badge> : <ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden />}
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </GlassCard>

              <GlassCard>
                <CardHeader title="Attendance tasks" description={d.attendanceTasks.length === 0 ? "Attendance is marked by each section's class teacher" : d.isSchoolDay ? `Registers for ${formatShortDate(todayISO())}` : "No school today — registers open on the next school day"} icon={<CalendarCheck2 className="h-4 w-4" />} />
                <ul className="space-y-2 p-5">
                  {d.attendanceTasks.map((t) => (
                    <li key={t.sectionId}>
                      <Link href={`/teacher/attendance?section=${t.sectionId}`} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-white/70 px-3.5 py-2.5 hover:bg-white">
                        <span>
                          <span className="block text-sm font-semibold text-ink">Class {t.label}{t.isClassTeacher && <span className="ml-1.5 text-[11px] font-medium text-plum">Class teacher</span>}</span>
                          <span className="block text-[12px] text-ink-muted">{t.students} students</span>
                        </span>
                        {!d.isSchoolDay ? <span className="text-[12px] text-ink-muted">Weekend</span> : t.marked ? (
                          <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-lagoon"><CheckCircle2 className="h-4 w-4" /> {Math.round(t.percentage ?? 0)}%</span>
                        ) : (
                          <Badge tone="lavender" dot>To mark</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader title="Pending homework" description="Active assignments and submissions" icon={<ClipboardList className="h-4 w-4" />} action={<Link href="/teacher/homework" className="text-[13px] font-medium text-lagoon hover:underline">Manage</Link>} />
                <ul className="space-y-3 p-5">
                  {d.homework.length === 0 && <EmptyState title="No homework assigned yet" action={<LinkButton href="/teacher/homework?action=new" size="sm">Create homework</LinkButton>} className="py-4" />}
                  {d.homework.slice(0, 4).map((h) => (
                    <li key={h.id}>
                      <Link href={`/teacher/homework/${h.id}`} className="block rounded-xl p-1 hover:bg-alabaster">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">{h.title}</p>
                          <span className="shrink-0 text-[12px] text-ink-muted">{h.sectionLabel}</span>
                        </div>
                        <p className="text-[12px] text-ink-muted">{h.subject} · {dueLabel(h.dueDate)}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <ProgressBar value={(h.submitted / Math.max(1, h.total)) * 100} label="Submissions" />
                          <span className="shrink-0 text-[12px] font-medium text-ink-soft">{h.submitted}/{h.total}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Examinations" description="Marks entry and upcoming papers" icon={<BookOpenCheck className="h-4 w-4" />} action={<Link href="/teacher/examinations" className="text-[13px] font-medium text-lagoon hover:underline">Open</Link>} />
                <div className="space-y-4 p-5">
                  {(marks.data ?? []).length > 0 && (
                    <ul className="space-y-2">
                      {marks.data!.map((t) => (
                        <li key={`${t.paperId}-${t.sectionId}`}>
                          <Link href={`/teacher/examinations/marks?paper=${t.paperId}&section=${t.sectionId}`} className="flex items-center gap-3 rounded-xl border border-lavender/50 bg-blush/25 px-3.5 py-2.5 hover:bg-blush/40">
                            <PenLine className="h-4 w-4 shrink-0 text-plum" aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-ink">Enter marks: {t.subject} {t.label}</span>
                              <span className="block text-[12px] text-ink-muted">{t.examName} · {t.entered}/{t.total} entered</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <ul className="space-y-2">
                    {(upcoming.data ?? []).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0"><span className="block truncate font-medium text-ink">{p.subject} · {p.className}</span><span className="block text-[12px] text-ink-muted">{p.examName}</span></span>
                        <span className="shrink-0 text-[12.5px] text-ink-soft">{formatShortDate(p.date)}</span>
                      </li>
                    ))}
                    {upcoming.data && upcoming.data.length === 0 && (marks.data ?? []).length === 0 && <EmptyState title="No upcoming examinations" className="py-4" />}
                  </ul>
                </div>
              </Card>

              <Card>
                <CardHeader title="Assigned subjects" description="What you teach this year" icon={<Presentation className="h-4 w-4" />} />
                <ul className="divide-y divide-line/60 px-5 pb-3">
                  {d.assignments.map((a) => (
                    <li key={a.id}>
                      <Link href={`/teacher/classes/${a.sectionId}`} className="flex items-center justify-between py-2.5 text-sm hover:text-lagoon">
                        <span className="font-medium text-ink">{a.subject}</span>
                        <span className="text-[12.5px] text-ink-muted">Class {a.sectionLabel} · {a.students} students</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <Card>
              <CardHeader title="Recent notices" icon={<Megaphone className="h-4 w-4" />} action={<Link href="/teacher/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
              <ul className="divide-y divide-line/60 px-5 pb-3 pt-1">
                {d.notices.length === 0 && <EmptyState title="No notices yet" className="py-6" />}
                {d.notices.map((n) => <NoticeListItem key={n.id} notice={n} compact />)}
              </ul>
            </Card>
          </div>
        );
      }}
    </QueryView>
  );
}
