"use client";
/** Students' contributions to shared screens (src/lib/contributions/types.ts). */
import { UserPlus } from "lucide-react";
import type { ModuleUiContributions } from "@/lib/contributions/types";
import { AchievementsSection, AddStudentAction, StudentsStat } from "@/features/students/admin-dashboard-parts";
import { StudentStats } from "@/features/students/student-stats-report";
import { EnrollmentsSetupTab } from "@/features/students/enrollments-setup";

export const studentsUi: ModuleUiContributions = {
  academicsSetup: { module: "students", order: 40, tabs: [{ value: "enrollments", label: "Enrollments", order: 40, Content: EnrollmentsSetupTab }] },
  reportTabs: { module: "students", order: 10, tabs: [{ value: "students", label: "Student statistics", visible: (can) => can("reports:read"), Content: StudentStats }] },
  // Negative order: the students card comes before Core's "Teaching staff" card.
  adminDashboard: { module: "students", order: -10, HeaderActions: AddStudentAction, Stats: StudentsStat, Sections: AchievementsSection, quickActions: [{ label: "Add student", href: "/admin/students/new", Icon: UserPlus }] },
};
