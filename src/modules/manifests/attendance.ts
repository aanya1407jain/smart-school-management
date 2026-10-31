/**
 * Module manifest. Attendance: student registers, holidays-vs-registers, staff attendance and leave.
 *
 * Owned by the module and shipped only when the module is selected; the
 * composition root (src/modules/registry.generated.ts) lists the manifests of
 * the build, and navigation / route guards are built from it.
 */
import { defineModule, type RouteContribution } from "../../../convex/contracts/manifest";

const page = (path: string, anyOf: RouteContribution["anyOf"], roles: RouteContribution["roles"], publicReason?: string): RouteContribution => ({
  path, file: `src/app${path}/page.tsx`, roles, anyOf, ...(publicReason ? { publicReason } : {}),
});

export const attendance = defineModule({
  id: "attendance", version: "1.0.0", entitlementKey: "attendance",
  requires: ["students"], optional: [],
  publicEntries: {},
  sources: ["src/modules/manifests/attendance.ts", "src/features/attendance/", "convex/attendance.ts", "convex/staff.ts", "convex/model/attendanceRecords.ts"],
  permissions: ["attendance:read:all", "attendance:read:assigned", "attendance:read:own", "attendance:mark:class_teacher", "attendance:edit:class_teacher"],
  routes: [
    page("/admin/attendance", ["attendance:read:all"], ["admin"]),
    page("/teacher/attendance", ["attendance:read:assigned"], ["teacher"]),
    page("/student/attendance", ["attendance:read:own"], ["student"]),
  ],
  nav: [
    { role: "admin", group: "Daily operations", label: "Attendance", href: "/admin/attendance", icon: "attendance", anyOf: ["attendance:read:all"], order: 20 },
    { role: "teacher", group: "Teaching", label: "Attendance", href: "/teacher/attendance", icon: "attendance", anyOf: ["attendance:read:assigned"], order: 11 },
    { role: "student", group: "My school", label: "My Attendance", href: "/student/attendance", icon: "attendance", anyOf: ["attendance:read:own"], order: 10 },
  ],
  backend: {
    functionFiles: ["convex/attendanceReports.ts", "convex/attendance.ts", "convex/staff.ts"],
    tables: ["attendanceSessions", "attendanceRecords", "staffAttendance", "leaveRequests"],
    crons: [],
    migrations: [],
  },
  provides: ["attendance.studentRecords", "attendance.calendarConflicts", "attendance.overview", "attendance.registers"],
  consumes: [],
  contributes: { reportTabs: ["Attendance"], dashboardPanels: ["admin.attendanceTrend", "teacher.registerToday"], studentProfileSections: ["attendance"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/attendance-summary.test.ts", "tests/convex/a01-authorization.test.ts"] },
});
