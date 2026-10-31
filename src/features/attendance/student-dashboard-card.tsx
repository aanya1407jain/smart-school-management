"use client";
/** Attendance's card on the student dashboard (contributed, see src/modules/attendance/contributions.tsx). */
import { CalendarCheck2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolQuery } from "@/lib/convex/membership";
import { StatCard } from "@/components/ui";

export function AttendanceDashboardCard({ studentId, active }: { studentId: Id<"students">; active: boolean }) {
  const attendance = useSchoolQuery(api.attendance.studentHistory, active ? { studentId } : "skip");
  return <StatCard
          label="Attendance this year"
          value={attendance?.percentage != null ? `${attendance.percentage}%` : "—"}
          icon={<CalendarCheck2 className="h-5 w-5" />}
          tone="purple"
          hint={attendance ? (attendance.percentage == null ? "No attendance marked yet" : `${attendance.totals.presentCount + attendance.totals.lateCount} of ${attendance.records.filter((r) => r.status !== "excused").length} days`) : undefined}
          href="/student/attendance"
        />;
}
