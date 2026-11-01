/**
 * Target module ownership (docs/modularization/01-audit-and-target-design.md).
 *
 * The single source of truth for WHICH module owns each source file and each
 * Convex table, and which modules a module may depend on. The boundary test
 * (tests/convex/module-boundaries.test.ts) enforces these rules as a ratchet:
 * today's violations are recorded in docs/modularization/boundary-baseline.json
 * and may only shrink as modules are extracted.
 *
 * Decisions applied: D1 school structure (years/classes/sections) is Core;
 * D3 homework → academics, staff attendance & leave → attendance, notices &
 * events → core, reports are contributed per module; D4 the in-browser demo
 * layer is internal-only and never ships to customers.
 *
 * "transitional" marks files that mix several owners today (adapters, mixed
 * backend files, the demo layer, shared domain types). They are allowed to
 * import anything while they exist; every one of them is scheduled to be split.
 */

export const TARGET_MODULES = ["core", "students", "attendance", "academics", "fees", "examinations"] as const;
export type TargetModule = (typeof TARGET_MODULES)[number];
/**
 * Non-module owners:
 *  - "composition": generated composition roots (registries, crons, schema) that
 *    import the selected modules; regenerated per export; only Core imports them.
 *  - "demo": the internal demo layer (in-browser mock services and demo-only
 *    screens); never shipped to customers (D4).
 *  - "transitional": files that still mix owners and are scheduled to be split.
 */
export type Owner = TargetModule | "transitional" | "composition" | "demo";

/** Required modules (always shipped together). Core is implicit for everyone. */
export const REQUIRES: Record<Exclude<TargetModule, "core">, readonly TargetModule[]> = {
  students: [],
  attendance: ["students"],
  // R1: Academics owns homework (submissions are by students; homework reads rosters) and the
  // student's own timetable, so it requires Students. Students + Attendance stays Academics-free.
  academics: ["students"],
  fees: ["students"],
  examinations: ["students", "academics"],
};

/**
 * Public entry points per module (V9): once a module declares entries, other
 * owners may import ONLY these files from it. Empty until a module is extracted
 * (the rule is dormant for modules without entries).
 */
export const PUBLIC_ENTRIES: Partial<Record<TargetModule, readonly string[]>> = {};

/** Ordered rules: the first matching pattern decides the owner of a repo-relative path. */
export const FILE_RULES: readonly [RegExp, Owner][] = [
  // ---------------------------------------------------------------- convex
  [/^convex\/core\//, "core"],
  [/^convex\/contracts\//, "core"], // public module contracts (types + pure registry); import nothing from modules
  [/^src\/modules\/registry\.generated\.ts$/, "composition"],
  [/^src\/modules\/manifests\/core\.ts$/, "core"],
  [/^src\/modules\/manifests\/students\.ts$/, "students"],
  [/^src\/modules\/manifests\/attendance\.ts$/, "attendance"],
  [/^src\/modules\/manifests\/academics\.ts$/, "academics"],
  [/^src\/modules\/manifests\/fees\.ts$/, "fees"],
  [/^src\/modules\/manifests\/examinations\.ts$/, "examinations"],
  [/^convex\/(registry\.generated|demo\.generated|crons|schema)\.ts$/, "composition"],
  [/^convex\/seedData\//, "demo"], // the internal demo school (D4)
  [/^convex\/seed\.ts$/, "demo"],
  [/^convex\/migrations\.ts$/, "core"],
  [/^convex\/(auth|auth\.config|users|account|memberships|schools|schoolModules|profile|audit|notifications|setup|http|notices|events|academicYearMaintenance|academics|teachers)\.ts$/, "core"],
  [/^convex\/(accounts|bulkAccounts|files|studentLoginMigration)\.ts$/, "core"],
  [/^convex\/(students|studentReports|studentPortal|studentLifecycle|admissionRegister|imports|scholarNumberMaintenance|rollNumberMaintenance|tcVerification)\.ts$/, "students"],
  [/^convex\/(attendance|attendanceReports|staff)\.ts$/, "attendance"],
  [/^convex\/(fees|feeReports|feeReminders)\.ts$/, "fees"],
  [/^convex\/(exams|examReports)\.ts$/, "examinations"],
  [/^convex\/(subjects|timetable|timetableMaintenance|homework)\.ts$/, "academics"],
  [/^convex\/(reports|dashboards)\.ts$/, "core"], // admin and teacher dashboards; module parts come through providers
  [/^convex\/model\/(audit|calendar|counters|loginIds|memberships|modules|notifications|sortedPagination|accounts|academics)\.ts$/, "core"],
  [/^convex\/model\/(rollNumbers|scholarNumbers|studentCounts|studentRecords|lifecycle|importSpecs|importers|portalStudent|studentProviders)\.ts$/, "students"],
  [/^convex\/model\/attendanceRecords\.ts$/, "attendance"],
  [/^convex\/model\/feeRecords\.ts$/, "fees"],
  [/^convex\/model\/examRecords\.ts$/, "examinations"],
  [/^convex\/model\/academicsRecords\.ts$/, "academics"],
  [/^convex\/model\/(feeData|feeMath)\.ts$/, "fees"],
  [/^convex\/model\/grading\.ts$/, "examinations"],
  [/^convex\/model\/homeworkAccess\.ts$/, "academics"],
  // ---------------------------------------------------------------- frontend: shared kit and infrastructure
  [/^src\/proxy\.ts$/, "core"],
  [/^src\/components\//, "core"],
  // demo layer (D4: internal-only, never shipped): in-browser services, mock data, store, demo model and demo-only screens
  [/^src\/lib\/(services|mock-data|store)\//, "demo"],
  [/^src\/types\/domain\.ts$/, "demo"],
  [/^src\/features\/(teachers\/(teachers-workspace|teacher-form|teacher-profile)|profile\/profile-page|attendance\/my-attendance|students\/(students-list|demo-student-profile)|academics\/academics-workspace-demo|homework\/(my-homework-demo|homework-manager)|auth\/demo-accounts|examinations\/(exams-list|exam-detail|marks-entry|teacher-exams|my-results|result-sheet|demo-result-card)|fees\/my-fees|timetable\/(timetable-pages|week-grid))\.tsx?$/, "demo"],
  [/^src\/lib\/(convex|hooks|utils|constants|permissions|demo|contributions)\//, "core"],
  [/^src\/types\/core\.ts$/, "core"],
  [/^src\/types\/students\.ts$/, "students"],
  [/^src\/types\/attendance\.ts$/, "attendance"],
  [/^src\/types\/academics\.ts$/, "academics"],
  [/^src\/types\/fees\.ts$/, "fees"],
  [/^src\/types\/examinations\.ts$/, "examinations"],
  [/^src\/modules\/(ui|demo)\.generated\.ts$/, "composition"],
  [/^src\/modules\/students\//, "students"],
  [/^src\/modules\/attendance\//, "attendance"],
  [/^src\/modules\/academics\//, "academics"],
  [/^src\/modules\/fees\//, "fees"],
  [/^src\/modules\/examinations\//, "examinations"],
  // ---------------------------------------------------------------- frontend: features
  [/^src\/features\/(auth|settings|profile|audit|notifications|shared|imports|notices|live)\//, "core"],
  [/^src\/features\/student-portal\//, "students"], // the student portal is part of Students
  [/^src\/features\/accounts\/import-wizard\.tsx$/, "students"],
  [/^src\/features\/accounts\//, "core"],
  [/^src\/features\/students\//, "students"],
  [/^src\/features\/attendance\//, "attendance"],
  [/^src\/features\/fees\//, "fees"],
  [/^src\/features\/examinations\//, "examinations"],
  [/^src\/features\/(timetable|homework)\//, "academics"],
  [/^src\/features\/academics\/(subjects-setup|syllabus-tracker|pacing)\.tsx?$/, "academics"], // subjects, curriculum, subject teachers, pacing
  [/^src\/features\/academics\//, "core"], // school structure setup shell (years, classes, sections, class teachers)
  [/^src\/features\/teachers\/my-classes\.tsx$/, "demo"], // demo My Classes
  [/^src\/features\/teachers\//, "core"],
  [/^src\/features\/dashboard\/(student|teacher)-dashboard\.tsx$/, "demo"], // demo dashboards
  [/^src\/features\/(dashboard|reports)\//, "core"], // shells: module parts are contributions
  // ---------------------------------------------------------------- frontend: routes
  [/^src\/app\/(admin\/(students|promotions)|student\/(certificates|profile|notices|dashboard)|teacher\/(students|classes)|verify)(\/|$)/, "students"],
  [/^src\/app\/(admin|teacher|student)\/attendance(\/|$)/, "attendance"],
  [/^src\/app\/(admin|student)\/fees(\/|$)/, "fees"],
  [/^src\/app\/((admin|teacher)\/examinations|student\/results)(\/|$)/, "examinations"],
  [/^src\/app\/((admin|teacher|student)\/timetable|(teacher|student)\/homework)(\/|$)/, "academics"],
  [/^src\/app\//, "core"],
];

export function ownerOf(path: string): Owner | null {
  for (const [re, owner] of FILE_RULES) if (re.test(path)) return owner;
  return null;
}

/** Owner of every table in convex/schema.ts (plus the Convex Auth tables). */
export const TABLE_OWNER: Record<string, TargetModule> = {
  // core: identity, tenancy, school structure (D1), communications (D3), shared infrastructure
  _storage: "core", // Convex system table (file storage), referenced by v.id("_storage")
  users: "core", authAccounts: "core", authSessions: "core", authRefreshTokens: "core", authVerificationCodes: "core", authVerifiers: "core", authRateLimits: "core",
  schools: "core", schoolSettings: "core", schoolModules: "core", schoolMemberships: "core", teachers: "core",
  academicYears: "core", classes: "core", sections: "core",
  counters: "core", auditLogs: "core", files: "core", notifications: "core", notices: "core", events: "core",
  bulkAccountJobs: "core", bulkAccountJobItems: "core",
  // students
  students: "students", enrollments: "students", rollNumberHistory: "students", guardians: "students", guardianLinks: "students",
  admissionRegisterFields: "students", admissionRegisterValues: "students", transferCertificates: "students", promotionRuns: "students",
  // attendance (incl. staff attendance & leave, D3)
  attendanceSessions: "attendance", attendanceRecords: "attendance", staffAttendance: "attendance", leaveRequests: "attendance",
  // academics (incl. homework, D3)
  subjects: "academics", classSubjects: "academics", teacherAssignments: "academics", periods: "academics", timetableEntries: "academics",
  homework: "academics", homeworkSubmissions: "academics",
  // fees
  feeStructures: "fees", studentFees: "fees", feeConcessions: "fees", feePayments: "fees", receipts: "fees",
  // examinations
  exams: "examinations", examSubjects: "examinations", marks: "examinations", results: "examinations",
};

/**
 * The base module (step 3 decision): every valid product contains Students —
 * each other module requires it and a product cannot be empty (select.ts) —
 * so Core's identity layer may reference it: student logins
 * (schoolMemberships.studentId, R2a), student-access authorization, rosters for
 * notifications and the student import in Accounts. Enforced by
 * tests/convex/module-selection.test.ts ("every valid product contains the base
 * module"); remove this to return to a Students-independent Core.
 */
export const BASE_MODULE = "students" as const;

/** May code owned by `from` depend on code/tables owned by `to`? */
export function mayDepend(from: Owner, to: Owner): boolean {
  if (from === "transitional") return true; // scheduled to be split; reported, not enforced
  if (from === "composition" || from === "demo") return true; // composition roots / internal demo may import any module
  if (to === "composition") return from === "core"; // only Core reads the generated registries
  if (to === "demo") return false; // nothing that ships may import the demo layer
  if (to === "core" || to === from) return true;
  if (to === "transitional") return false; // modules and core must not lean on mixed files
  if (from === "core") return to === BASE_MODULE; // core depends on no business module except the base module
  return (REQUIRES[from] as readonly string[]).includes(to);
}

/** Cycle check over REQUIRES (returns one cycle path, or null). */
export function findRequiresCycle(requires: Record<string, readonly string[]> = REQUIRES): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (m: string): string[] | null => {
    if (state.get(m) === "done") return null;
    if (state.get(m) === "visiting") return [...path.slice(path.indexOf(m)), m];
    state.set(m, "visiting");
    path.push(m);
    for (const d of requires[m] ?? []) { const c = visit(d); if (c) return c; }
    path.pop();
    state.set(m, "done");
    return null;
  };
  for (const m of Object.keys(requires)) { const c = visit(m); if (c) return c; }
  return null;
}
