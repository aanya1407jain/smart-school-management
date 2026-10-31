# Modular distribution — Step 1 proposal: contracts, manifests and registries

Status: **implemented (2026-10-27), approved as recommended: R1a, R2a, R3a, R4, R5, R6 specify-only.** Group A (tooling and tests) and Group B (`convex/contracts/*`) are in place; no application file was moved, and nothing imports the contracts at runtime yet. The manifests were written after Group B because they use its types. The original proposal text follows. This builds on [01-audit-and-target-design.md](01-audit-and-target-design.md) (decisions D1–D6), Step 0 (`scripts/modularity/ownership.ts`, `boundaries.ts`, `tests/convex/module-boundaries.test.ts`) and the 186-entry `boundary-baseline.json`.

---

## 0. Step 0 inspection

| File | State | Notes |
|---|---|---|
| `scripts/modularity/ownership.ts` | new, uncommitted (135 lines) | Owner per file/table, `REQUIRES`, `mayDepend`, `findRequiresCycle` |
| `scripts/modularity/boundaries.ts` | new, uncommitted (122 lines) | Import / `api.*` / table scanner + baseline writer |
| `tests/convex/module-boundaries.test.ts` | new, uncommitted | 7 tests, all pass; confirmed it fails on a probe Fees→Examinations import |
| `docs/modularization/*` | new, uncommitted | audit, appendix, baseline (186: 130 import, 35 table, 21 api) |

Full suite at Step 0: tsc clean, 48 files / 454 tests pass. Only `next-env.d.ts` (generated) and `convex-functions.json` (untracked, not ours) are otherwise dirty. Nothing was committed.

**Two gaps found while re-reading Step 0** (both fixed in the Step 1 plan, §7):

1. The scanner matches text inside comments. `src/lib/convex/membership.tsx` contributes 2 baseline entries (`api.attendance`, `api.imports`) that are **doc-comment examples**, not dependencies. Stripping comments is a scanner fix. The baseline then shrinks by real analysis, not by editing it to pass.
2. Deep imports between *allowed* modules are not yet checked. Fees may depend on Students, but should only reach Students' **public entry**. Step 0 has no notion of an entry point, so `fees → students/lifecycle/shared.tsx` passes. Step 1 adds the rule (§3, V9). It stays dormant for modules without a declared entry (none exist yet) and activates per module at extraction.

### 0.1 What the 186 violations are made of

- **55 are real cross-owner dependencies** (module→module or core→module). They define the contracts in §4.
- **131 point at transitional files**: `src/lib/services/index.ts` (32), `src/features/student-portal/live-portal.tsx` (32 — the `PortalPage` demo/live switch used by most route files), `src/types/domain.ts` (24), `convex/academics.ts` (14), `teacher-live.tsx` (7), other demo services (~20). They disappear when those files are split, not through contracts.

### 0.2 New findings that change the design

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **Academics needs Students** while it owns homework | `homework.ts` reads `enrollments`; `homeworkSubmissions.studentId → students`; `timetable.ts` uses `studentRecords.timetableFor` (student's own timetable) | Either Academics `requires: students` or homework becomes a separate unit (R1) |
| F2 | **Core schema references Students tables** | `schoolMemberships.studentId → students`, `schoolMemberships.guardianId → guardians`, `bulkAccountJobItems.studentId → students` | Student sign-in identity crosses Core/Students (R2) |
| F3 | **Core schema references Academics** | `teachers.specializationSubjectIds → subjects` | Teacher specialisations must move to an Academics-owned table, or become untyped (R3) |
| F4 | **`convex/staff.ts` mixes Core teacher records and Attendance staff attendance/leave** | the existing entitlement test already classifies `listTeachers`, `updateTeacher` as core inside it; reads `subjects`, `teacherAssignments` for specialisations and load | Split file in Step 2: `teachers.ts` (Core) + `attendance/staff.ts` |
| F5 | **Core calendar reads Attendance** | `events.ts` refuses a holiday on a date with marked registers (`attendanceSessions`) | Optional guard contract (`CalendarConflictProvider`) |
| F6 | **No cross-module side effects exist today** | every table is written only by its owner (except mixed `academics.ts` and `seed.ts`); notifications are written through Core | No event outbox is needed yet (§5) |

---

## 1. Contract and registry types

### 1.1 Where contracts live

Contracts must be importable by **both** the Convex bundle and the Next.js app, and must not import React or any module. The repo already does this for `convex/core/modules.ts` (imported by `src/` via `@convex/…`). Contracts follow the same pattern:

```
convex/contracts/
  ids.ts        # id contract: table → owner, parse/validate helpers
  manifest.ts   # ModuleManifest, defineModule, contribution types
  providers.ts  # provider interfaces (sync cross-module reads)
  registry.ts   # pure registry assembly + validation (no Convex runtime)
```

Files under `convex/` without exported functions are not public API (like `convex/core/modules.ts` today), so this adds no deployed functions.

### 1.2 Module ids and the entitlement catalogue (compatibility)

The stored entitlement keys **do not change** in Step 1. Target module ids map onto them:

```ts
// convex/contracts/manifest.ts
export const MODULE_IDS = ["students", "attendance", "academics", "fees", "examinations"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * Which stored entitlement key (convex/core/modules.ts, schoolModules) gates each module TODAY.
 * Examinations shares "academics" until the D2 migration adds a separate "examinations" key (§6.4).
 */
export const ENTITLEMENT_KEY: Record<ModuleId, ModuleKey> = {
  students: "students",
  attendance: "attendance",
  academics: "academics",
  fees: "finance",
  examinations: "academics",
};
```

### 1.3 Manifest

```ts
// convex/contracts/manifest.ts
import type { ModuleKey } from "../core/modules";
import type { Permission, Role } from "../core/permissions";

export type SemVer = `${number}.${number}.${number}`;

export type ModuleManifest<Id extends ModuleId = ModuleId> = {
  id: Id;
  version: SemVer;
  /** Stored entitlement key that gates this module at runtime (§1.2). */
  entitlementKey: ModuleKey;
  /** Shipped together with this module; the build never adds them silently. */
  requires: readonly ModuleId[];
  /** Integrations through Core contracts only (never imports). */
  optional: readonly ModuleId[];

  /** The ONLY paths other modules may import. Everything else in the module is private. */
  publicEntries: { frontend?: string; backend?: string };

  /** Source roots owned by the module (exported only when the module is selected). */
  sources: readonly string[];

  permissions: readonly Permission[];          // must be declared in core/permissions.ts; owned by exactly one module
  routes: readonly RouteContribution[];
  nav: readonly NavContribution[];

  backend: {
    /** Convex function files (repo-relative); every public function must use the module wrapper. */
    functionFiles: readonly string[];
    /** Tables this module owns (must equal TABLE_OWNER for the id). */
    tables: readonly string[];
    crons: readonly CronContribution[];
    migrations: readonly MigrationDeclaration[];
  };

  /** Provider implementations this module registers (§4). */
  provides: readonly ProviderId[];
  /** Providers this module consumes optionally (must handle absence). */
  consumes: readonly ProviderId[];

  /** Dashboard/report/profile contributions rendered by Core shells. */
  contributes?: { dashboardPanels?: readonly PanelId[]; reportTabs?: readonly string[]; studentProfileSections?: readonly string[] };

  /** Events: none today (§5). Kept so a future event is declared, not discovered. */
  events: { emits: readonly EventName[]; listens: readonly EventName[] };

  tests: { unit: readonly string[]; e2e?: readonly string[] };
};

export type RouteContribution = { path: string; file: string; roles: readonly Role[]; anyOf: readonly Permission[] };
export type NavContribution = { role: Role; group: string; label: string; href: string; icon: string; anyOf: readonly Permission[]; order: number };
export type CronContribution = { name: string; schedule: { daily: { hourUTC: number; minuteUTC: number } }; fn: string /* internal path */ };
export type MigrationDeclaration = { id: string; description: string; fn?: string; dataPreserving: true };

export function defineModule<const M extends ModuleManifest>(m: M): M { return m; }
```

`dataPreserving: true` is a literal type, so a migration that deletes business data cannot be declared through the manifest at all. Deletion stays an explicit operator action.

### 1.4 Ids

Convex `Id<"table">` is already a branded type, so it is the contract and no new brand is introduced. What is missing is validated parsing at the boundaries (URL params, form values), where code currently does `x as Id<"…">`:

```ts
// convex/contracts/ids.ts
export type OwnedTable = keyof typeof TABLE_OWNER_CONTRACT;      // generated from ownership (single source)
/** Narrow an untrusted string to an id shape (Convex ids are opaque; the server re-validates with v.id). */
export function parseIdParam<T extends string>(table: T, value: unknown): GenericId<T> | null;
```

The server keeps validating with `v.id(table)` and `getInSchool` (tenancy). `parseIdParam` only removes unchecked casts on the client. No `any` is introduced.

### 1.5 Registry

```ts
// convex/contracts/registry.ts — pure; used by tests, the export script and (later) the app shell
export type ModuleSelection = readonly ModuleId[];
export type RegistryProblem = { code: "UNKNOWN_MODULE" | "DUPLICATE" | "MISSING_REQUIRED" | "CYCLE" | "PERMISSION_OWNER" | "TABLE_OWNER" | "ROUTE_CONFLICT" | "UNDECLARED_PROVIDER" | "BAD_ENTRY"; detail: string };

export function validateManifests(all: readonly ModuleManifest[]): RegistryProblem[];
export function resolveSelection(all: readonly ModuleManifest[], selection: ModuleSelection): { modules: ModuleManifest[]; problems: RegistryProblem[] };
export function buildNavigation(modules: readonly ModuleManifest[], core: readonly NavContribution[]): NavContribution[];
export function buildRouteRules(modules: readonly ModuleManifest[], core: readonly RouteContribution[]): RouteContribution[];
```

The existing permission and entitlement filtering (`getNavigationForUser`, `canAccessRoute`) is applied **after** the registry builds the lists. The registry decides what *exists* in a build; permissions and entitlements decide what a *person in a school* may open.

---

## 2. Example manifests (real values from the repo)

```ts
export const students = defineModule({
  id: "students", version: "1.0.0", entitlementKey: "students",
  requires: [], optional: ["fees", "examinations", "attendance", "academics"],
  publicEntries: { frontend: "src/modules/students/index.ts", backend: "convex/students/contract.ts" },
  sources: ["src/modules/students/", "src/app/(students)/", "convex/students/"],
  permissions: ["students:read:all", "students:write", "students:lifecycle", "students:export"],
  routes: [
    { path: "/admin/students", file: "src/app/(students)/admin/students/page.tsx", roles: ["admin"], anyOf: ["students:read:all"] },
    { path: "/admin/promotions", file: "src/app/(students)/admin/promotions/page.tsx", roles: ["admin"], anyOf: ["students:lifecycle"] },
    { path: "/student/certificates", file: "src/app/(students)/student/certificates/page.tsx", roles: ["student"], anyOf: ["profile:read:own"] },
    { path: "/verify/tc/[code]", file: "src/app/(students)/verify/tc/[code]/page.tsx", roles: [], anyOf: [] }, // public by design
  ],
  nav: [
    { role: "admin", group: "People & academics", label: "Students", href: "/admin/students", icon: "students", anyOf: ["students:read:all"], order: 10 },
    { role: "admin", group: "People & academics", label: "Promotions & TC", href: "/admin/promotions", icon: "results", anyOf: ["students:lifecycle"], order: 11 },
  ],
  backend: {
    functionFiles: ["convex/studentLifecycle.ts", "convex/admissionRegister.ts", "convex/imports.ts", "convex/tcVerification.ts"],
    tables: ["students", "enrollments", "rollNumberHistory", "guardians", "guardianLinks", "admissionRegisterFields", "admissionRegisterValues", "transferCertificates", "promotionRuns"],
    crons: [], migrations: [],
  },
  provides: ["students.roster", "students.identity"],
  consumes: ["fees.studentDues", "examinations.studentStanding", "attendance.studentTotals", "academics.studentTimetable"],
  contributes: { reportTabs: ["Admissions"], dashboardPanels: ["admin.studentTotals"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/student-*.test.ts", "tests/convex/promotions-tc.test.ts", "tests/convex/roll-*.test.ts"] },
});

export const attendance = defineModule({
  id: "attendance", version: "1.0.0", entitlementKey: "attendance",
  requires: ["students"], optional: [],
  publicEntries: { frontend: "src/modules/attendance/index.ts", backend: "convex/attendance/contract.ts" },
  sources: ["src/modules/attendance/", "src/app/(attendance)/", "convex/attendance/"],
  permissions: ["attendance:read:all", "attendance:read:assigned", "attendance:read:own", "attendance:mark:class_teacher", "attendance:edit:class_teacher"],
  routes: [
    { path: "/admin/attendance", file: "src/app/(attendance)/admin/attendance/page.tsx", roles: ["admin"], anyOf: ["attendance:read:all"] },
    { path: "/teacher/attendance", file: "src/app/(attendance)/teacher/attendance/page.tsx", roles: ["teacher"], anyOf: ["attendance:read:assigned"] },
    { path: "/student/attendance", file: "src/app/(attendance)/student/attendance/page.tsx", roles: ["student"], anyOf: ["attendance:read:own"] },
  ],
  nav: [/* the three items above, groups "Daily operations" / "Teaching" / "My school" */],
  backend: {
    functionFiles: ["convex/attendance.ts", "convex/staff.ts" /* attendance half after F4 split */],
    tables: ["attendanceSessions", "attendanceRecords", "staffAttendance", "leaveRequests"],
    crons: [], migrations: [],
  },
  provides: ["attendance.studentTotals", "attendance.calendarConflicts"],
  consumes: [],
  contributes: { reportTabs: ["Attendance"], dashboardPanels: ["admin.attendanceTrend", "teacher.registerToday"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/attendance-*.test.ts", "tests/convex/a01-authorization.test.ts"] },
});
```

The other three, in short:

- **Academics**: `requires: ["students"]` (see R1), with the `timetable:*` and `homework:*` permissions. Its function files are `timetable.ts`, `timetableMaintenance.ts`, `homework.ts` and the assignments part of `academics.ts`. Tables: subjects, classSubjects, teacherAssignments, periods, timetableEntries, homework, homeworkSubmissions. It provides `academics.teacherScope`, `academics.studentTimetable`, `academics.subjects` and `academics.teacherSpecialisations`.
- **Fees**: `requires: ["students"]`, entitlement key `finance`, with `fees:manage`, `fees:read:own` and `reports:finance`. Files: `fees.ts`, `feeReminders.ts`. It has one cron (`fee-due reminders`, daily 02:30 UTC → `internal.feeReminders.runDaily`) and provides `fees.studentDues`, `fees.receiptFiles`.
- **Examinations**: `requires: ["students", "academics"]`, entitlement key `academics` until D2. Permissions: `exams:*`, `marks:*` and `results:read:own`. Files: `exams.ts`, `model/grading.ts`. Provides `examinations.studentStanding` and `examinations.resultFiles`.

**Permission ownership.** Core keeps `area:*`, `academics:manage` (school structure, per D1), `staff:manage`, `notices:*`, `notifications:read`, `reports:read`, `settings:manage`, `profile:read:own`, `users:manage`, `audit:read`, `files:upload` and `students:read:assigned`. The last one is the teacher's roster scope, used by Core's My Classes shell.

---

## 3. Dependency matrix and validation rules

### 3.1 Matrix (R1 resolved as recommended)

| ↓ may depend on → | Core | Students | Attendance | Academics | Fees | Examinations |
|---|---|---|---|---|---|---|
| **Core** | ✓ | contract only | contract only | contract only | contract only | contract only |
| **Students** | ✓ | ✓ | provider | provider | provider | provider |
| **Attendance** | ✓ | **requires** | ✓ | — | — | — |
| **Academics** | ✓ | **requires** (R1) | — | ✓ | — | — |
| **Fees** | ✓ | **requires** | — | — | ✓ | — |
| **Examinations** | ✓ | **requires** | provider (optional) | **requires** | — | ✓ |

How to read the table:
- **requires**: may import that module's *public entry* and read its tables through its contract; both modules always ship together.
- **provider**: optional. It goes through a Core registry; no import, and absence must be handled.
- **contract only**: Core defines an interface that the module implements.
- **—**: forbidden.

Valid products (closure enforced, never auto-completed):
- `students`
- `students+attendance` (no Academics)
- `students+fees`
- `students+attendance+fees`
- `students+academics`
- `students+academics+examinations`
- …and all five.

Invalid: any product containing attendance, fees, academics or examinations without students; examinations without academics.

### 3.2 Validation rules (all automated)

| Rule | Checked by |
|---|---|
| V1 every module id unique and known | `validateManifests` |
| V2 `requires` ⊆ known ids, graph acyclic | `validateManifests` (reuses `findRequiresCycle`) |
| V3 `requires`/`optional` disjoint; a module never lists itself | `validateManifests` |
| V4 every permission declared in `core/permissions.ts` and owned by exactly one module or Core | `validateManifests` |
| V5 `backend.tables` equals the module's rows in `TABLE_OWNER`; no table owned twice; every `convex/schema.ts` table owned | test + `validateManifests` |
| V6 every `functionFiles` entry exists and its public functions use the module's wrapper (extends existing `module-entitlements.test.ts`) | test |
| V7 every route `file` exists; no two modules claim a path; nav `href`s resolve to a declared route | test |
| V8 every consumed provider is provided by a module or marked optional with a declared fallback | `validateManifests` |
| V9 **public entry rule**: an import from owner A into a file of module B (A ≠ B, B ≠ core) must target B's `publicEntries`; dormant for B without entries | scanner |
| V10 selection closure: missing required module ⇒ error listing it, no auto-add | `resolveSelection` |
| V11 Core may not import a module (already in `mayDepend`) | scanner |
| V12 schema `v.id()` references respect `mayDepend` (F2/F3 recorded in baseline as `schema` violations) | scanner (new kind) |

---

## 4. Cross-module communication: synchronous contracts

Every one of the 55 real violations is a **read** (or a UI composition). Each maps to one Core-defined provider, registered by the owning module and consumed with an explicit "not installed" result:

| Provider | Implemented by | Consumed by | Replaces (baseline evidence) |
|---|---|---|---|
| `students.identity` (student actor → own record; membership link) | Students | Core authorization, accounts | `core/authorization.ts → students`; `accounts.ts`, `bulkAccounts.ts → students, enrollments` |
| `students.roster` (active roster of a section, enrollment lookup, roll order) | Students | Attendance, Academics (homework), Fees, Examinations, Core notifications | `homework.ts`, `fees.ts`, `model/feeData.ts`, `model/notifications.ts → enrollments`; `accounts.ts`, `model/academics.ts`, `sortedPagination.ts → rollNumbers` |
| `academics.teacherScope` (sections a teacher teaches) | Academics | Core authorization, profile | `core/authorization.ts`, `profile.ts → teacherAssignments` |
| `academics.subjects` / `academics.teacherSpecialisations` | Academics | Students import, Core staff records | `model/importers.ts`, `staff.ts → subjects` (F3/F4) |
| `academics.studentTimetable` | Academics | Students records | `model/studentRecords.ts → periods, timetableEntries` |
| `academics.studentHomework` | Academics | Students records | `model/studentRecords.ts → homework*` |
| `fees.studentDues` (`outstandingMinor`, `overdueMinor` for a year) | Fees | Students (TC dues gate, promotions) | `model/lifecycle.ts`, `studentLifecycle.ts → studentFees, feeConcessions, feePayments`; `→ feeMath, feeData` |
| `fees.studentLedger` (profile section) | Fees | Students records, student portal | `model/studentRecords.ts → fee tables, receipts` |
| `examinations.studentStanding` / `studentResults` | Examinations | Students (promotions, profile) | `model/lifecycle.ts`, `studentRecords.ts`, `studentLifecycle.ts → exams, results` |
| `attendance.studentTotals` (working / attended days) | Attendance | Students (TC) | `model/lifecycle.ts`, `studentLifecycle.ts → attendanceRecords` |
| `attendance.calendarConflicts` | Attendance | Core events | `events.ts → attendanceSessions` (F5) |
| `files.kindAuthorizer` (per file kind) | Fees (receipt), Examinations (report card), Academics (homework) | Core files | `files.ts → receipts, results, homework*, homeworkAccess` |
| `crons` contribution | Fees | Core `crons.ts` | `crons.ts → feeReminders` |

Absence semantics are decided per provider and tested:
- `fees.studentDues` absent ⇒ the TC gate shows **"Fees not installed — dues not checked"** and records that on the certificate audit trail. It is **never** treated as ₹0.
- `examinations.studentStanding` absent ⇒ standing "Not available" and default action Promote.
- `academics.teacherScope` absent ⇒ teacher read scope = class-teacher sections only. That is narrower, never broader.

A provider runs **inside the caller's Convex transaction** (plain function call, same `ctx`), so reads stay consistent and transactional, with no extra round trip.

Registration is static. Each module's `contract.ts` exports its provider implementations. The generated `convex/modules.generated.ts` imports only the selected modules' contracts and builds a typed registry object. There is no runtime discovery and no `any`.

---

## 5. Events: evaluation of the durable outbox

**Recommendation: do not build the outbox in Step 1, or in the extraction steps, unless a real cross-module side effect is introduced.**

Evidence: today no module writes another module's tables (F6). The only cross-cutting writes are notifications and audit entries, which are Core services called inside the same mutation. They are already transactional and need no events. Building an outbox now would add a table, a dispatcher, retries and dead-letter handling with zero producers. That is architecture for appearance, which the brief rules out.

What Step 1 does instead:
- `events: { emits: [], listens: [] }` is part of the manifest. A future event must be declared and reviewed, not discovered.
- The contract below is written down, so the first real need (likely "student withdrawn ⇒ Fees stops future installments") is implemented consistently.

**Design for when it is needed** (not implemented now):
- **Transaction boundary**: the emitter inserts `moduleEvents { eventId, name, version, payload, createdAt }` in the **same mutation** as the business change. Either both commit or neither does.
- **Delivery**: `ctx.scheduler.runAfter(0, internal.core.events.dispatch, { eventId })` is scheduled in that same mutation. The dispatcher calls each registered listener in **its own mutation**, so a failing listener cannot roll back the emitter or other listeners.
- **Idempotency**: listener state `(eventId, listener)` is unique. A listener writes its effect and marks itself `done` in one mutation, so a retried delivery sees `done` and skips. Payloads carry ids, not snapshots that could go stale.
- **Retries**: exponential backoff (1 m, 5 m, 30 m, 2 h, 12 h). After 5 failures the status becomes `dead` with the last error, an audit entry is written, and an admin-visible alert appears. No silent drop.
- **Absent listeners**: the dispatcher finds none registered and marks the event `delivered`. Emitters never import listeners.
- **Versioning**: `name@version`. A breaking payload change adds `@2`; listeners for `@1` keep working until removed.
- **Ownership**: the emitting module owns the event schema; each listener owns its handler and its failure handling.

---

## 6. Assembly of customer exports (design; implemented after extraction)

### 6.1 Schema composition

- Each module exports `export const studentsTables = { students: defineTable(…), … }` from `convex/<module>/schema.ts`. Core does the same in `convex/core/schema.ts`.
- `convex/schema.ts` becomes `defineSchema({ ...coreTables, ...selectedTables, ...retainedTables })`, with `selectedTables` imported from `convex/modules.generated.ts`.
- Cross-owner `v.id()` references (F2, F3) must be resolved first (R2, R3). Otherwise a Core table would reference a table absent from a Students-free schema.

### 6.2 Code generation and API references

- The export copies only Core plus the selected module folders, writes `modules.generated.ts`, then runs `npx convex codegen` (local; no deployment).
- `_generated/api.d.ts` and `dataModel.d.ts` are therefore regenerated from the files present. They contain only included modules by construction, and are never copied from this repo.
- A remaining `api.<excluded>.*` reference anywhere is a TypeScript error, which fails the export's `tsc` step.
- In this repo the internal full build keeps a checked-in "all modules" `modules.generated.ts`.

### 6.3 Route discovery and demo removal

- **Route discovery**: module routes move into route groups `src/app/(students)/…`. Excluding a module means not copying its group, so Next.js never discovers those pages and URLs are unchanged.
- **Demo removal (D4)**: 39 route files use `PortalPage`/`LiveAware`, most with both `demo={…}` and `live={…}` children, and the demo children import the mock services.
  - Each module route instead renders its live screen through a module-owned `ModulePage` that takes the demo screen from a generated `src/demo.generated.ts`.
  - In the internal build that file statically imports the demo screens. In customer exports it is generated as `export const demo = null`, and `src/lib/services`, `src/lib/mock-data` and the `*-demo.tsx` files are not copied.
  - The verification scan fails if any of them appear.
- **Navigation**: `buildNavigation(selected, coreNav)` replaces the hard-coded list in `src/lib/permissions/navigation.ts`, then the existing permission and entitlement filters apply.

### 6.4 Entitlement catalogue compatibility

| Change | When | Compatibility |
|---|---|---|
| Keep keys `students, academics, attendance, finance, administration` | Step 1 | `ENTITLEMENT_KEY` maps module ids onto them; nothing stored changes |
| Add key `examinations` (`legacyDefault: false`) | after Examinations extraction | Migration (dry-run first, then apply on dev with approval): for every school with `academics` enabled, add `examinations`. The Examinations wrapper switches to the new key in the same release, so no school loses access |
| Retire `administration` | after notices/events/reports move to Core and to per-module report tabs | Key kept as accepted-and-ignored for one release (stored rows untouched), then removed from the selection UI. Never reused |
| `finance` stays the stored key for Fees | permanent | label only |

### 6.5 Existing Convex functions and generated API

- **Step 1 renames nothing**: no function moves, no path changes, no schema edits.
- **Extraction (Step 3+)**: when a file moves to `convex/<module>/…`, its API path changes (D6).
  - Call sites are updated in the same change, guided by `tsc`.
  - For `internal.*` paths stored by crons or already-scheduled jobs (`feeReminders`, `memberships`, `notices`), a forwarding function stays at the old path until pending jobs have run.

---

## 7. Exact Step 1 file-by-file plan

Step 1 is **tooling, contracts and tests only**. Group A touches no application code. Group B adds contract files under `convex/contracts/`, which is application code by location; the proposed contents are §1. **Group B is written only after you approve this proposal.**

### Group A — tooling (scripts/, tests/, docs/)

| File | Change |
|---|---|
| `scripts/modularity/boundaries.ts` | (1) strip comments before matching (fixes the false positives); (2) new violation kind `schema` for cross-owner `v.id()` references (F2/F3); (3) public-entry rule V9, dormant until a module declares `publicEntries` |
| `scripts/modularity/ownership.ts` | `REQUIRES.academics = ["students"]` (R1); no other ownership changes |
| `scripts/modularity/manifests/*.ts` (5 files) | The five manifests from §2 with real current paths (pre-extraction `functionFiles`, current routes). They live in tooling until extraction moves them into module folders |
| `scripts/modularity/select.ts` | `resolveSelection` + an **inclusion plan** (dry run: which files of the current tree a product would ship, and which included files still depend on excluded owners). No copying |
| `tests/convex/module-boundaries.test.ts` | add V9 and schema-reference cases |
| `tests/convex/module-manifests.test.ts` (new) | V1–V8 against the real manifests, plus invalid fixtures (unknown id, missing dependency, cycle, duplicate table owner, unowned permission, missing route file, undeclared provider) |
| `tests/convex/module-selection.test.ts` (new) | product closure + the Students + Attendance blocker ratchet (§8) |
| `docs/modularization/boundary-baseline.json` | regenerated **only** by the scanner after the comment fix: −2 false positives (`membership.tsx`), + the new `schema` entries (F2/F3). The diff is shown for review; no entry is hand-deleted |
| `docs/modularization/sa-blockers-baseline.json` (new) | today's list of Students/Attendance/Core → Academics/Fees/Examinations dependencies (must shrink to 0 before the Students + Attendance export) |

### Group B — contracts (after approval)

| File | Content |
|---|---|
| `convex/contracts/manifest.ts` | §1.2–1.3 types, `defineModule`, `ENTITLEMENT_KEY` |
| `convex/contracts/providers.ts` | §4 provider interfaces (types only) |
| `convex/contracts/registry.ts` | §1.5 pure functions (`validateManifests`, `resolveSelection`, `buildNavigation`, `buildRouteRules`) |
| `convex/contracts/ids.ts` | `parseIdParam` |

Nothing imports Group B from application code in Step 1, so runtime behaviour cannot change. `tsc`, the full vitest suite and `next build` are re-run, and the boundary test must stay green against the regenerated baseline.

---

## 8. Tests

| Test | Proves |
|---|---|
| `module-manifests` › real manifests pass V1–V8 | contracts match the repo (tables, permissions, routes, function files, wrappers) |
| `module-manifests` › invalid fixtures each yield the expected `RegistryProblem` | validation actually rejects bad manifests (unknown id, missing required, cycle a→b→a, table owned twice, permission unowned, route file missing, provider consumed but not provided and not optional) |
| `module-selection` › closure | `["attendance"]` ⇒ `MISSING_REQUIRED students`; `["examinations","students"]` ⇒ `MISSING_REQUIRED academics`; `["students","attendance"]` valid; all five valid; nothing auto-added |
| `module-selection` › **Students + Attendance without Academics** | the inclusion plan for `students+attendance` contains no file owned by academics/fees/examinations, and the list of included files depending on excluded owners equals `sa-blockers-baseline.json` (a ratchet to 0) |
| `module-boundaries` › public entry (V9) | with a fixture manifest declaring an entry, a deep import into the module is a violation and an import of the entry is not |
| `module-boundaries` › schema references | F2/F3 appear as `schema` violations in the baseline; a new cross-owner `v.id()` fails |
| `module-boundaries` › comment stripping | an `api.x` inside a comment is not a dependency |
| existing suites | unchanged and green |

**What these do not prove yet.** The test "Students + Attendance compiles, deploys and runs with no Academics/Fees/Examinations source" is the export verification in the final step. Step 1 provides the ratchet that drives the remaining blockers to zero. Measured today: 33 direct dependencies from Core/Students/Attendance files on Academics/Fees/Examinations, in 11 files (studentRecords, lifecycle, TC dues gate, teacher scope, file kinds, calendar, crons, staff records), plus the transitional adapters, which are split separately.

---

## 9. Remaining decisions (please choose)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| R1 | Academics depends on Students (F1) | (a) `academics.requires = ["students"]`; (b) split homework into its own module requiring Students + Academics | **(a)**: every real product already includes Students; Students + Attendance stays Academics-free either way |
| R2 | Student identity in Core memberships (F2) | (a) keep `schoolMemberships.studentId`; Core reads it only through `students.identity`, and the student role is unavailable when Students is not shipped. (b) move the link to a Students-owned `studentAccounts` table (schema migration). (c) make the field an untyped string | **(a) now, (b) later if a Students-free product is ever sold**: all products include Students, and (b) touches sign-in, so it needs its own careful migration |
| R3 | Teacher specialisations (F3) | (a) move to Academics table `teacherSpecialisations` (data-preserving migration: copy, then stop reading the old field, field kept); (b) keep the field, exempt it in the baseline | **(a)**, scheduled with the Academics extraction |
| R4 | Contracts location | `convex/contracts/` (shared by app and Convex, like `core/modules.ts`) vs a new `packages/contracts` | **`convex/contracts/`**: no workspace tooling needed; extractable later |
| R5 | Manifests during transition | tooling (`scripts/modularity/manifests`) until extraction vs module folders now | **tooling now**: module folders do not exist yet; no app files move |
| R6 | Event outbox | build now vs specify only | **specify only (§5)** |

## 10. Risks

- **Two sources of truth during transition**: nav and routes stay hard-coded in `src/lib/permissions/*` while manifests also list them. Test V7 cross-checks both until the app switches to `buildNavigation`.
- **Comment-stripping regex** could mis-handle `//` inside strings (URLs). Mitigation: a small tokenizer that skips string literals, plus tests with URL strings.
- **Baseline growth** from the new `schema` kind is real debt made visible, not regression. It is reviewed in the diff.
- **Provider performance**: profile pages that call several providers do several reads, as today. No change in cost, only in structure.
- **Teammates' work** (Trisha: teacher portal/timetable/attendance UI; Apoorva: student portal/fees UI): Step 1 touches none of their files; extraction will.
- **Convex behaviour for a populated table missing from the schema** is still unverified and needs a scratch deployment with your approval. Retained-schema exports avoid depending on it.
