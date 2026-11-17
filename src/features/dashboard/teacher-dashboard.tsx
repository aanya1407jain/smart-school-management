"use client";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, CalendarCheck2, CalendarClock, CheckCircle2, ClipboardList, Megaphone, PenLine, Plus, Presentation, Users } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Button, Card, CardHeader, EmptyState, GlassCard, QueryView, StatCard, Badge, ProgressBar, LinkButton } from "@/components/ui";
import { AskHero } from "@/components/command/ask-hero";
import { subjectTone } from "@/lib/utils/subject-tone";
import { formatClock, formatLongDate, formatShortDate, greeting, todayISO, dueLabel, WEEKDAY_NAMES, formatDate } from "@/lib/utils/dates";
import { NoticeListItem } from "@/features/notices/notice-list-item";
import { cn } from "@/lib/utils/cn";
import { useSession } from "@/features/auth/session-provider";

export function TeacherDashboard() {
  // Demo-persona dashboard (in-browser demo data). Panels follow the school's module entitlements from the
  // server session, like the live dashboard; with every module enabled it looks exactly as before.
  const { hasModule } = useSession();
  const A = hasModule("attendance"), AC = hasModule("academics"), AD = hasModule("administration");
  const q = useQuery(() => services.dashboard.getTeacherDashboard(), []);
  const marks = useQuery(() => services.exams.getMarkEntryTasks(), [AC], { enabled: AC });
  const upcoming = useQuery(() => services.exams.getUpcoming(4), [AC], { enabled: AC });

  return (
    <QueryView query={q}>
      {(d) => {
        const pendingAttendance = d.isSchoolDay ? d.attendanceTasks.filter((t) => !t.marked) : [];
        const classTeacherTask = d.attendanceTasks.find((t) => t.isClassTeacher);
        const toReview = d.homework.reduce((a, h) => a + h.toReview, 0);
        const nowHHMM = new Date().toTimeString().slice(0, 5);
        return (
          <div className="rise space-y-5">
            <AskHero
              title={`${greeting()}, ${d.teacher.title} ${d.teacher.name.split(" ").slice(-1)[0]}`}
              subtitle={[formatLongDate(todayISO()), d.teacher.designation, classTeacherTask ? `Class teacher of ${classTeacherTask.label}` : null].filter(Boolean).join(" · ")}
              actions={<>
                {A && <Link href="/teacher/attendance" className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-white px-3.5 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:bg-white/90"><CalendarCheck2 className="h-4 w-4" /> {classTeacherTask ? "Mark attendance" : "View attendance"}</Link>}
                {AC && <Link href="/teacher/homework?action=new" className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-white/[0.08] px-3.5 text-[13.5px] font-medium text-white ring-1 ring-inset ring-white/15 transition-colors duration-150 hover:bg-white/[0.14]"><Plus className="h-4 w-4" /> Create homework</Link>}
              </>}
            />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              {AC && <StatCard label={d.day.isToday ? "Classes today" : `Classes on ${WEEKDAY_NAMES[d.day.weekday]}`} value={d.classes.length} accent="timetable" icon={<Presentation className="h-5 w-5" />} hint={d.classes[0] ? `First at ${formatClock(d.classes[0].startTime)}` : "No classes scheduled"} href="/teacher/timetable" />}
              {A && <StatCard label="Attendance to mark" value={pendingAttendance.length} accent="attendance" icon={<CalendarCheck2 className="h-5 w-5" />} tone="purple" hint={!d.isSchoolDay ? "No school today" : pendingAttendance.length ? `For today, ${formatShortDate(todayISO())}` : "All registers are done"} href="/teacher/attendance" />}
              {AC && <StatCard label="Submissions to review" value={toReview} accent="homework" icon={<ClipboardList className="h-5 w-5" />} tone="sapphire" hint={`${d.homework.length} active homework`} href="/teacher/homework" />}
              <StatCard label="My students" value={d.studentCount} accent="students" icon={<Users className="h-5 w-5" />} tone="lavender" hint={`${d.assignments.length} subject–class assignments`} href="/teacher/classes" />
            </div>

            {(AC || A) && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {AC && <GlassCard className="lg:col-span-2">
                <CardHeader
                  title={d.day.isToday ? "Today's classes" : `Next school day · ${formatDate(d.day.date)}`}
                  description={d.day.isToday ? undefined : "No school today"}
                  icon={<CalendarClock className="h-4 w-4" />}
                  action={<Link href="/teacher/timetable" className="text-[13px] font-medium text-lagoon hover:underline">Full timetable</Link>}
                />
                <div className="p-5">
                  {d.classes.length === 0 ? <EmptyState title="No classes scheduled" description="Enjoy a free day — or catch up on reviews." /> : (
                    <ol className="relative space-y-2 before:absolute before:bottom-4 before:left-[53px] sm:before:left-[60px] before:top-4 before:w-[2px] before:rounded-full before:bg-line">
                      {d.classes.map((c) => {
                        const isNow = d.day.isToday && c.startTime <= nowHHMM && c.endTime > nowHHMM;
                        const done = d.day.isToday && c.endTime <= nowHHMM;
                        const tone = subjectTone(c.subject);
                        return (
                          <li key={c.id} className="relative flex items-center gap-3">
                            <span className={cn("figures w-[42px] shrink-0 text-right text-[11.5px] font-medium sm:w-[48px] sm:text-[12px]", done ? "text-ink-faint" : "text-ink-muted")}>{formatClock(c.startTime)}</span>
                            <span className={cn("relative z-10 h-3 w-3 shrink-0 rounded-full ring-4 ring-surface", isNow ? "live-dot bg-coral text-coral" : done ? "bg-line-strong" : tone.dot)} aria-hidden />
                            <Link href={`/teacher/classes/${c.sectionId}`} className={cn("group lift flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2.5 pr-3.5", isNow ? "bg-brand-700 text-white" : "bg-bg/70 hover:bg-bg", done && "opacity-55")}>
                              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold", isNow ? "bg-white/15 text-white" : tone.chip)}>{c.subject.slice(0, 2)}</span>
                              <span className="min-w-0 flex-1">
                                <span className={cn("block truncate text-[14px] font-semibold", isNow ? "text-white" : "text-ink")}>{c.subject} <span className={cn("font-normal", isNow ? "text-white/70" : "text-ink-muted")}>· {c.sectionLabel}</span></span>
                                <span className={cn("block truncate text-[12px]", isNow ? "text-white/70" : "text-ink-muted")}>{formatClock(c.startTime)} – {formatClock(c.endTime)}<span className="sm:hidden"> · {c.room}</span></span>
                              </span>
                              <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium sm:inline-block", isNow ? "bg-white/15 text-white" : "bg-surface text-ink-soft shadow-card")}>{c.room}</span>
                              {isNow ? <span className="rounded-full bg-marigold px-2 py-0.5 text-[11px] font-semibold text-ink">Now</span> : <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden />}
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </GlassCard>}

              {A && <GlassCard>
                <CardHeader title="Attendance tasks" description={d.attendanceTasks.length === 0 ? "Attendance is marked by each section's class teacher" : d.isSchoolDay ? `Registers for ${formatShortDate(todayISO())}` : "No school today — registers open on the next school day"} icon={<CalendarCheck2 className="h-4 w-4" />} />
                <ul className="space-y-2 p-5">
                  {d.attendanceTasks.map((t) => (
                    <li key={t.sectionId}>
                      <Link href={`/teacher/attendance?section=${encodeURIComponent(t.label)}`} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-white px-3.5 py-2.5 hover:bg-white">
                        <span>
                          <span className="block text-sm font-semibold text-ink">Class {t.label}{t.isClassTeacher && <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">Class teacher</span>}</span>
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
              </GlassCard>}
            </div>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {AC && <Card>
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
              </Card>}

              {AC && <Card>
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
              </Card>}

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

            {AD && <Card>
              <CardHeader title="Recent notices" icon={<Megaphone className="h-4 w-4" />} action={<Link href="/teacher/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
              <ul className="divide-y divide-line/60 px-5 pb-3 pt-1">
                {d.notices.length === 0 && <EmptyState title="No notices yet" className="py-6" />}
                {d.notices.map((n) => <NoticeListItem key={n.id} notice={n} compact />)}
              </ul>
            </Card>}
          </div>
        );
      }}
    </QueryView>
  );
}

