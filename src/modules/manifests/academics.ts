/**
 * Module manifest. Academics: subjects and curriculum, subject-teacher assignments, timetable and homework.
 *
 * Owned by the module and shipped only when the module is selected; the
 * composition root (src/modules/registry.generated.ts) lists the manifests of
 * the build, and navigation / route guards are built from it.
 */
import { defineModule, type RouteContribution } from "../../../convex/contracts/manifest";

const page = (path: string, anyOf: RouteContribution["anyOf"], roles: RouteContribution["roles"], publicReason?: string): RouteContribution => ({
  path, file: `src/app${path}/page.tsx`, roles, anyOf, ...(publicReason ? { publicReason } : {}),
});

export const academics = defineModule({
  id: "academics", version: "1.0.0", entitlementKey: "academics",
  requires: ["students"], optional: [],
  publicEntries: {},
  sources: ["src/modules/manifests/academics.ts", "convex/subjects.ts", "convex/model/academicsRecords.ts", "src/features/timetable/", "src/features/homework/", "convex/timetable.ts", "convex/timetableMaintenance.ts", "convex/homework.ts", "convex/model/homeworkAccess.ts"],
  permissions: ["timetable:manage", "timetable:read:own", "homework:read:all", "homework:manage:assigned", "homework:read:own", "homework:submit"],
  routes: [
    page("/admin/timetable", ["timetable:manage"], ["admin"]),
    page("/teacher/timetable", ["timetable:read:own"], ["teacher"]),
    page("/teacher/homework", ["homework:manage:assigned"], ["teacher"]),
    page("/teacher/homework/[id]", ["homework:manage:assigned"], ["teacher"]),
    page("/student/timetable", ["timetable:read:own"], ["student"]),
    page("/student/homework", ["homework:read:own"], ["student"]),
  ],
  nav: [
    { role: "admin", group: "Daily operations", label: "Timetable", href: "/admin/timetable", icon: "timetable", anyOf: ["timetable:manage"], order: 23 },
    { role: "teacher", group: "Teaching", label: "Homework", href: "/teacher/homework", icon: "homework", anyOf: ["homework:manage:assigned"], order: 12 },
    { role: "teacher", group: "Teaching", label: "Timetable", href: "/teacher/timetable", icon: "timetable", anyOf: ["timetable:read:own"], order: 14 },
    { role: "student", group: "My school", label: "My Timetable", href: "/student/timetable", icon: "timetable", anyOf: ["timetable:read:own"], order: 11 },
    { role: "student", group: "My school", label: "My Homework", href: "/student/homework", icon: "homework", anyOf: ["homework:read:own"], order: 12 },
  ],
  backend: {
    functionFiles: ["convex/subjects.ts", "convex/timetable.ts", "convex/timetableMaintenance.ts", "convex/homework.ts"],
    tables: ["subjects", "classSubjects", "teacherAssignments", "periods", "timetableEntries", "homework", "homeworkSubmissions"],
    crons: [],
    migrations: [],
  },
  provides: ["academics.teacherScope", "academics.subjects", "academics.studentTimetable", "academics.studentHomework", "academics.homeworkFiles", "academics.teacherDay"],
  consumes: [],
  contributes: { dashboardPanels: ["teacher.todayTimetable", "teacher.homeworkToReview"], studentProfileSections: ["timetable", "homework"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/timetable-homework.test.ts", "tests/convex/syllabus-pacing.test.ts"] },
});
