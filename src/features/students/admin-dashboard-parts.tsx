"use client";
/** Students' parts of the admin dashboard (contributed, see src/modules/students/contributions.tsx). */
import { GraduationCap } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useSchoolQuery } from "@/lib/convex/membership";
import type { AdminDashboardPartProps } from "@/lib/contributions/types";
import type { AchievementCategory, StudentAchievement } from "@/types/students";
import { Collapsible, MetricCard } from "@/features/dashboard/principal-ui";
import { formatNumber, pluralize } from "@/lib/utils/format";
import { formatShortDate } from "@/lib/utils/dates";

const CATEGORY: Record<AchievementCategory, string> = { sports: "Sports", academic: "Academic", special: "Special recognition" };

export function StudentsMetric({ d, live }: AdminDashboardPartProps) {
  // The student total always follows the Students page's rule and records (students.studentCounts):
  // admissions are written to Convex for every admin, demo personas included.
  const counts = useSchoolQuery(api.students.studentCounts, live ? "skip" : {});
  const value = live ? formatNumber(d.stats.students ?? 0) : counts === undefined ? "—" : formatNumber(counts?.enrolled ?? d.stats.students ?? 0);
  return (
    <MetricCard
      label="Students enrolled"
      value={<span data-testid="dash-students">{value}</span>}
      support={`Across ${pluralize(d.stats.sections, "section")}`}
      icon={GraduationCap}
      href="/admin/students"
    />
  );
}

/** Achievements have no page of their own yet, so they stay reachable here, collapsed. */
export function AchievementsSecondary({ d }: AdminDashboardPartProps) {
  const items = [...(d.achievements as StudentAchievement[])].sort((a, b) => b.date.localeCompare(a.date));
  if (items.length === 0) return null;
  return (
    <Collapsible summary="Student achievements" hint={`${items.length} recorded this year`}>
      <ul className="space-y-2.5" data-testid="dash-achievements">
        {items.map((a) => (
          <li key={a.id} className="text-[13px] leading-5">
            <p className="break-words font-medium text-pd-ink">{a.studentName} <span className="font-normal text-pd-muted">· {a.classLabel}</span></p>
            <p className="break-words text-pd-muted">{a.title} · {CATEGORY[a.category]} · {formatShortDate(a.date)}</p>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}
