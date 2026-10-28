"use client";
/**
 * The LIVE student portal — for student accounts created by the school (session `dataSource === "live"`). Every value on these screens comes
 * from Convex for the student the SERVER links to the signed-in membership
 * (convex/studentPortal.ts, notifications.*; module cards are contributed by their modules).
 * Nothing here reads the in-browser demo data, and nothing is invented: when a
 * record or module is missing the page says so.
 */
import { type ReactNode } from "react";
import Link from "next/link";
import { Bell, FileText, GraduationCap, Hash, IdCard, School, UserRound, UsersRound } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolQuery } from "@/lib/convex/membership";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import { PasswordCard } from "@/features/profile/password-card";
import { Badge, Card, CardBody, CardHeader, EmptyState, LoadingState, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ROLE_LABELS, getNavigationForUser } from "@/lib/permissions";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { LiveEventsPanel } from "@/features/notices/events-live";
import { LiveCertificatesList, LiveNoticesList } from "./live-records";

export { PortalPage, LiveAware, LiveBoundary } from "@/features/live/portal";
import { LiveBoundary } from "@/features/live/portal";
import { contributionsTo } from "@/lib/contributions";

// ------------------------------------------------------------------ data
export function useMyProfile() {
  const studentId = useActiveStudentId();
  return useSchoolQuery(api.studentPortal.myProfile, studentId ? { studentId: studentId as Id<"students"> } : {});
}
type Profile = NonNullable<ReturnType<typeof useMyProfile>>;
type OkProfile = Extract<Profile, { state: "ok" }>;

export function MissingRecord() {
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

export function EnrollmentNotice({ p }: { p: OkProfile }) {
  if (p.enrollmentState === "active") return null;
  const text = p.enrollmentState === "no_current_year"
    ? "The school has not set its current academic year yet, so your class and section can't be shown."
    : p.enrollmentState === "missing"
      ? `You are not enrolled in a class for ${p.academicYear?.name ?? "the current academic year"}. Please contact the school office.`
      : `Your enrollment for ${p.academicYear?.name ?? "this year"} is ${p.enrollment?.status ?? "not active"}${p.enrollment?.endDate ? ` (since ${formatDate(p.enrollment.endDate)})` : ""}. Please contact the school office if this is unexpected.`;
  return <div role="status" data-testid="enrollment-notice" className="mb-5 rounded-xl border border-blush bg-blush/30 px-4 py-3 text-[13px] text-plum">{text}</div>;
}

const classLabel = (p: OkProfile) => p.enrollment?.sectionDisplayName ?? (p.enrollment?.className ? `${p.enrollment.className}${p.enrollment.sectionName ? `-${p.enrollment.sectionName}` : ""}` : "—");

/** Student-portal pages backed by the school's real records (live mode). */
/** The student's module pages, from the navigation built from the shipped modules' manifests (Core and this page excluded). */
const MY_SCHOOL_SKIP = new Set(["/student/dashboard", "/student/profile", "/student/notifications"]);

// ------------------------------------------------------------------ dashboard
export function LiveStudentDashboard() {
  const p = useMyProfile();
  const { user, hasModule } = useSession();
  const cards = contributionsTo("studentDashboard", hasModule);
  const unread = useSchoolQuery(api.notifications.unreadCount, {});
  if (p === undefined) return <LoadingState variant="page" label="Loading your dashboard" />;
  if (p.state === "no_student_record") return <MissingRecord />;
  return (
    <div data-testid="live-student-dashboard">
      <PageHeader
        eyebrow={p.academicYear ? `Academic year ${p.academicYear.name}` : undefined}
        title={`Welcome, ${p.student.firstName}`}
        description="Your school record, straight from the school office."
      />
      <EnrollmentNotice p={p} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Class & section" value={<span data-testid="dash-class">{classLabel(p)}</span>} icon={<GraduationCap className="h-5 w-5" />} hint={p.enrollment?.classTeacher ? `Class teacher: ${p.enrollment.classTeacher}` : undefined} />
        <StatCard label="Roll number" value={<span data-testid="dash-roll">{p.enrollment?.rollNo ?? "—"}</span>} icon={<Hash className="h-5 w-5" />} tone="sapphire" hint="Assigned alphabetically by the school" />
        {p.state === "ok" && cards.map((c, i) => <c.Card key={i} studentId={p.student.studentId} active={!!(p.academicYear && p.enrollment)} />)}
        <StatCard label="Unread notifications" value={unread ?? "—"} icon={<Bell className="h-5 w-5" />} tone="lavender" href="/student/notifications" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={self ? "My school record" : "Student record"} icon={<IdCard className="h-4 w-4" />} action={<Link href="/student/profile" className="text-[13px] font-medium text-lagoon hover:underline">View profile</Link>} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Name" value={p.student.name} testId="dash-name" />
              <Field label="Scholar number" value={p.student.scholarNo ?? "—"} testId="dash-scholar" />
              <Field label="Academic year" value={p.academicYear?.name ?? "Not set"} testId="dash-year" />
              <Field label="Enrollment" value={p.enrollment ? <StatusBadge status={p.enrollment.status} label={p.enrollment.status.charAt(0).toUpperCase() + p.enrollment.status.slice(1)} /> : "Not enrolled"} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="My school" description="Records kept by your school office" />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {getNavigationForUser(user).flatMap((g) => g.items).filter((i) => !MY_SCHOOL_SKIP.has(i.href)).map((m) => <li key={m.href}><Link href={m.href} className="font-medium text-lagoon hover:underline">{m.label}</Link></li>)}
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
              <Field label="Access" value={ROLE_LABELS.student} />
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
  // Student documents belong to Student Management: the section (and its query) only runs when the school has it.
  const { hasModule } = useSession();
  const s = p.student;
  const g = s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : null;
  return (
    <>
      <h2 className="pt-2 text-lg font-semibold text-sapphire">My school record</h2>
      <EnrollmentNotice p={p} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={s.name} description={s.scholarNo ? `Scholar No: ${s.scholarNo}` : undefined} icon={<IdCard className="h-4 w-4" />} action={<StatusBadge status={s.status} />} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="First name" value={s.firstName} />
              <Field label="Last name" value={s.lastName} />
              <Field label="Scholar number" value={s.scholarNo ?? "—"} testId="profile-scholar" />
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
              <Field label="Roll number" value={p.enrollment?.rollNo ?? "—"} testId="profile-roll" />
              <Field label="Class teacher" value={p.enrollment?.classTeacher ?? "—"} />
              <Field label="Room" value={p.enrollment?.room ?? "—"} />
              <Field label="Enrollment status" value={p.enrollment ? <StatusBadge status={p.enrollment.status} label={p.enrollment.status.charAt(0).toUpperCase() + p.enrollment.status.slice(1)} /> : "Not enrolled"} />
              <Field label="Enrolled since" value={p.enrollment ? formatDate(p.enrollment.startDate) : "—"} />
            </dl>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Parent contact" icon={<UsersRound className="h-4 w-4" />} />
        <CardBody>
          {p.parentContacts.length === 0 ? <p className="text-sm text-ink-muted">No parent contact is recorded. The school office can add one.</p> : (
            <ul className="divide-y divide-line/60 text-sm">
              {p.parentContacts.map((x, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-medium text-ink">{x.name} <span className="font-normal text-ink-muted">· {x.relationship}</span>{x.isPrimary && <Badge className="ml-2" tone="teal">Primary</Badge>}</span>
                  <span className="text-ink-muted">{x.phone}{x.email ? ` · ${x.email}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {hasModule("students") && (
        <div id="certificates" className="mt-4">
          <Card>
            <CardHeader title="Official Certificates & Documents" icon={<FileText className="h-4 w-4" />} />
            <CardBody>
              <StudentCertificatesSection studentId={p.student.studentId} />
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

function StudentCertificatesSection({ studentId }: { studentId: Id<"students"> }) {
  const data = useSchoolQuery(api.studentPortal.myCertificates, { studentId });
  if (data === undefined) return <p className="text-sm text-ink-muted">Loading documents…</p>;
  if (data.state !== "ok") return <p className="text-sm text-ink-muted">No documents available.</p>;
  return <LiveCertificatesList certificates={data.certificates} />;
}

// ------------------------------------------------------------------ notifications
// ------------------------------------------------------------------ timetable / homework / results / fees / notices
/** The portal query args: the signed-in student's own record (the server re-checks it). */
export function usePortalArgs() {
  const studentId = useActiveStudentId();
  return studentId ? { studentId: studentId as Id<"students"> } : {};
}

export function NotEnrolled({ what }: { what: string }) {
  return <Card className="mx-auto mt-6 max-w-xl"><EmptyState title="Not enrolled in a class" description={`${what} is shown for the class you are enrolled in. You are not actively enrolled in a class this year — please contact the school office.`} /></Card>;
}

export function LiveNotices() {
  const today = todayISO();
  const n = useSchoolQuery(api.studentPortal.myNotices, { ...usePortalArgs(), today });
  if (n === undefined) return <LoadingState variant="table" label="Loading notices" />;
  if (n.state === "no_student_record") return <MissingRecord />;
  return (<div className="mx-auto max-w-4xl"><PageHeader title="Notices" description="Announcements for the whole school, students, and your class." /><LiveEventsPanel /><LiveNoticesList notices={n.notices} /></div>);
}

export function LiveCertificates() {
  // Demo personas carry an in-browser student id ("stu_…"), not a Convex id: let the server resolve
  // the student from the signed-in membership instead (its seeded account is linked to the record).
  const { dataSource } = useSession();
  const portalArgs = usePortalArgs();
  const c = useSchoolQuery(api.studentPortal.myCertificates, dataSource === "live" ? portalArgs : {});
  if (c === undefined) return <LoadingState variant="table" label="Loading certificates" />;
  if (c.state === "no_student_record") return <MissingRecord />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My Certificates & Documents" description="Official verified documents issued by the school office." />
      <LiveCertificatesList certificates={c.certificates} />
    </div>
  );
}
