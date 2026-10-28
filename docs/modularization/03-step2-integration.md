# Step 2 — Modular integration (uncommitted, for review)

## Outcome

| Measure | Before | After |
|---|---|---|
| Students + Attendance blockers (`sa-blockers-baseline.json`) | 34 | **0** |
| Transitional (mixed-owner) files | 53 | **0** |
| Module-boundary violations (`boundary-baseline.json`, shrink only) | 190 | **39** |
| Standalone S+A export: owner scan, forbidden refs, routes, schema, Convex tsc, app tsc, `next build` | — | **9/9 PASS** |

## How module code is reached now

- **Backend reads go through providers** (`convex/contracts/providers.ts`, `convex/core/registry.ts`). New in this step: `attendance.registers`, `attendance.overview`, `academics.teacherDay`, `examinations.teacherMarks`, `examinations.overview`, `fees.overview`, and `students.roster.enrolledCount` / `enrollmentHealth`. The registry is built lazily (`providers()`), because provider files import Core, which imports the registry.
- **Mixed backend files were split**:
  - `academics.ts` became Core structure, with subjects moved to `subjects.ts` and students to `students.ts`. Teacher records went to `teachers.ts`.
  - The reports were split into `studentReports.ts`, `attendanceReports.ts`, `feeReports.ts` and `examReports.ts`.
  - `reports.adminDashboard` and `dashboards.teacherOverview` are Core and keep their response shapes, filled through providers.
  - The student-portal queries moved to their modules: `timetable.myStudentTimetable`, `homework.myHomework`, `exams.myResults` and `fees.myFees`.
- **UI contributions** (`src/lib/contributions`, composed in `src/modules/ui.generated.ts`): modules fill Core slots, namely the student profile, student dashboard, teacher dashboard, admin dashboard, report tabs and Academics setup. Each module's parts live in `src/modules/<module>/contributions.tsx`.
- **Navigation and route guards are built from manifests**. The manifests moved to `src/modules/manifests/` and are composed in `src/modules/registry.generated.ts`, so there are no hard-coded paths. `isRouteShipped()` hides links to modules that are not in the build.
- **Demo layer (D4)**:
  - The new owner `demo` covers `src/lib/services`, mock-data, store, `types/domain.ts`, `convex/seedData`, `seed.ts` and the demo-only screens.
  - Shipped code reaches it only through the typed Core port `src/lib/demo/runtime.ts` and `DemoSlot`. Exports set `DEMO = null`.
  - Domain types are split per owner (`src/types/{core,students,attendance,academics,fees,examinations}.ts`).
- **Ownership moves**: the student portal routes, My Classes, the teacher student views and certificates now belong to Students.

## Packaging

```
npx tsx scripts/distribute.ts <out-dir-outside-repo> students attendance [--skip-build]
```

- **Copies:** Core and the selected modules only. No `.git`, no `.env*`, no tests, scripts, docs or demo layer.
- **Regenerates:** the provider registry, crons, schema (selected tables only), the demo stubs, the frontend registries and `convex/_generated/api.d.ts`.
- **Prunes:** `package.json` scripts whose files are not shipped.
- **Verifies:** the checks listed above, then writes `distribution-report.{json,md}`.
- **Refuses:** any selection that still has blockers. For example, Students-only is refused today because Core staff screens call Attendance's staff-leave API, which is on the baseline.

## Step 3 (uncommitted)

- **Staff screens:** staff attendance, leave decisions and a teacher's own leave moved to Attendance (`features/attendance/staff-admin.tsx`, `my-leave.tsx`). They are contributed to the Core Teachers & Staff workspace and staff profile. Students-only now exports cleanly.
- **Demo-layer decoupling:**
  - Demo-only Fees/Exams/Academics screens are owned by `demo` and mounted through `DemoSlot`.
  - Mixed Fees screens reach demo data through `demoCall()` (Core port).
  - Shared view types moved to `src/types/{fees,examinations}.ts`.
- **Base module (decision, can be reverted):**
  - Students is the base module (`ownership.ts BASE_MODULE`), so Core may reference it: logins, student-access authorization, notification rosters, the student import.
  - Every valid product contains Students; a test enforces this for every module combination.
- **Boundary violations:** 39 → **0** (baseline is now empty).
- **Exports verified (9/9 checks each, including `next build`):**
  - `students`
  - `students attendance`
  - `students academics attendance`
  - `all`
- **Operator guide:** `DEPLOYMENT_GUIDE.md`.

## Earlier follow-ups (resolved in step 3 unless noted)

- **39 remaining violations**, for example:
  - Core staff/teacher screens use Attendance's leave API.
  - `core/model/academics.activeRoster` reads `enrollments`.
  - Fees/Exams module screens still import the demo layer for their own demo branches.
- **Untyped demo data:** `DemoRuntime.data()` returns untyped demo datasets for dashboard/report demo branches (internal builds only).
- **Schema:** still one file. The export filters it by table owner rather than composing per-owner fragments.
