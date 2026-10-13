"use client";
/**
 * The LIVE student portal — for student and guardian accounts created by the
 * school (session `dataSource === "live"`). Every value on these screens comes
 * from Convex for the student the SERVER links to the signed-in membership
 * (convex/studentPortal.ts, attendance.studentHistory, notifications.*).
 * Nothing here reads the in-browser demo data, and nothing is invented: when a
 * record or module is missing the page says so.
 */
import { Component, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarCheck2, CheckCheck, GraduationCap, Hash, IdCard, Lock, School, UserRound, UsersRound } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { useActiveStudentId, useSession, type DataSource } from "@/features/auth/session-provider";
import { PasswordCard } from "@/features/profile/profile-page";
import { CategoryIcon } from "@/features/notifications/category-icon";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, LoadingState, PageHeader, ProgressRing, StatCard, StatusBadge, useToast } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { NotificationCategory } from "@/types/domain";

// ------------------------------------------------------------------ switch
/** Renders the demo-data page or the live (Convex) page for the current session. */
export function PortalPage({ demo, live }: { demo: ReactNode; live: ReactNode }) {
  const { dataSource } = useSession();
  return <>{(dataSource as DataSource | null) === "live" ? <LiveBoundary>{live}</LiveBoundary> : demo}</>;
}

/** Server errors from live queries become an in-page message instead of a crashed screen. */
class LiveBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const app = getAppError(this.state.error);
    return (
      <Card className="mx-auto mt-6 max-w-xl">
        <EmptyState
          icon={<Lock className="h-6 w-6" />}
          title={app?.code === "NOT_FOUND" ? "Record not available" : "Something went wrong"}
          description={app?.message ?? "We couldn't load your school records. Please try again, or contact the school office if this continues."}
          action={<Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>}
        />
      </Card>
    );
  }
}

// ------------------------------------------------------------------ data
function useMyProfile() {
  const studentId = useActiveStudentId();
  return useSchoolQuery(api.studentPortal.myProfile, studentId ? { studentId: studentId as Id<"students"> } : {});
}
type Profile = NonNullable<ReturnType<typeof useMyProfile>>;
type OkProfile = Extract<Profile, { state: "ok" }>;

function MissingRecord() {
  const { viewer } = useSession();
  return (
    <Card className="mx-auto mt-6 max-w-xl" data-testid="student-record-missing">
      <EmptyState
        icon={<IdCard className="h-6 w-6" />}
        title="Your student record isn't linked to this account"
        description={<>Your sign-in works, but {viewer?.school.name ?? "the school"} has not linked this account (Login ID <span className="font-mono font-semibold">{viewer?.loginId ?? "—"}</span>) to a student record. Please contact the school office and quote your Login ID.</>}
        action={<Link href="/account" className="inline-flex h-10 items-center rounded-xl border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-alabaster">My account</Link>}
      />
    </Card>
  );
}

function EnrollmentNotice({ p }: { p: OkProfile }) {
  if (p.enrollmentState === "active") return null;
  const text = p.enrollmentState === "no_current_year"
    ? "The school has not set its current academic year yet, so your class and section can't be shown."
    : p.enrollmentState === "missing"
      ? `You are not enrolled in a class for ${p.academicYear?.name ?? "the current academic year"}. Please contact the school office.`
      : `Your enrollment for ${p.academicYear?.name ?? "this year"} is ${p.enrollment?.status ?? "not active"}${p.enrollment?.endDate ? ` (since ${formatDate(p.enrollment.endDate)})` : ""}. Please contact the school office if this is unexpected.`;
  return <div role="status" data-testid="enrollment-notice" className="mb-5 rounded-xl border border-blush bg-blush/30 px-4 py-3 text-[13px] text-plum">{text}</div>;
}

const classLabel = (p: OkProfile) => p.enrollment?.sectionDisplayName ?? (p.enrollment?.className ? `${p.enrollment.className}${p.enrollment.sectionName ? `-${p.enrollment.sectionName}` : ""}` : "—");

/** Modules whose student pages are not connected to the school's records yet. */
const NOT_CONNECTED = ["Timetable", "Homework", "Results", "Fees", "Notices"];

// ------------------------------------------------------------------ dashboard
export function LiveStudentDashboard() {
  const p = useMyProfile();
  const { user } = useSession();
  const unread = useSchoolQuery(api.notifications.unreadCount, {});
  const attendance = useSchoolQuery(
    api.attendance.studentHistory,
    p?.state === "ok" && p.academicYear && p.enrollment ? { studentId: p.student.studentId } : "skip",
  );
  if (p === undefined) return <LoadingState variant="page" label="Loading your dashboard" />;
  if (p.state === "no_student_record") return <MissingRecord />;
  const self = p.relation === "self";
  return (
    <div data-testid="live-student-dashboard">
      <PageHeader
        eyebrow={p.academicYear ? `Academic year ${p.academicYear.name}` : undefined}
        title={self ? `Welcome, ${p.student.firstName}` : p.student.name}
        description={self ? "Your school record and attendance, straight from the school office." : `You're viewing ${p.student.firstName}'s record as ${user?.displayName ?? "a guardian"}.`}
      />
      <EnrollmentNotice p={p} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Class & section" value={<span data-testid="dash-class">{classLabel(p)}</span>} icon={<GraduationCap className="h-5 w-5" />} hint={p.enrollment?.classTeacher ? `Class teacher: ${p.enrollment.classTeacher}` : undefined} />
        <StatCard label="Roll number" value={<span data-testid="dash-roll">{p.enrollment?.rollNo ?? "—"}</span>} icon={<Hash className="h-5 w-5" />} tone="sapphire" hint="Assigned alphabetically by the school" />
        <StatCard
          label="Attendance this year"
          value={attendance?.percentage != null ? `${attendance.percentage}%` : "—"}
          icon={<CalendarCheck2 className="h-5 w-5" />}
          tone="purple"
          hint={attendance ? (attendance.percentage == null ? "No attendance marked yet" : `${attendance.totals.presentCount + attendance.totals.lateCount} of ${attendance.records.filter((r) => r.status !== "excused").length} days`) : undefined}
          href="/student/attendance"
        />
        <StatCard label="Unread notifications" value={unread ?? "—"} icon={<Bell className="h-5 w-5" />} tone="lavender" href="/student/notifications" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={self ? "My school record" : "Student record"} icon={<IdCard className="h-4 w-4" />} action={<Link href="/student/profile" className="text-[13px] font-medium text-lagoon hover:underline">View profile</Link>} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Name" value={p.student.name} testId="dash-name" />
              <Field label="Admission number" value={p.student.admissionNo} testId="dash-admission" />
              <Field label="Academic year" value={p.academicYear?.name ?? "Not set"} testId="dash-year" />
              <Field label="Enrollment" value={p.enrollment ? <StatusBadge status={p.enrollment.status} label={p.enrollment.status.charAt(0).toUpperCase() + p.enrollment.status.slice(1)} /> : "Not enrolled"} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="More modules" description="Being connected to your school's records" />
          <CardBody>
            <ul className="space-y-2 text-sm text-ink-muted">
              {NOT_CONNECTED.map((m) => <li key={m} className="flex items-center justify-between"><span>{m}</span><Badge>Not available yet</Badge></li>)}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink" data-testid={testId}>{value ?? "—"}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ profile
export function LiveStudentProfile() {
  const p = useMyProfile();
  const { viewer, user } = useSession();
  if (p === undefined) return <LoadingState variant="page" label="Loading your profile" />;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="live-student-profile">
      <PageHeader title="Profile" description="Your account and the school record the office keeps for you." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" icon={<UserRound className="h-4 w-4" />} />
          <CardBody>
            <dl className="grid gap-3 text-sm">
              <Field label="Signed in as" value={viewer?.displayName} />
              <Field label="Login ID" value={<span className="font-mono">{viewer?.loginId ?? "—"}</span>} testId="profile-login-id" />
              <Field label="Access" value={user?.guardianId ? "Guardian (student portal)" : ROLE_LABELS.student} />
              <Field label="School" value={viewer?.school.name} />
            </dl>
          </CardBody>
        </Card>
        <PasswordCard />
      </div>
      {p.state === "no_student_record" ? <MissingRecord /> : <StudentRecord p={p} />}
    </div>
  );
}

function StudentRecord({ p }: { p: OkProfile }) {
  const s = p.student;
  const g = s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : null;
  return (
    <>
      <h2 className="pt-2 text-lg font-semibold text-sapphire">{p.relation === "self" ? "My school record" : "Student record"}</h2>
      <EnrollmentNotice p={p} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={s.name} description={`Admission no. ${s.admissionNo}`} icon={<IdCard className="h-4 w-4" />} action={<StatusBadge status={s.status} />} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="First name" value={s.firstName} />
              <Field label="Last name" value={s.lastName} />
              <Field label="Admission number" value={s.admissionNo} testId="profile-admission" />
              <Field label="Admission date" value={s.admissionDate ? formatDate(s.admissionDate) : "—"} />
              <Field label="Date of birth" value={s.dateOfBirth ? formatDate(s.dateOfBirth) : "—"} />
              <Field label="Gender" value={g ?? "—"} />
              <Field label="Blood group" value={s.bloodGroup ?? "—"} />
              <Field label="Email" value={s.email ?? "—"} />
              <Field label="Phone" value={s.phone ?? "—"} />
              <Field label="Address" value={s.address ?? "—"} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Class & enrollment" icon={<School className="h-4 w-4" />} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Academic year" value={p.academicYear?.name ?? "Not set"} testId="profile-year" />
              <Field label="Class" value={p.enrollment?.className ?? "—"} testId="profile-class" />
              <Field label="Section" value={p.enrollment?.sectionName ?? "—"} testId="profile-section" />
              <Field label="Roll number" value={p.enrollment?.rollNo ?? "—"} />
              <Field label="Class teacher" value={p.enrollment?.classTeacher ?? "—"} />
              <Field label="Room" value={p.enrollment?.room ?? "—"} />
              <Field label="Enrollment status" value={p.enrollment ? <StatusBadge status={p.enrollment.status} label={p.enrollment.status.charAt(0).toUpperCase() + p.enrollment.status.slice(1)} /> : "Not enrolled"} />
              <Field label="Enrolled since" value={p.enrollment ? formatDate(p.enrollment.startDate) : "—"} />
            </dl>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Guardians" icon={<UsersRound className="h-4 w-4" />} />
        <CardBody>
          {p.guardians.length === 0 ? <p className="text-sm text-ink-muted">No guardian is recorded. The school office can add one.</p> : (
            <ul className="divide-y divide-line/60 text-sm">
              {p.guardians.map((x, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-medium text-ink">{x.name} <span className="font-normal text-ink-muted">· {x.relationship}</span>{x.isPrimary && <Badge className="ml-2" tone="teal">Primary</Badge>}</span>
                  <span className="text-ink-muted">{x.phone}{x.email ? ` · ${x.email}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ attendance
export function LiveMyAttendance() {
  const p = useMyProfile();
  const h = useSchoolQuery(api.attendance.studentHistory, p?.state === "ok" && p.academicYear ? { studentId: p.student.studentId } : "skip");
  if (p === undefined || (p.state === "ok" && p.academicYear && h === undefined)) return <LoadingState variant="page" label="Loading attendance" />;
  if (p.state === "no_student_record") return <MissingRecord />;
  if (!p.academicYear || !h) {
    return <><PageHeader title="My Attendance" /><EnrollmentNotice p={p} /></>;
  }
  const records = [...h.records].reverse();
  const below = h.percentage != null && h.percentage < h.lowAttendanceThreshold;
  return (
    <div data-testid="live-attendance">
      <PageHeader title={p.relation === "self" ? "My Attendance" : `${p.student.firstName}'s Attendance`} description={`${p.academicYear.name} · ${formatDate(h.range.from)} – ${formatDate(h.range.to)}`} />
      <EnrollmentNotice p={p} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center gap-2 p-6">
          <ProgressRing value={h.percentage} label={h.percentage == null ? "—" : `${h.percentage}%`} sublabel="attendance" tone={below ? "plum" : "teal"} />
          <p className="text-center text-[13px] text-ink-muted">{h.percentage == null ? "No attendance has been marked yet this year." : below ? `Below the school's ${h.lowAttendanceThreshold}% requirement.` : `At or above the school's ${h.lowAttendanceThreshold}% requirement.`}</p>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard label="Present" value={h.totals.presentCount} icon={<CalendarCheck2 className="h-5 w-5" />} />
          <StatCard label="Absent" value={h.totals.absentCount} icon={<CalendarCheck2 className="h-5 w-5" />} tone="lavender" />
          <StatCard label="Late" value={h.totals.lateCount} icon={<CalendarCheck2 className="h-5 w-5" />} tone="purple" />
          <StatCard label="Excused" value={h.totals.excusedCount} icon={<CalendarCheck2 className="h-5 w-5" />} tone="sapphire" />
        </div>
      </div>
      <Card className="mt-5">
        <CardHeader title="Day by day" description="Most recent first" />
        <CardBody>
          {records.length === 0 ? <p className="text-sm text-ink-muted">No attendance has been marked for you yet.</p> : (
            <ul className="divide-y divide-line/60 text-sm">
              {records.map((r) => (
                <li key={r.date} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink">{formatDate(r.date)}{r.remark ? <span className="ml-2 text-ink-muted">· {r.remark}</span> : null}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ notifications
const CATEGORY: Record<string, NotificationCategory> = {
  attendance: "attendance", fees: "fees", homework: "homework", examination: "examination", notice: "notice", general: "general", account: "general",
};

export function LiveNotifications() {
  const router = useRouter();
  const { toast } = useToast();
  const items = useSchoolQuery(api.notifications.list, { limit: 100 });
  const markRead = useSchoolMutation(api.notifications.markRead);
  const markAll = useSchoolMutation(api.notifications.markAllRead);
  if (items === undefined) return <LoadingState variant="table" label="Loading notifications" />;
  const unread = items.filter((n) => !n.isRead).length;
  return (
    <div className="mx-auto max-w-4xl" data-testid="live-notifications">
      <PageHeader
        title="Notifications"
        description={unread ? `You have ${unread} unread notification${unread > 1 ? "s" : ""}.` : "You're all caught up."}
        actions={unread > 0 && <Button variant="outline" onClick={async () => { await markAll({}); toast({ title: "All notifications marked as read" }); }}><CheckCheck className="h-4 w-4" /> Mark all as read</Button>}
      />
      {items.length === 0 ? <Card><EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Updates from your school will appear here." /></Card> : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line/60">
            {items.map((n) => (
              <li key={n._id} className={cn("flex items-start gap-3 px-4 py-3.5 sm:px-5", !n.isRead && "bg-teal-soft/30")}>
                <CategoryIcon category={CATEGORY[n.type] ?? "general"} className="mt-0.5" />
                <button className="min-w-0 flex-1 text-left" onClick={async () => { if (!n.isRead) await markRead({ notificationId: n._id }); if (n.href?.startsWith("/student/")) router.push(n.href); }}>
                  <p className={cn("text-sm", n.isRead ? "font-medium text-ink-soft" : "font-semibold text-ink")}>{n.title}</p>
                  <p className="mt-0.5 text-[13px] text-ink-muted">{n.message}</p>
                  <p className="mt-1 text-[11.5px] text-ink-muted" title={formatDateTime(new Date(n._creationTime).toISOString())}>{relativeTime(new Date(n._creationTime).toISOString())}</p>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ not connected
export function ModuleNotConnected({ module }: { module: string }) {
  return (
    <Card className="mx-auto mt-6 max-w-xl" data-testid="module-not-connected">
      <EmptyState
        title={`${module} isn't available yet`}
        description={`${module} is not connected to your school's records yet, so there is nothing to show here. Your dashboard, attendance, notifications and profile are up to date.`}
        action={<Link href="/student/dashboard" className="inline-flex h-10 items-center rounded-xl bg-sapphire px-4 text-sm font-semibold text-white hover:bg-lagoon">Go to dashboard</Link>}
      />
    </Card>
  );
}
