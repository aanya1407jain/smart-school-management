/**
 * Module manifest. Students: admissions, records, enrollment, promotions & TC, the student profile and the student-portal identity.
 *
 * Owned by the module and shipped only when the module is selected; the
 * composition root (src/modules/registry.generated.ts) lists the manifests of
 * the build, and navigation / route guards are built from it.
 */
import { defineModule, type RouteContribution } from "../../../convex/contracts/manifest";

const page = (path: string, anyOf: RouteContribution["anyOf"], roles: RouteContribution["roles"], publicReason?: string): RouteContribution => ({
  path, file: `src/app${path}/page.tsx`, roles, anyOf, ...(publicReason ? { publicReason } : {}),
});

export const students = defineModule({
  id: "students", version: "1.0.0", entitlementKey: "students",
  requires: [], optional: ["attendance", "academics", "fees", "examinations"],
  publicEntries: {},
  sources: ["src/features/students/", "src/features/accounts/import-wizard.tsx", "src/modules/manifests/students.ts", "convex/students.ts", "convex/studentPortal.ts", "convex/studentLifecycle.ts", "convex/admissionRegister.ts", "convex/imports.ts", "convex/tcVerification.ts", "convex/scholarNumberMaintenance.ts", "convex/rollNumberMaintenance.ts", "convex/model/rollNumbers.ts", "convex/model/scholarNumbers.ts", "convex/model/studentCounts.ts", "convex/model/studentRecords.ts", "convex/model/lifecycle.ts", "convex/model/importSpecs.ts", "convex/model/importers.ts", "convex/model/portalStudent.ts", "convex/model/studentProviders.ts"],
  permissions: ["students:read:all", "students:write", "students:lifecycle", "students:export"],
  routes: [
    page("/admin/students", ["students:read:all"], ["admin"]),
    page("/admin/students/new", ["students:write"], ["admin"]),
    page("/admin/students/[id]", ["students:read:all"], ["admin"]),
    page("/admin/students/[id]/edit", ["students:write"], ["admin"]),
    page("/admin/promotions", ["students:lifecycle"], ["admin"]),
    // A teacher's sections with their rosters (My Classes).
    page("/teacher/classes", ["students:read:assigned"], ["teacher"]),
    page("/teacher/classes/[id]", ["students:read:assigned"], ["teacher"]),
    page("/teacher/students/[id]", ["students:read:assigned"], ["teacher"]),
    // The student portal (dashboard, profile, notices addressed to the student) belongs to Students.
    page("/student/dashboard", ["area:student"], ["student"]),
    { ...page("/student/notices", ["notices:read"], ["student"]), entitlementKey: "administration" },
    page("/student/profile", ["profile:read:own"], ["student"]),
    page("/student/certificates", ["profile:read:own"], ["student"]),
    page("/verify/tc/[code]", [], [], "Public verification of a printed transfer certificate by its random code; shows certificate facts only."),
  ],
  nav: [
    { role: "admin", group: "People & academics", label: "Students", href: "/admin/students", icon: "students", anyOf: ["students:read:all"], order: 10 },
    { role: "admin", group: "People & academics", label: "Promotions & TC", href: "/admin/promotions", icon: "results", anyOf: ["students:lifecycle"], order: 11 },
    { role: "teacher", group: "Teaching", label: "My Classes", href: "/teacher/classes", icon: "classes", anyOf: ["students:read:assigned"], order: 10 },
    { role: "student", group: "Overview", label: "Dashboard", href: "/student/dashboard", icon: "dashboard", anyOf: ["area:student"], order: 0 },
    { role: "student", group: "Updates", label: "Notices", href: "/student/notices", icon: "notices", anyOf: ["notices:read"], order: 30, entitlementKey: "administration" },
    { role: "student", group: "Updates", label: "Profile", href: "/student/profile", icon: "profile", anyOf: ["profile:read:own"], order: 32 },
    { role: "student", group: "My school", label: "Certificates", href: "/student/certificates", icon: "results", anyOf: ["profile:read:own"], order: 14 },
  ],
  backend: {
    functionFiles: ["convex/studentReports.ts", "convex/students.ts", "convex/studentPortal.ts", "convex/studentLifecycle.ts", "convex/admissionRegister.ts", "convex/imports.ts", "convex/tcVerification.ts", "convex/scholarNumberMaintenance.ts", "convex/rollNumberMaintenance.ts"],
    tables: ["students", "enrollments", "rollNumberHistory", "guardians", "guardianLinks", "admissionRegisterFields", "admissionRegisterValues", "transferCertificates", "promotionRuns"],
    crons: [],
    migrations: [],
  },
  provides: ["students.roster"],
  consumes: ["attendance.studentRecords", "academics.studentHomework", "academics.subjects", "fees.studentDues", "fees.studentLedger", "examinations.studentStanding", "examinations.studentResults"],
  contributes: { reportTabs: ["Admissions"], dashboardPanels: ["admin.studentTotals"], studentProfileSections: ["profile", "enrollmentHistory", "certificates"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/student-lifecycle.test.ts", "tests/convex/promotions-tc.test.ts", "tests/convex/student-admission.test.ts", "tests/convex/roll-numbers.test.ts"] },
});
