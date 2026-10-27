"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarCheck2, CheckCircle2, ClipboardList, Phone, Presentation, Star, Users } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Avatar, Badge, Card, CardHeader, DataTable, EmptyState, GlassCard, LinkButton, PageHeader, ProgressBar, QueryView, SearchInput } from "@/components/ui";
import { AttendancePill } from "@/features/students/students-list";
import { ClassesDashboard } from "./classes-dashboard";
import { formatPercent } from "@/lib/utils/format";
import { dueLabel } from "@/lib/utils/dates";

export function MyClasses() {
  const q = useQuery(() => services.dashboard.getTeacherClasses(), []);
  return (
    <QueryView query={q} loading="cards">
      {(rows) => (
        <ClassesDashboard
          classes={rows.map((c) => ({
            sectionId: c.sectionId, label: c.label, room: c.room || null, subjects: c.subjects, students: c.students, studentNames: c.studentNames,
            attendancePct: c.avgAttendance, activeHomework: c.activeHomework, isClassTeacher: c.isClassTeacher, markedToday: c.isClassTeacher ? c.markedToday : null,
          }))}
        />
      )}
    </QueryView>
  );
}

export function TeacherClassDetail({ sectionId }: { sectionId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const q = useQuery(() => services.dashboard.getTeacherClass(sectionId), [sectionId]);
  return (
    <div>
      <Link href="/teacher/classes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> My classes</Link>
      <QueryView query={q}>
        {(c) => {
          const roster = c.roster.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));
          return (
            <div className="space-y-5">
              <GlassCard className="p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{c.isClassTeacher ? "You are the class teacher" : `Class teacher: ${c.classTeacher ?? "—"}`}</p>
                    <h1 className="text-[28px] font-semibold text-sapphire">Class {c.label}</h1>
                    <p className="text-sm text-ink-muted">{c.longLabel} · {c.room} · {c.roster.length} students</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {c.isClassTeacher ? (
                      <LinkButton href={`/teacher/attendance?section=${encodeURIComponent(c.label)}`} variant={c.markedToday ? "outline" : "primary"}><CalendarCheck2 className="h-4 w-4" /> {c.markedToday ? "Edit today's attendance" : "Mark attendance"}</LinkButton>
                    ) : (
                      <LinkButton href={`/teacher/attendance?section=${encodeURIComponent(c.label)}`} variant="outline"><CalendarCheck2 className="h-4 w-4" /> View attendance</LinkButton>
                    )}
                    <LinkButton href="/teacher/homework?action=new" variant="outline"><ClipboardList className="h-4 w-4" /> Create homework</LinkButton>
                  </div>
                </div>
              </GlassCard>
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <Card id="roster" className="scroll-mt-20 p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 font-semibold text-sapphire"><Users className="h-4 w-4" /> Students</h2>
                    <SearchInput value={search} onChange={setSearch} placeholder="Search students" className="w-56" label="Search students" />
                  </div>
                  <DataTable
                    caption={`Class ${c.label} students`}
                    rows={roster}
                    getRowId={(s) => s.id}
                    onRowClick={(s) => router.push(`/teacher/students/${s.id}`)}
                    empty={<EmptyState title="No students found" />}
                    dense
                    columns={[
                      { key: "roll", header: "Roll", cell: (s) => s.rollNo, mobileLabel: "Roll" },
                      { key: "name", header: "Student", primary: true, cell: (s) => <div className="flex items-center gap-2.5"><Avatar name={s.name} size="sm" /><div><p className="font-semibold text-ink">{s.name}</p><p className="font-mono text-[11px] text-ink-muted">{s.admissionNo}</p></div></div> },
                      { key: "att", header: "Attendance", cell: (s) => <AttendancePill value={s.attendance} /> },
                      { key: "hw", header: "My homework due", cell: (s) => s.homeworkPending ? <Badge tone="lavender">{s.homeworkPending} pending</Badge> : <span className="text-[12.5px] text-lagoon">Up to date</span> },
                      { key: "guardian", header: "Parent contact", cell: (s) => s.guardianName ? <span className="text-[13px]">{s.guardianName}<a href={`tel:${s.guardianPhone}`} onClick={(e) => e.stopPropagation()} className="ml-1.5 inline-flex text-lagoon" aria-label={`Call ${s.guardianName}`}><Phone className="h-3.5 w-3.5" /></a></span> : "—" },
                    ]}
                  />
                </Card>
                <div className="space-y-4">
                  <Card>
                    <CardHeader title="Subjects & teachers" />
                    <ul className="space-y-1.5 p-5 text-sm">
                      {c.subjects.map((s) => <li key={s.subjectId} className="flex justify-between gap-2"><span className={s.mine ? "font-semibold text-lagoon" : "text-ink-soft"}>{s.subject}</span><span className="truncate text-ink-muted">{s.mine ? "You" : s.teacher}</span></li>)}
                    </ul>
                  </Card>
                  <Card>
                    <CardHeader title="My homework for this class" />
                    <ul className="space-y-3 p-5">
                      {c.homework.length === 0 && <EmptyState title="No homework assigned yet" className="py-2" />}
                      {c.homework.map((h) => (
                        <li key={h.id}>
                          <Link href={`/teacher/homework/${h.id}`} className="block rounded-lg hover:bg-alabaster">
                            <p className="text-sm font-semibold text-ink">{h.title}</p>
                            <p className="text-[12px] text-ink-muted">{h.subject} · {dueLabel(h.dueDate)}</p>
                            <div className="mt-1.5 flex items-center gap-2"><ProgressBar value={(h.submitted / Math.max(1, h.total)) * 100} label="Submitted" /><span className="text-[12px] text-ink-soft">{h.submitted}/{h.total}</span></div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              </div>
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
