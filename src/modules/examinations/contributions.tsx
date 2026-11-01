"use client";
/** Examinations' contributions to shared screens (src/lib/contributions/types.ts). */
import type { ModuleUiContributions } from "@/lib/contributions/types";
import { LiveResultsList } from "@/features/examinations/live-results";
import { formatPercent } from "@/lib/utils/format";
import { MarksPanel, MarksStat } from "@/features/examinations/teacher-dashboard-parts";
import { examAgenda } from "@/features/examinations/admin-dashboard-parts";
import { AcademicReport, ExamReport } from "@/features/examinations/exam-reports";

export const examinationsUi: ModuleUiContributions = {
  reportTabs: { module: "academics", order: 40, tabs: [
    { value: "exams", label: "Examination performance", visible: (can) => can("reports:read"), Content: ExamReport },
    { value: "academic", label: "Academic performance", visible: (can) => can("reports:read"), Content: AcademicReport },
  ] },
  adminDashboard: { module: "academics", order: 30, agenda: (d) => examAgenda(d) },
  teacherDashboard: { module: "academics", order: 30, Stats: MarksStat, Panels: MarksPanel },
  studentProfile: {
    module: "academics", // Examinations shares the stored "academics" entitlement until the D2 migration
    order: 30,
    metrics: (p) => {
      const latest = p.results[0];
      return [{ key: "result", label: "Latest result", value: latest?.percentage != null ? `${formatPercent(latest.percentage, 1)}${latest.grade ? ` · ${latest.grade}` : ""}` : "—" }];
    },
    tabs: (p) => [{ value: "exams", label: "Examinations", count: p.results.length, content: <LiveResultsList results={p.results} /> }],
  },
};
