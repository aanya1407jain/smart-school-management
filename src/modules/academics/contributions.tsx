"use client";
/** Academics' contributions to shared screens (src/lib/contributions/types.ts). */
import type { ModuleUiContributions } from "@/lib/contributions/types";
import { LiveHomeworkList, homeworkState } from "@/features/homework/live-homework-list";
import { HomeworkAction, TeachingPanels, TeachingStats } from "@/features/homework/teacher-dashboard-parts";
import { AssignmentsSetupTab, CurriculumAction, PacingOverviewTab, SubjectsSetupTab } from "@/features/academics/subjects-setup";

export const academicsUi: ModuleUiContributions = {
  // Not gated by an entitlement: subjects and curriculum never were (convex/subjects.ts keeps core wrappers).
  academicsSetup: {
    order: 0,
    tabs: [
      { value: "setup", label: "Overview", order: 0, Content: PacingOverviewTab },
      { value: "subjects", label: "Subjects", order: 30, Content: SubjectsSetupTab },
      { value: "assignments", label: "Teacher assignments", order: 50, Content: AssignmentsSetupTab },
    ],
    ClassAction: CurriculumAction,
  },
  teacherDashboard: { module: "academics", order: 20, Actions: HomeworkAction, Stats: TeachingStats, Panels: TeachingPanels },
  studentProfile: {
    module: "academics",
    order: 40,
    metrics: (p) => [{ key: "homework", label: "Pending homework", value: String(p.homework.filter((h) => { const st = homeworkState(h); return st === "pending" || st === "overdue"; }).length) }],
    tabs: (p) => [{ value: "homework", label: "Homework", count: p.homework.length, content: <LiveHomeworkList homework={p.homework} /> }],
  },
};
