/** Examinations' parts of the admin dashboard (contributed, see src/modules/examinations/contributions.tsx). */
import type { AdminAgendaItem, AdminDashboardVM } from "@/lib/contributions/types";
import { formatShortDate, todayISO } from "@/lib/utils/dates";
import { pluralize } from "@/lib/utils/format";

/**
 * Unpublished exams as schedule rows, labelled by where they actually are:
 * still to start, under way, or finished and waiting for marks / results.
 * Past exams are never called "upcoming".
 */
export function examAgenda(d: AdminDashboardVM, today = todayISO()): AdminAgendaItem[] {
  return d.upcomingExams.map((e) => {
    const scope = `${pluralize(e.classCount, "class", "classes")} · ${pluralize(e.paperCount, "paper")}`;
    const range = e.startDate === e.endDate ? formatShortDate(e.startDate) : `${formatShortDate(e.startDate)} – ${formatShortDate(e.endDate)}`;
    const base = { key: `exam-${e.id}`, title: e.name, href: `/admin/examinations/${e.id}` };
    if (e.status === "marks_entry" || e.endDate < today) {
      const progress = e.marksProgress === null ? "" : ` · ${Math.round(e.marksProgress)}% marks entered`;
      return { ...base, date: e.endDate, when: `Ended ${formatShortDate(e.endDate)}`, meta: `${scope}${progress}`, status: e.status === "marks_entry" ? "Marks entry" : "Results pending", tone: "warning" as const };
    }
    if (e.startDate <= today) {
      return { ...base, date: today, when: "Now", meta: `Until ${formatShortDate(e.endDate)} · ${scope}`, status: "Ongoing", tone: "accent" as const };
    }
    return { ...base, date: e.startDate, when: formatShortDate(e.startDate), meta: `${range} · ${scope}`, status: e.status === "draft" ? "Draft" : "Scheduled", tone: "neutral" as const };
  });
}
