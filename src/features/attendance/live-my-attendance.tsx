"use client";
/**
 * The LIVE student portal's My Attendance page (Attendance module).
 */
import { CalendarCheck2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import { Card, CardBody, CardHeader, LoadingState, PageHeader, ProgressRing, StatCard, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";
import { MissingRecord, EnrollmentNotice, useMyProfile } from "@/features/student-portal/live-portal";

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
      <PageHeader title="My Attendance" description={`${p.academicYear.name} · ${formatDate(h.range.from)} – ${formatDate(h.range.to)}`} />
      <EnrollmentNotice p={p} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

