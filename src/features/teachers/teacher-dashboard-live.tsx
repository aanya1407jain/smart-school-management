"use client";
/**
 * The LIVE teacher landing page (Core): today's work from Convex for the
 * signed-in teacher only (dashboards.teacherOverview). Registers, lessons,
 * homework and marks panels are contributed by Attendance, Academics and
 * Examinations when they are shipped in the build (src/lib/contributions) and
 * follow the school's module entitlements.
 */
import Link from "next/link";
import { Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { Card, CardHeader, EmptyState, LoadingState } from "@/components/ui";
import { formatDate, formatLongDate, greeting } from "@/lib/utils/dates";
import { useSession } from "@/features/auth/session-provider";
import { contributionsTo } from "@/lib/contributions";

export function LiveTeacherDashboard() {
  const { user, hasModule } = useSession();
  const AD = hasModule("administration");
  const d = useSchoolQuery(api.dashboards.teacherOverview, {});
  const notices = useSchoolQuery(api.notices.feed, AD ? {} : "skip");
  if (d === undefined) return <LoadingState variant="cards" label="Loading your day" />;
  const parts = contributionsTo("teacherDashboard", hasModule);
  const nothingAssigned = d.classTeacherOf.length === 0 && d.assignments.length === 0;
  return (
    <div className="space-y-6" data-testid="live-teacher-dashboard">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">{formatLongDate(d.today)}</p>
          <h1 className="mt-1 text-[28px] font-semibold text-sapphire">{greeting()}{user?.displayName ? `, ${user.displayName}` : ""}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {d.classTeacherOf.length > 0 ? <>Class teacher of <strong className="text-ink">{d.classTeacherOf.map((s) => s.displayName).join(", ")}</strong> · </> : null}
            {d.assignments.length} subject assignment{d.assignments.length === 1 ? "" : "s"}
            {!d.isWorkingDay && " · Not a school day"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {parts.map((c, i) => c.Actions && <c.Actions key={i} d={d} />)}
        </div>
      </div>

      {!d.hasTeacherRecord || nothingAssigned ? (
        <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No classes assigned yet" description="Once the school office assigns you a section or subjects in Academics, your registers, lessons, homework and marks tasks appear here." /></Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {parts.map((c, i) => c.Stats && <c.Stats key={i} d={d} />)}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {parts.map((c, i) => c.Panels && <c.Panels key={i} d={d} />)}
      </div>

      {AD && <Card>
        <CardHeader title="Recent notices" action={<Link href="/teacher/notices" className="text-[13px] font-medium text-lagoon hover:underline">All notices</Link>} />
        <div className="p-5 pt-2">
          {notices === undefined ? <LoadingState variant="inline" /> : notices.length === 0 ? <EmptyState title="No notices" /> : (
            <ul className="divide-y divide-line/60">
              {notices.slice(0, 4).map((n) => (
                <li key={n.noticeId} className="py-2.5"><p className="font-medium text-ink">{n.title}</p><p className="text-[12px] text-ink-muted">{formatDate(n.publishDate)} · {n.audienceLabel}</p></li>
              ))}
            </ul>
          )}
        </div>
      </Card>}
    </div>
  );
}
