"use client";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Cake, Droplet, FileText, Mail, MapPin, Pencil, Phone, UserRound, Wallet, CalendarDays, Download } from "lucide-react";
import { Component, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { useSession } from "@/features/auth/session-provider";
import { services } from "@/lib/services";
import { useQuery as useDemoQuery } from "@/lib/hooks/use-query";
import { DemoStudentProfileBody } from "./demo-student-profile";
import { LiveFeesPanel, LiveHomeworkList, LiveResultsList, homeworkState, type LiveFees } from "@/features/student-portal/live-records";
import { EnrollmentActions, EnrollmentHistory, StudentDocuments } from "./student-records-live";
import {
  Avatar, Badge, Card, CardHeader, EmptyState, GlassCard, LinkButton, ProgressRing, StatusBadge, Tabs, TabsContent, TabsList,
} from "@/components/ui";
import { ChartTooltip, axisProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
import { formatCurrency, formatPercent, titleCase } from "@/lib/utils/format";
import { formatDate, formatShortDate, formatWeekday, daysBetween, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ */
/* Container: fetches data and handles loading / not-found             */
/* ------------------------------------------------------------------ */

/**
 * Student profile for admin / teacher / student views.
 *  - Demo personas viewing a record of the in-browser demo dataset (ids like
 *    "stu_aarav") get the demo view — demo data never reaches real accounts.
 *  - Everything else is a REAL record: academics.getStudentProfile decides on
 *    the server whether the caller may see it (school staff, the assigned
 *    teacher, or the student themself).
 */
export function StudentProfileView({ studentId, backHref }: { studentId: string; backHref?: string }) {
  const { dataSource } = useSession();
  const demoMode = dataSource === "demo" && !!studentId;
  const demo = useDemoQuery(() => services.students.getProfile(studentId), [studentId], { enabled: demoMode });
  if (!studentId) return <NotFound backHref={backHref} />;
  if (demoMode && demo.isLoading) return <div className="p-8 text-center text-ink-muted" role="status">Loading student profile...</div>;
  if (demoMode && demo.data) return <DemoStudentProfileBody p={demo.data} backHref={backHref} />;
  return <ProfileBoundary backHref={backHref}><LiveStudentProfileView studentId={studentId} backHref={backHref} /></ProfileBoundary>;
}

function LiveStudentProfileView({ studentId, backHref }: { studentId: string; backHref?: string }) {
  const data = useSchoolQuery(api.academics.getStudentProfile, { studentId });
  if (data === undefined) return <div className="p-8 text-center text-ink-muted" role="status">Loading student profile...</div>;
  if (!data) return <NotFound backHref={backHref} />;
  return <ProfileBody p={normalizeProfile(data)} backHref={backHref} />;
}

/** NOT_FOUND (no such student, other school, or no access) renders as "not found"; other errors as a message. */
class ProfileBoundary extends Component<{ backHref?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const app = getAppError(this.state.error);
    if (!app || app.code === "NOT_FOUND" || app.code === "FORBIDDEN") return <NotFound backHref={this.props.backHref} />;
    return <div className="mx-auto max-w-4xl p-6"><EmptyState title="Couldn't load this profile" description={app.message} /></div>;
  }
}

function NotFound({ backHref }: { backHref?: string }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <EmptyState
        title="Student not found"
        description="This student record doesn't exist or you don't have access to it."
        action={backHref ? <LinkButton href={backHref}>Back to students</LinkButton> : undefined}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Normalization: turn the raw query result into a safe view model     */
/* ------------------------------------------------------------------ */

type AttendanceRecord = { date: string; status: string };

type ParentContactVM = {
  id: string;
  name: string;
  relation: string;
  occupation?: string;
  phone?: string;
  email?: string;
  address?: string;
  isPrimary: boolean;
  otherChildren: { id: string; name: string; classLabel?: string }[];
};

type ProfileVM = ReturnType<typeof normalizeProfile>;

type ServerProfile = NonNullable<FunctionReturnType<typeof api.academics.getStudentProfile>>;

/** Turn the server's explicit-field response into the view model. */
function normalizeProfile(raw: ServerProfile) {
  const s = raw.student;
  const enrollment = raw.enrollment;
  const student = {
    id: s.studentId as string,
    firstName: s.firstName,
    lastName: s.lastName,
    status: s.status as string | undefined,
    admissionNo: s.admissionNo,
    scholarNo: s.scholarNo ?? undefined,
    admissionDate: s.admissionDate ?? undefined,
    dateOfBirth: s.dateOfBirth ?? undefined,
    gender: s.gender ?? undefined,
    bloodGroup: s.bloodGroup ?? undefined,
    email: s.email ?? undefined,
    phone: s.phone ?? undefined,
    address: s.address ?? undefined,
    documents: [] as { id?: string; name?: string; kind?: string; sizeKb?: number; uploadedAt?: string }[],
  };
  const classLabel = enrollment ? enrollment.sectionDisplayName ?? [enrollment.className, enrollment.sectionName].filter(Boolean).join(" - ") : "";
  const parentContacts: ParentContactVM[] = raw.parentContacts.map((g) => ({
    id: g.contactId as string,
    name: g.name,
    relation: g.relationship,
    occupation: g.occupation ?? undefined,
    phone: g.phone ?? undefined,
    email: g.email ?? undefined,
    isPrimary: g.isPrimary,
    otherChildren: [],
  }));
  const records: AttendanceRecord[] = raw.attendance.map((r) => ({ date: r.date, status: r.status }));
  return {
    access: raw.access,
    student,
    enrollment,
    enrollmentState: raw.enrollmentState,
    academicYear: raw.academicYear?.name ?? null,
    classLabel,
    classTeacher: enrollment?.classTeacher ?? undefined,
    room: enrollment?.room ?? undefined,
    teachers: [] as { subjectId: string; subject: string; teacher: string }[],
    parentContacts,
    account: undefined as { email?: string } | undefined,
    attendance: summarizeAttendance(records),
    homework: raw.homework,
    results: raw.results,
    fees: raw.fees as LiveFees | null,
  };
}

function summarizeAttendance(records: AttendanceRecord[]) {
  let present = 0, late = 0, absent = 0;
  const byMonth = new Map<string, { month: string; present: number; late: number; absent: number }>();

  for (const r of records) {
    const month = r.date.slice(0, 7);
    const bucket = byMonth.get(month) ?? { month, present: 0, late: 0, absent: 0 };
    if (r.status === "present") { present++; bucket.present++; }
    else if (r.status === "late") { late++; bucket.late++; }
    else if (r.status === "absent") { absent++; bucket.absent++; }
    byMonth.set(month, bucket);
  }

  const total = present + late + absent;
  const percentage = total > 0 ? ((present + late) / total) * 100 : null;

  const monthly = [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      ...m,
      attended: m.present + m.late,
      label: new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }),
    }));

  const recent = [...records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

  return { stats: { present, late, absent, total, percentage }, monthly, recent };
}

/* ------------------------------------------------------------------ */
/* Small formatting guards                                             */
/* ------------------------------------------------------------------ */

const dash = "—";
const safe = (v?: string | null) => (v && String(v).trim() ? String(v) : dash);
const safeDate = (d?: string, fmt: (d: string) => string = formatDate) => (d ? fmt(d) : dash);
const safeTitle = (v?: string) => (v ? titleCase(v) : dash);

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

function ProfileBody({ p, backHref }: { p: ProfileVM; backHref?: string }) {
  const { can, hasModule } = useSession();
  // Sections follow the school's module entitlements (the server already leaves their data out).
  const A = hasModule("attendance"), AC = hasModule("academics"), F = hasModule("finance"), S = hasModule("students");
  const s = p.student;
  const name = `${s.firstName} ${s.lastName}`.trim() || "Unnamed student";
  const age = s.dateOfBirth ? Math.floor(daysBetween(s.dateOfBirth, todayISO()) / 365.25) : null;
  const isAdmin = can("students:write");
  const pct = p.attendance.stats.percentage;
  const latest = p.results[0];
  const primaryContact = p.parentContacts[0];
  const pendingHw = p.homework.filter((h) => { const st = homeworkState(h); return st === "pending" || st === "overdue"; }).length;

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "academic", label: "Academic" },
    ...(A ? [{ value: "attendance", label: "Attendance" }] : []),
    ...(p.fees && F ? [{ value: "fees", label: "Fees" }] : []),
    ...(AC ? [{ value: "exams", label: "Examinations", count: p.results.length }, { value: "homework", label: "Homework", count: p.homework.length }] : []),
    ...(p.access !== "assigned" && S ? [{ value: "documents", label: "Documents" }] : []),
    { value: "parent", label: "Parent contact" },
  ];

  return (
    <div className="space-y-6">
      <GlassCard className="relative overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-lavender/35 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={name} size="xl" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-sapphire">{name}</h1>
                {s.status && <StatusBadge status={s.status} />}
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {s.scholarNo && <span data-testid="profile-scholar-no">Scholar No: <span className="font-mono">{s.scholarNo}</span></span>}
                {p.classLabel && <>{s.scholarNo ? " · " : ""}Class {p.classLabel}</>}
                {p.enrollment?.rollNo != null && ` · Roll ${p.enrollment.rollNo}`}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                Class teacher: <span className="text-ink">{safe(p.classTeacher)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {backHref && <LinkButton href={backHref} variant="ghost">Back</LinkButton>}
            {isAdmin && F && s.id && <LinkButton href={`/admin/fees/${s.id}`} variant="outline"><Wallet className="h-4 w-4" /> Fee ledger</LinkButton>}
            {isAdmin && S && s.id && <LinkButton href={`/admin/students/${s.id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          </div>
        </div>
        <dl className="relative mt-6 grid grid-cols-2 gap-4 border-t border-white/70 pt-5 sm:grid-cols-4">
          {A && <Metric label="Attendance" value={pct != null ? formatPercent(pct, 1) : dash} tone={pct != null && pct < 85 ? "warn" : undefined} />}
          {AC && <Metric
            label="Latest result"
            value={latest?.percentage != null ? `${formatPercent(latest.percentage, 1)}${latest.grade ? ` · ${latest.grade}` : ""}` : dash}
          />}
          {AC && <Metric label="Pending homework" value={String(pendingHw)} />}
          {F && <Metric
            label="Fee balance"
            value={p.fees ? (p.fees.totals.outstandingMinor ? formatCurrency(p.fees.totals.outstandingMinor / 100) : p.fees.obligations.length ? "Paid" : "None assigned") : "Restricted"}
            tone={p.fees?.obligations.some((o) => o.outstandingMinor > 0 && o.dueDate < todayISO()) ? "warn" : undefined}
          />}
        </dl>
      </GlassCard>

      <Tabs defaultValue="overview">
        <TabsList items={tabs} />

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Personal information" />
              <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
                <Info icon={<Cake />} label="Date of birth" value={s.dateOfBirth ? `${formatDate(s.dateOfBirth)}${age != null ? ` (${age} yrs)` : ""}` : dash} />
                <Info icon={<UserRound />} label="Gender" value={safeTitle(s.gender)} />
                <Info icon={<Droplet />} label="Blood group" value={safe(s.bloodGroup)} />
                <Info icon={<CalendarDays />} label="Admitted on" value={safeDate(s.admissionDate)} />
                <Info icon={<Mail />} label="Email" value={safe(s.email)} />
                <Info icon={<Phone />} label="Phone" value={safe(s.phone)} />
                <Info icon={<MapPin />} label="Address" value={safe(s.address)} className="sm:col-span-2" />
              </dl>
            </Card>
            <Card>
              <CardHeader title="Parent contact" />
              <div className="p-5">
                {primaryContact ? (
                  <div className="flex items-start gap-3">
                    <Avatar name={primaryContact.name} />
                    <div className="text-sm">
                      <p className="font-semibold text-ink">{primaryContact.name}</p>
                      <p className="text-ink-muted">
                        {primaryContact.relation}{primaryContact.occupation ? ` · ${primaryContact.occupation}` : ""}
                      </p>
                      {primaryContact.phone && <p className="mt-2 text-ink-soft">{primaryContact.phone}</p>}
                      {primaryContact.email && <p className="text-ink-soft">{primaryContact.email}</p>}
                    </div>
                  </div>
                ) : <EmptyState title="No parent contact recorded" />}
              </div>
              {p.account?.email && (
                <p className="border-t border-line/60 px-5 py-3 text-[12.5px] text-ink-muted">
                  Portal login: <span className="font-mono text-ink-soft">{p.account.email}</span>
                </p>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="academic">
          <Card>
            <CardHeader
              title="Enrollment"
              description={[p.classLabel && `Class ${p.classLabel}`, p.room].filter(Boolean).join(" · ") || undefined}
            />
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
              <Info icon={<UserRound />} label="Class" value={safe(p.enrollment?.className)} />
              <Info icon={<UserRound />} label="Section" value={safe(p.enrollment?.sectionName)} />
              <Info icon={<UserRound />} label="Roll no." value={p.enrollment?.rollNo != null ? String(p.enrollment.rollNo) : dash} />
            </dl>
            {isAdmin && S && s.id && p.enrollment?.status === "active" && (
              <EnrollmentActions studentId={s.id} enrollmentId={p.enrollment.enrollmentId as string} sectionLabel={p.classLabel} studentName={name} />
            )}
            {p.teachers.length > 0 && (
              <>
                <CardHeader title="Subjects & teachers" />
                <ul className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
                  {p.teachers.map((t) => (
                    <li key={t.subjectId} className="rounded-xl border border-line/70 bg-alabaster/60 px-4 py-3">
                      <p className="text-sm font-semibold text-ink">{t.subject}</p>
                      <p className="text-[12.5px] text-ink-muted">{t.teacher}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          {p.access !== "assigned" && S && s.id && <div className="mt-4"><EnrollmentHistory studentId={s.id} /></div>}
        </TabsContent>

        <TabsContent value="attendance">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="flex flex-col items-center justify-center p-6 text-center">
              <ProgressRing value={pct ?? 0} size={132} stroke={11} sublabel="this year" />
              <dl className="mt-5 grid w-full grid-cols-3 gap-2 text-sm">
                <div><dt className="text-ink-muted">Present</dt><dd className="font-semibold text-ink">{p.attendance.stats.present}</dd></div>
                <div><dt className="text-ink-muted">Late</dt><dd className="font-semibold text-ink">{p.attendance.stats.late}</dd></div>
                <div><dt className="text-ink-muted">Absent</dt><dd className="font-semibold text-ink">{p.attendance.stats.absent}</dd></div>
              </dl>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Monthly attendance" description="Days present vs absent" />
              {p.attendance.monthly.length === 0 ? (
                <EmptyState title="No attendance recorded yet" />
              ) : (
                <div className="h-60 px-3 pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={p.attendance.monthly} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={CHART_GRID} />
                      <XAxis dataKey="label" {...axisProps} />
                      <YAxis {...axisProps} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(188,197,204,0.18)" }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="attended" name="Present (incl. late)" stackId="a" fill={CHART.primary} maxBarSize={34} stroke="#fff" strokeWidth={1} />
                      <Bar dataKey="absent" name="Absent" stackId="a" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={34} stroke="#fff" strokeWidth={1} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader title="Recent days" />
              {p.attendance.recent.length === 0 ? (
                <EmptyState title="No attendance records yet" />
              ) : (
                <ul className="flex flex-wrap gap-2 p-5">
                  {p.attendance.recent.map((r) => (
                    <li
                      key={r.date}
                      className={cn(
                        "w-[74px] rounded-xl border px-2 py-2 text-center",
                        r.status === "absent" ? "border-purple/30 bg-blush/40" : r.status === "late" ? "border-mauve/30 bg-lavender/20" : "border-line/70 bg-white",
                      )}
                    >
                      <p className="text-[11px] text-ink-muted">{formatWeekday(r.date)}</p>
                      <p className="text-sm font-semibold text-ink">{formatShortDate(r.date)}</p>
                      <p className={cn("text-[11px] font-semibold capitalize", r.status === "absent" || r.status === "late" ? "text-plum" : "text-lagoon")}>
                        {r.status}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        {p.fees && (
          <TabsContent value="fees">
            <LiveFeesPanel fees={p.fees} />
          </TabsContent>
        )}

        <TabsContent value="exams">
          <LiveResultsList results={p.results} />
        </TabsContent>

        <TabsContent value="homework">
          <LiveHomeworkList homework={p.homework} />
        </TabsContent>

        {p.access !== "assigned" && s.id && (
          <TabsContent value="documents">
            <StudentDocuments studentId={s.id} canManage={isAdmin} />
          </TabsContent>
        )}

        <TabsContent value="parent">
          {p.parentContacts.length === 0 ? (
            <Card><EmptyState title="No parent contact recorded" /></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {p.parentContacts.map((g) => (
                <Card key={g.id} className="p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={g.name} size="lg" />
                    <div className="min-w-0 text-sm">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-ink">{g.name}</p>
                        {g.isPrimary && <Badge tone="teal">Primary</Badge>}
                      </div>
                      <p className="text-ink-muted">{g.relation}{g.occupation ? ` · ${g.occupation}` : ""}</p>
                      <dl className="mt-3 space-y-1.5 text-ink-soft">
                        {g.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-ink-muted" aria-hidden />{g.phone}</div>}
                        {g.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-ink-muted" aria-hidden />{g.email}</div>}
                        {g.address && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-ink-muted" aria-hidden />{g.address}</div>}
                      </dl>
                    </div>
                  </div>
                  {g.otherChildren.length > 0 && (
                    <div className="mt-4 rounded-xl bg-alabaster p-3 text-sm">
                      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Also parent contact for</p>
                      {g.otherChildren.map((c) => (
                        <p key={c.id} className="mt-1">
                          {isAdmin
                            ? <Link href={`/admin/students/${c.id}`} className="font-medium text-lagoon hover:underline">{c.name}</Link>
                            : <span className="font-medium text-ink">{c.name}</span>}
                          {c.classLabel && <span className="text-ink-muted"> · Class {c.classLabel}</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value, tone, boxed }: { label: string; value: string; tone?: "warn"; boxed?: boolean }) {
  return (
    <div className={cn(boxed && "solid-card p-4")}>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={cn("mt-1 text-lg font-semibold", tone === "warn" ? "text-plum" : "text-sapphire")}>{value}</dd>
    </div>
  );
}

function Info({ icon, label, value, className }: { icon: React.ReactElement; label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-soft text-lagoon [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="text-[12px] text-ink-muted">{label}</dt>
        <dd className="break-words text-sm font-medium text-ink">{value}</dd>
      </div>
    </div>
  );
}
