/**
 * Module manifest. Examinations: exams, marks entry, results and report cards.
 *
 * Owned by the module and shipped only when the module is selected; the
 * composition root (src/modules/registry.generated.ts) lists the manifests of
 * the build, and navigation / route guards are built from it.
 */
import { defineModule, type RouteContribution } from "../../../convex/contracts/manifest";

const page = (path: string, anyOf: RouteContribution["anyOf"], roles: RouteContribution["roles"], publicReason?: string): RouteContribution => ({
  path, file: `src/app${path}/page.tsx`, roles, anyOf, ...(publicReason ? { publicReason } : {}),
});

export const examinations = defineModule({
  id: "examinations", version: "1.0.0", entitlementKey: "academics", // own key after the D2 migration
  requires: ["students", "academics"], optional: ["attendance"],
  publicEntries: {},
  sources: ["src/modules/manifests/examinations.ts", "convex/model/examRecords.ts", "src/features/examinations/", "convex/exams.ts", "convex/model/grading.ts"],
  permissions: ["exams:manage", "exams:publish", "marks:enter:any", "marks:enter:assigned", "exams:read:assigned", "results:read:own"],
  routes: [
    page("/admin/examinations", ["exams:manage"], ["admin"]),
    page("/admin/examinations/[id]", ["exams:manage"], ["admin"]),
    page("/admin/examinations/marks", ["marks:enter:any"], ["admin"]),
    page("/teacher/examinations", ["marks:enter:assigned"], ["teacher"]),
    page("/teacher/examinations/[id]", ["marks:enter:assigned"], ["teacher"]),
    page("/teacher/examinations/marks", ["marks:enter:assigned"], ["teacher"]),
    page("/student/results", ["results:read:own"], ["student"]),
  ],
  nav: [
    { role: "admin", group: "Daily operations", label: "Examinations", href: "/admin/examinations", icon: "exams", anyOf: ["exams:manage"], order: 22 },
    { role: "teacher", group: "Teaching", label: "Examinations", href: "/teacher/examinations", icon: "exams", anyOf: ["marks:enter:assigned"], order: 13 },
    { role: "student", group: "My school", label: "My Results", href: "/student/results", icon: "results", anyOf: ["results:read:own"], order: 13 },
  ],
  backend: {
    functionFiles: ["convex/examReports.ts", "convex/exams.ts"],
    tables: ["exams", "examSubjects", "marks", "results"],
    crons: [],
    migrations: [],
  },
  provides: ["examinations.studentStanding", "examinations.studentResults", "examinations.resultFiles", "examinations.overview", "examinations.teacherMarks"],
  consumes: [],
  contributes: { reportTabs: ["Examinations"], dashboardPanels: ["admin.academicPerformance", "teacher.marksToEnter"], studentProfileSections: ["results"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/exams.test.ts", "tests/convex/mvp-p1-exams-homework.test.ts"] },
});
