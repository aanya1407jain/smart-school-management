"use client";
/** Students' parts of the admin dashboard (contributed, see src/modules/students/contributions.tsx). */
import { GraduationCap, UserPlus } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import type { AdminDashboardPartProps } from "@/lib/contributions/types";
import type { StudentAchievement } from "@/types/students";
import { LinkButton, StatCard } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";
import { StudentAchievementsCard } from "@/features/dashboard/student-achievements";

export function AddStudentAction() {
  return <LinkButton href="/admin/students/new" variant="outline"><UserPlus className="h-4 w-4" /> Add student</LinkButton>;
}

export function StudentsStat({ d, live }: AdminDashboardPartProps) {
  // The student total always follows the Students page's rule and records (students.studentCounts):
  // admissions are written to Convex for every admin, demo personas included.
  const counts = useSchoolQuery(api.students.studentCounts, live ? "skip" : {});
  return <StatCard label="Students enrolled" value={<span data-testid="dash-students">{live ? formatNumber(d.stats.students ?? 0) : counts === undefined ? "—" : formatNumber(counts?.enrolled ?? d.stats.students ?? 0)}</span>} icon={<GraduationCap className="h-5 w-5" />} hint={live ? `Across ${d.stats.sections} sections` : counts ? `${counts.academicYear.name} · same count as the Students page` : `Across ${d.stats.sections} sections`} href="/admin/students" />;
}

export function AchievementsSection({ d, live }: AdminDashboardPartProps) {
  return <StudentAchievementsCard achievements={d.achievements as StudentAchievement[]} live={live} />;
}
