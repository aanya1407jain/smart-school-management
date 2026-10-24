# Verification report

## 24 Oct 2026 — staff permissions (RBAC), student administration, Principal UI

_Uncommitted, on top of P1; isolated copy. Nothing published, committed or pushed; no remote database touched. Contracts: `docs/RBAC_AND_STUDENT_LIFECYCLE.md`._

| Command (isolated copy) | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npx vitest run` | 42 files, 396/396 — new: `staff-permissions.test.ts` (14), `student-lifecycle.test.ts` (10), `staff-permissions-ui.test.ts` (5) |
| `npm run test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` | 31/31, 36/36, 24/24, 30/30 |
| `npm run build` (placeholder Convex URL) | Pass; new routes `/admin/permissions`, `/admin/promotions` |
| `npx convex codegen` against a local throwaway backend | Pass (generated `api.d.ts` only) |
| `git diff --check` | Clean |

Test changes to existing files:
- `module-entitlements.test.ts`: registers the new `studentLifecycle.ts` as a Student Management file (the inventory guard flagged it).
- `live-staff-session.test.ts`: adds the two new live admin pages to the expected navigation.

No assertion was removed.

Not run: E2E, `test:convex:integration`, and a browser check of the two new pages against a running backend. All need the functions on a deployment.

## 24 Oct 2026 — session-modules runtime fix and Convex cleanup audit

_Same uncommitted change set; isolated copy. Nothing published, committed or pushed; no remote database touched._

**`TypeError: session.viewer.modules is not iterable`** (`src/features/auth/session-provider.tsx`).
- **Cause:** the P1 frontend spread `session.viewer.modules` unconditionally. The dev deployment still runs pre-P1 functions: the function spec exported on 23 Oct (`convex-functions.json`) has no `schoolModules` functions, so its `users.session` returns a viewer without `modules`. The crash hit demo personas and live accounts alike, because both take modules from the server session.
- **Fix:** new `src/features/auth/session-modules.ts`.
  - `parseSessionModules` handles each kind of value:
    - **missing** → no modules (`"missing"`);
    - **not an array of strings** → no modules (`"malformed"`);
    - **valid list** → kept in catalogue order. Unknown keys are ignored and never granted; a module whose dependency is absent is dropped.
  - `withSessionModules` replaces any client-side value with the parsed server list, for demo personas and live accounts.
  - The session exposes `modulesStatus`. When it is not "ok", the app shell shows "modules could not be confirmed" instead of claiming the plan lacks the module, and a console warning names the likely cause.
  - The admin finance-only dashboard reads the session flag instead of `data.modules`, which old backends lack.
  - Backend checks are untouched.
- **Remaining dependency:** until P1 is pushed to the dev deployment, every module page is hidden there (fail-closed). Core pages (dashboard, accounts, settings, profile) work.

**Convex audit:** see `docs/CONVEX_CLEANUP_AUDIT.md`.
- 195 functions and 47 tables reviewed.
- Removed: `timetable.canManage` (no callers) and the unused P1 helpers `moduleLabel` and `LEGACY_DEFAULT_MODULES`.
- No table removed. The legacy guardian field and index are proposed for later removal, after the migration has run on every deployment.

| Command (isolated copy) | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npx vitest run` | 39 files, 365/365 (adds `tests/convex/session-modules.test.ts`, 10 tests) |
| `npm run test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` (mock layer) | 31/31, 36/36, 24/24, 30/30 |
| `npm run build` (placeholder Convex URL) | Pass |
| `git diff --check` | Clean |

Not run: E2E, `test:convex:integration`, `scripts/module-entitlements-check.ts`. All need P1 on a deployment.

## 24 Oct 2026 — P1 review before deployment

_Same uncommitted change set on `feat/convex-backend-foundation` @ `bc8856d`. Isolated copy; nothing published to any Convex deployment, nothing committed or pushed._

**Enforcement inventory (independent of the test inventory).** Every public function outside a module wrapper was scanned for direct and indirect (via `convex/model/*`) reads or writes of module tables (finance: `feeStructures`, `studentFees`, `feeConcessions`, `feePayments`, `receipts`; academics: `exams`, `examSubjects`, `marks`, `results`, `periods`, `timetableEntries`, `homework`, `homeworkSubmissions`; attendance: `attendanceSessions`, `staffAttendance`, `leaveRequests`; administration: `notices`, `events`). Only three were found, all gated per panel: `reports.adminDashboard`, `dashboards.teacherOverview`, `academics.getStudentProfile`. Files are gated by kind in `convex/files.ts`. Scheduled paths: `feeReminders.runDaily` → `remindSchool` (skips without finance), `notices.notifyOnPublishDate` (skips without administration); the only other scheduled job (`accounts.revokeSessions`) is core. Actions (`accounts.*`, `bulkAccounts.processBatch`, `account.changePassword`) touch no module data.

**Fixed in this review**
- Demo-persona dashboards and the demo student profile now hide panels of disabled modules (`src/features/dashboard/teacher-dashboard.tsx`, `src/features/dashboard/student-dashboard.tsx`, `src/features/students/demo-student-profile.tsx`); their mock-data queries for disabled modules are skipped. Unchanged when every module is on. UI only; backend checks untouched.
- The entitlement policy is now a pure function (`resolveModuleState` in `convex/model/modules.ts`), so "a module added later is off by default" is tested with a hypothetical catalogue.
- A skipped notice notification now reports `{ notified: 0, skipped: "module_disabled" }` (was `{ notified: 0 }`); delivery itself is unchanged.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | Pass |
| Convex tests | `npx vitest run` | **38 files, 355/355** (3 new: future-module default, unknown stored keys, dependency rejection on a configured school) |
| Demo-data suites | `npm run test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` | 31/31 · 36/36 · 24/24 · 30/30 |
| Production build | `npm run build` | Pass (not deployed) |
| `git diff --check` | | Clean |

**Not run:** browser E2E, the Convex integration script, the two-deployment check. They need these functions on a running backend.

### Repeatable pre-deployment checklist (run after an approved push to a dev / staging deployment)

Operator commands run from the project folder against that deployment only.

1. **All modules enabled (baseline)**
   - [ ] `npx convex run schoolModules:getSchoolModules '{}'` → `mode: "legacy"`, all five enabled, `problems: []`.
   - [ ] `npm run test:e2e` and `npm run test:convex:integration` (with `CONVEX_URL` = that deployment) pass as before.
   - [ ] `scripts/module-entitlements-check.ts` → all calls OK.
   - [ ] Principal, teacher, student: sidebar, dashboards and pages identical to before P1.
2. **Finance disabled**
   - [ ] Dry run: `npx convex run schoolModules:setSchoolModules '{"enabled":["students","academics","attendance","administration"],"updatedBy":"<name>","reason":"<ref>","dryRun":true}'` → `disabledNow: ["finance"]`; `getSchoolModules` unchanged.
   - [ ] Same command without `dryRun` → `changed: true`; audit log shows `school.modules_changed` with before/after.
   - [ ] Principal: no Fees item; dashboard has no fee card/chart; Reports has no Fees tab; student profile has no Fees tab or fee-ledger button.
   - [ ] Accountant-only login: dashboard says Accounts & Finance is not enabled.
   - [ ] Student: no My Fees; dashboard has no fee tile.
3. **Direct access to the disabled module**
   - [ ] Open `/admin/fees`, `/admin/fees/<studentId>`, `/student/fees` by URL → "Accounts & Finance is not enabled for your school"; no fee data in the page or the network panel.
   - [ ] Direct backend calls without any UI: `CONVEX_URL=<deployment url> npx tsx --tsconfig tsconfig.json scripts/module-entitlements-check.ts` (read-only, demo logins) → every finance call `MODULE_DISABLED`, every other module OK, core OK, teacher still refused.
4. **Finance re-enabled, data retained**
   - [ ] Record counts before disabling (fee structures, payments, receipts on one student's ledger).
   - [ ] Re-enable all five; the same structures, payments, receipts and balances reappear unchanged.
   - [ ] Run `scripts/module-entitlements-check.ts` again → all calls OK (finance included).
5. **Permissions still restricted (module on)**
   - [ ] Teacher: no Fees, no admin pages; `/admin/fees` → unauthorized (not "not enabled").
   - [ ] Student: sees only their own fees, results, attendance.
   - [ ] Principal still cannot mark attendance (class teacher only).
6. **Two separate deployments configured differently** (the product runs one school per deployment)
   - [ ] Deployment A: Finance off; Deployment B: all modules (or unconfigured). Repeat steps 2–3 on A and step 1 on B; changing A never changes B.
7. **Clean-up**
   - [ ] Re-enable whatever the deployment should keep; confirm with `getSchoolModules`.

## 24 Oct 2026 — P1 school module entitlements

_Code: `feat/convex-backend-foundation` @ `bc8856d` plus the P1 change set, uncommitted. Run in an isolated copy of the repository. No Convex deployment received these functions (not the dev deployment `dev:judicious-lobster-72`, not production)._

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | Pass, 0 errors |
| Convex tests | `npx vitest run` | **38 files, 352/352 pass** (40 new in `module-entitlements.test.ts`; one existing navigation test now passes the session's modules) |
| Mock-layer suites | `npm run test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` | 31/31 · 36/36 · 24/24 · 30/30 |
| Production build | `npm run build` | Pass (not deployed) |
| `git diff --check` | | Clean |
| Regression guard | `fees.listStructures` switched back to `schoolQuery` on purpose | 4 entitlement tests fail as they should; restored |

Not run in P1: browser E2E (`test:e2e`), the Convex integration script and a two-school browser check. All three need the new functions on a running backend; the local throwaway backend was only used by `npx convex codegen` to generate `convex/_generated/api.d.ts`.

## 22 Oct 2026 (re-audit) — student totals and exactly three account roles

_Same branch and commit (`feat/convex-backend-foundation` @ `2ba4f97`), change set still uncommitted. The first 22 Oct pass (below) was re-audited against the code before anything was changed; three gaps were found and fixed (see `docs/IMPLEMENTATION_STATUS.md`, "Re-audit"). Every result here was run and observed in this pass on a **fresh** isolated local sandbox (`127.0.0.1:3310`, restored again from the seeded snapshot that still holds the old demo guardian login `GRD-00001`; app built against it, served on `localhost:3000`). No shared, cloud or production deployment was read or written; nothing was committed, pushed or deployed._

| # | Check | Result |
|---|---|---|
| 1 | `npm run typecheck` | Pass (0 errors) |
| 2 | `npm run test:convex` (convex-test) | **37 files, 311/311 pass** (3 new tests in this pass) |
| 3 | Authorization & roles (inside #2): `guardian-child-switching`, `a01-authorization`, `tenancy`, `session`, `audit-roles`, `auth-signin` | Pass — incl. new: a 4th role value (`parent`, `guardian`) is rejected by the schema; an admin/teacher login carrying a student link gets `NO_SCHOOL_ACCESS`; a student login without a student record reads no student's data |
| 4 | Student-count regression (`student-counts.test.ts`, inside #2) | 6/6 — incl. new: inactive record with an open enrollment not counted; duplicate enrollment in one section listed and counted once; list = totals = dashboard; fresh-session persistence; teachers/students cannot list, count or admit |
| 5 | Mock-layer suites `test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` | 31/31 · 36/36 · 24/24 · 30/30 (mock layer — not evidence for live workflows) |
| 6 | `npm run build` (against the sandbox URL; not deployed) | Pass |
| 7 | `test:convex:integration` (sandbox) | **108/108 before** and **108/108 after** the migration |
| 8 | `npm run test:e2e` (sandbox) | **147/147 before** and **147/147 after** the migration, 0 page errors (29 teacher checks, 16 student checks, 6 COUNT, 2 ROLE) |
| 8b | `npm run test:e2e:comms-finance` (sandbox) | 18/18, 0 page errors |
| 9 | Browser smoke, school-created admin (`ADMIN-002`, sandbox) | 6/6: enrolled total shown; admission in one tab → total in another tab +1 without reload; found by search; "Parent contact" tab; no guardian/parent option in Accounts |
| 10 | `migrations:removeGuardianAccounts` (sandbox only) | dry run: 1 (`GRD-00001`), nothing written · apply: deleted (membership, sign-in, password account) · re-run: 0 · audit row `account.deleted` (`targetKind: legacy_guardian`, actor = none/operator, no secrets) · after: 0 memberships with `guardianId`, 0 `GRD-` users/password accounts, parent contacts still present (11 contacts / 27 links) · client call refused ("Could not find public function", integration #7) |
| 11 | `git diff --check` | Clean |

Not run / not verified: any cloud deployment; the migration on a real deployment (needs separate review and explicit approval); Lighthouse/accessibility audits. No test was skipped or failed in the final runs. (During this pass a first, stricter version of the role check made 3 existing tests fail — student logins with a missing record link must keep the explicit `no_student_record` portal state; the check was narrowed and all tests pass.)

---

## 22 Oct 2026 — student totals fix and removal of the Guardian account type

_Code: `feat/convex-backend-foundation` @ `2ba4f97` plus this change set, uncommitted. Environment: the isolated local sandbox Convex backend (`127.0.0.1:3310`, throwaway data restored from the seeded snapshot, which still contained the old demo guardian login `GRD-00001`), app built against it and served on `localhost:3000`. No shared or production deployment was read or written; nothing was committed, pushed or deployed elsewhere._

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run test:convex` | **37 files, 308/308 pass** (new: `student-counts.test.ts`; `guardian-child-switching.test.ts` rewritten to test the removal + migration) |
| `test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` (mock layer) | 31/31 · 36/36 · 24/24 · 30/30 (authz has one check fewer: the three guardian checks became two "former guardian login binds nothing" checks) |
| `npm run build` | Pass |
| `npm run test:e2e` (sandbox, before migration) | **147/147, 0 page errors** |
| `npm run test:e2e:comms-finance` (sandbox) | 18/18, 0 page errors |
| `test:convex:integration` (sandbox, before migration) | **108/108** |
| `migrations:removeGuardianAccounts` on the sandbox | dry run: 1 membership (`GRD-00001`), sign-in would be deleted, nothing written; apply: deleted; re-run: 0 |
| `test:convex:integration` / `test:e2e` (sandbox, after migration) | 108/108 · 147/147, 0 page errors |
| Browser smoke, school-created admin (sandbox) | 6/6: totals shown, admission → other tab updates without refresh, found by search, "Parent contact" tab, no guardian option in Accounts |
| `git diff --check` | Clean |

Student-count evidence (E2E, demo Principal `ADMIN-001`, the reported scenario): Students page total = dashboard total; after admitting a student in one tab the Students page open in another tab went N → N+1 **without a reload**, stayed N+1 after a refresh and after navigating away and back, and the new student is found by search without changing the total. Convex tests cover the rule (distinct students, duplicate enrollment / extra membership not double counted, not-enrolled and withdrawn students, section count, other school excluded and its section id NOT_FOUND, dashboard equality, permissions).

Guardian removal evidence: Convex tests — a leftover guardian membership gets `NO_SCHOOL_ACCESS` from 17 portal / staff / file functions (including the student it was linked to and another school's student), cannot be re-enabled, given credentials or activated, receives no notifications; `accounts.create` rejects a guardian person; a teacher who also had a guardian membership keeps teacher access; migration dry run / apply / idempotent / contacts untouched / audited. Integration on the real sandbox backend — `GRD-00001` cannot sign in (before and after migration); `migrations:removeGuardianAccounts` is not callable from a client ("Could not find public function"). E2E — the former guardian login is refused on the sign-in page; no guardian/parent demo account is offered; the admit form shows "Parent contact" and no "guardian" wording; students have no student switcher.

Existing tests changed by design (behaviour changed on purpose, not weakened): every test that used the fixture guardian user now uses `legacyGuardian` and expects **no access** (`NO_SCHOOL_ACCESS`) or no notification where it used to expect guardian access; notification counts that included the guardian (homework, fees reminders, exam publish, review) now expect the student only; renamed fields (`parentContact`, `parentContacts`, `parent*` import keys) are asserted with the same values as before.

Not verified here: any Convex Cloud deployment; running the migration on a real deployment (needs approval).

---

## 18 Oct 2026 — MVP completion pass

_18 Oct 2026. Code: `feat/convex-backend-foundation` @ `9ffbbc6` plus this pass's uncommitted changes (tree of `9ffbbc6` = `origin/main` @ `a9cf740`). Nothing was committed, pushed or deployed to a shared deployment._

### Environment

- **Isolated staging = local sandbox Convex backend** (self-hosted, `127.0.0.1:3310`, throwaway data directory restored from a seeded snapshot before the run). No Convex Cloud deployment (dev or production) was read or written.
- Functions were pushed to the sandbox with `npx convex deploy` (self-hosted URL + sandbox admin key); the Next.js app was built with `NEXT_PUBLIC_CONVEX_URL` pointing at the sandbox and served on `localhost:3000`.
- Browser: Playwright with the preinstalled Chromium headless shell.
- Test-only accounts used in the sandbox (a throwaway administrator, an accountant-only login and an imported teacher) exist only in that sandbox. No credentials are recorded here.

### Gate results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Pass |
| Convex unit/authorization tests (convex-test) | `npm run test:convex` | **36 files, 302/302 pass** |
| Mock-layer suites | `npm run test:authz` / `test:fees-reports` / `test:notices-notifications` / `test:dashboard-settings` | 32/32 · 36/36 · 24/24 · 30/30 (mock layer — not evidence for live workflows) |
| Production build | `npm run build` | Pass |
| Main E2E (sandbox) | `npm run test:e2e` | **143/143 pass, 0 page errors** |
| Communications & finance E2E (sandbox) | `npm run test:e2e:comms-finance` | **18/18 pass, 0 page errors** |
| Convex integration (sandbox) | `CONVEX_URL=http://127.0.0.1:3310 npm run test:convex:integration` | **114/114 pass** |
| Live-UI smoke for this pass (sandbox, scratch scripts, not committed) | Playwright | All checks pass, 0 page errors (details below) |
| Whitespace | `git diff --check` | Clean |

### New Convex tests (this pass)

| File | Covers |
|---|---|
| `tests/convex/mvp-p1-fees-reports.test.ts` | Concession revoke (reason, roles, other school, audit, history kept); cancel assignment (refused while paid, allowed after reversal, rows kept, append-only payments); structure edit lock; fee-due reminders (due-soon + overdue once per installment & recipient, rerun-safe, paid installments skipped, school isolation, setting off, inactive school, daily fan-out with scheduled jobs); low-attendance (threshold, late rule, section filter, roles, isolation, bad range) |
| `tests/convex/mvp-p1-people.test.ts` | Accountant-only resolution (exact set) and server refusals across modules; access changes (self, other school, non-admin, users:manage only), staff-login reservation; staff profile (teacher phone only, admin rename, students refused, audit); student documents (admin/family read, teacher/accountant/other school refused, admin-only delete, audit); enrollment history across transfer/withdrawal; teacher records edit (validation, sync of sign-in name, isolation, deactivate); leave apply/overlap/withdraw/decide once + single notification; staff attendance (leave link, future date, roles); audit feed (role, order, actor, filter, isolation) |
| `tests/convex/mvp-p1-exams-homework.test.ts` | Exam marks-entry progress gates publication; subject-teacher scoping; publish once with one notification per family member; report-card data; homework submission counts and admin oversight isolation |
| `tests/convex/teacher-dashboard.test.ts` | Teacher landing data limited to the caller's own sections/lessons/homework/marks; other roles refused; other school isolated |

### Existing tests changed (intentional behaviour changes, not weakening)

| Test | Change | Reason |
|---|---|---|
| `tests/convex/tenancy.test.ts` | A subject teacher reading a **student document** now expects `NOT_FOUND` (was allowed) | Decision "Admins only, audited": documents visible to admins and the family only. Stricter than before |
| `tests/convex/student-records.test.ts` | `studentPortal.myResults` now also returns `school` and `student {name, admissionNo}`; the assertion checks those exact values | Report-card header |
| `tests/convex/live-staff-session.test.ts` | Newly connected routes are expected to be live; nav lists updated; adds an accountant-only nav assertion and negative cases for unknown routes | Routes were connected by design in this pass |
| `scripts/e2e.mjs` | Live homework text pattern accepts the consolidated live component's wording | Component consolidation; the check still requires the real page state |

### Live-UI smoke (sandbox) — what was exercised in the browser

- School-created admin: changes the temporary password; navigation lists Teachers & Staff, Examinations, Timetable, Homework, Audit log, Profile; `/admin/teachers` (teachers, staff attendance, leave tabs), `/admin/audit`, `/admin/profile`, `/admin/timetable`, `/admin/examinations`, `/admin/homework` render live screens; low-attendance list shows the school threshold; student profile shows enrollment history, transfer/withdraw actions and documents with upload; Accounts → Office & access creates an accountant-only login with a one-time password.
- Accountant-only login: navigation shows only Dashboard, Students, Fees, Notifications, Reports, Profile; Reports shows only the Fees tab; Settings content is not shown; fee structure edit dialog opens (amounts locked when in use); a student ledger shows the corrections panel; students list is read-only.
- Teacher imported through Accounts & Import with a new sign-in: lands on the live teacher dashboard; profile shows My leave; applies for leave → admin sees and approves it → the teacher receives the "Leave approved" notification → the audit log lists `leave.approved` with the acting admin's name.

### Not verified here

- Any Convex Cloud deployment (dev/production) — see `docs/REMAINING_WORK.md` §4.
- The fee-reminder cron firing on a real schedule (verified via convex-test fake timers only).
- Uploading a real file through the browser (server-side file rules are covered by convex-test).
