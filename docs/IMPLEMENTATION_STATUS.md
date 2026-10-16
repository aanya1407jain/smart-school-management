# Implementation status — Smart School Management System

_Audit date: 12 Oct 2026 (contract fixes applied the same day on `feat/convex-backend-foundation`, uncommitted — see §11) · audited code: GitHub `main` @ `6fda652` (PR #1 merged; identical to local `feat/convex-backend-foundation` @ `1b807b5`) · auditor: backend/integration lead (Aanya) with Claude._

Every statement below was checked against the code, not the README. "Tested" means an automated test exercises it.

---

## 1. Current architecture

```
Browser (Next.js 16 App Router, React 19, Tailwind)
 ├─ UI modules (src/features/*) ──► services.* registry (src/lib/services/index.ts)
 │                                   └─ mock services ──► src/lib/store/db.ts  (in-memory + localStorage "ssms-db")
 │                                                         seeded by src/lib/mock-data/seed.ts
 │   mock session: src/lib/services/session-store.ts (localStorage/sessionStorage "ssms-session")
 │
 └─ Convex wiring (only when NEXT_PUBLIC_CONVEX_URL is set):
      src/app/layout.tsx → ConvexServerProvider + ConvexClientProvider (Convex Auth)
      src/lib/convex/membership.tsx → useSchoolQuery / useSchoolMutation
      src/proxy.ts → Convex Auth cookie proxy (no route protection yet)

Convex (convex/*)
 ├─ auth.ts            Convex Auth, Password provider, invite-only sign-up, session gate
 ├─ core/              functions.ts (schoolQuery/schoolMutation/…), actor.ts, authorization.ts,
 │                     permissions.ts (shared with frontend), validators.ts, errors.ts
 ├─ model/             memberships, academics, calendar, grading, audit, notifications helpers
 ├─ schema.ts          34 tables (incl. Convex Auth tables)
 └─ public modules     users, memberships, schools, academics, attendance, notifications, files, audit, seed
```

**Key fact: the running UI is 100 % mock.** No screen calls Convex yet (`useSchoolQuery`/`useSchoolMutation` are used in 0 components). Convex is a working, tested backend that nothing in the UI consumes.

A Convex Cloud **dev** deployment is linked on Aanya's machine (`.env.local` → `CONVEX_DEPLOYMENT=dev:…`). No production deployment and no Vercel environment were inspected or changed.

---

## 2. Module matrix

Legend: ✅ done · 🟡 partial · ⚪ none · **M** = mock only.

| Module | UI | Convex schema | Convex queries | Convex mutations | UI → Convex | Server authz | Persistent | Tests | **Status** |
|---|---|---|---|---|---|---|---|---|---|
| Authentication / session | ✅ Login ID sign-in, `/account` | ✅ authTables + users (`loginId`, `mustChangePassword`) | ✅ `users.me`, `users.viewer`, `users.session` | ✅ Convex Auth signIn/signOut (Login ID), `account.changePassword`; no self sign-up | ✅ | ✅ | ✅ | ✅ unit + integration + E2E | **Done (Convex)** |
| Users / accounts / onboarding | ✅ Admin → Accounts & Import (Convex) | ✅ `schoolMemberships` (`loginId`) | ✅ `memberships.list`, `accounts.listPeople`, `imports.preview*` | ✅ `accounts.create/issueTemporaryPassword/issuePendingCredentials/setStatus`, `imports.commit*Rows`, `memberships.updateAccess`, internal `setup.*` | ✅ | ✅ `users:manage`, `students:write`, `staff:manage` | ✅ | ✅ unit + integration + E2E | **Done (Convex)** |
| Students (+ guardians) | ✅ (M) | ✅ students, guardians, guardianLinks | 🟡 roster via `academics.sectionRoster` only | ⚪ no create/update/profile/status | ⚪ | 🟡 helpers exist (`requireStudentAccess`) | M | ⚪ | **Schema only** (+ `enrollStudent`) |
| Academics (years, classes, sections, subjects, curriculum, enrollments, assignments) | ✅ (M) | ✅ incl. `classSubjects` curriculum | ✅ list years/classes/subjects/sections, `listClassSubjects`, roster, assignments, `myTeaching` | 🟡 create year/class/subject/section, `setClassSubjects`, `setClassTeacher`, `assignSubjectTeacher` (curriculum-checked), `removeTeacherAssignment`, `enrollStudent`. Missing: update/archive, set current year, promotion | ⚪ | ✅ | M | ✅ unit + integration | **Partial backend · UI mock** |
| Teachers / staff | ✅ (M) incl. leave & staff attendance | ✅ `teachers`, `staffAttendance`, `leaveRequests` (schema only) | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema partial / frontend only** |
| Student attendance | ✅ (M) | ✅ sessions + records | ✅ `getByDate`, `listBySection`, `studentHistory`, `dailyOverview` | ✅ `mark`, `update` (class teacher only) | ⚪ | ✅ ownership enforced server-side | ✅ | ✅ unit + integration | **Backend done & tested · UI mock** |
| Fees (structures, obligations, concessions) | ✅ (M) | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Payments | ✅ (M) | ✅ `feePayments` (append-only) | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Receipts | ✅ (M) | ✅ + atomic `counters` / `nextReceiptNumber` helper | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Examinations | ✅ (M) | ✅ status flow matches UI (incl. `in_progress`) | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ (mock E2E only) | **Schema only** |
| Marks | ✅ (M) | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Results | ✅ (M) | ✅ snapshot table | ⚪ (seed writes them) | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Timetable | ✅ (M) | ✅ `periods` + entries referencing `periodId` | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Homework & submissions | ✅ (M) | ✅ status `active \| closed` (matches UI) | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Notices | ✅ (M) | ✅ (audience model differs slightly from UI) | ⚪ | ⚪ | ⚪ | ⚪ | M | ⚪ | **Schema only** |
| Events | ⚪ (notices cover events in UI) | ✅ (used for holidays) | ⚪ | ⚪ | ⚪ | ⚪ | — | ⚪ | **Schema only** |
| Notifications | ✅ (M) | ✅ | ✅ `list`, `unreadCount` | 🟡 `markRead`, `markAllRead` (no `remove`); producers only in attendance + class-teacher change | ⚪ | ✅ own only | ✅ | ✅ integration + unit | **Partial backend · UI mock** |
| Dashboards (admin / teacher / student) | ✅ (M) | n/a (derived) | ⚪ | n/a | ⚪ | ⚪ | M | mock E2E | **Frontend + mock only** |
| Reports | ✅ (M) | n/a (derived) | ⚪ | n/a | ⚪ | ⚪ | M | ⚪ | **Frontend + mock only** |
| Settings (school profile/settings) | ✅ (M) | ✅ | ✅ `schools.current`, `publicProfile` | ✅ `updateProfile`, `updateSettings` (no set-current-year, no logo flow) | ⚪ | ✅ `settings:manage` | ✅ | ⚪ | **Partial backend · UI mock** |
| Profile (my contact, password) | ✅ (M) | — | ⚪ | ⚪ (no change-password/contact) | ⚪ | ⚪ | M | ⚪ | **Frontend + mock only** |
| Files / storage | ⚪ | ✅ `files` | ✅ `getUrl`, `listForOwner` | ✅ `generateUploadUrl`, `register`, `remove` | ⚪ | ✅ owner-based | ✅ | 🟡 unit (cross-school) | **Backend only** |
| Audit log | ⚪ | ✅ | ✅ `audit.list` | written by helpers | ⚪ | ✅ `audit:read` | ✅ | ✅ | **Backend only** |
| Guardian child switching | ✅ (M) | ✅ guardianLinks | ✅ `users.viewer.students` | n/a | ⚪ | ✅ `requireStudentAccess` | — | ✅ integration | **Backend ready · UI mock** |

### Classification summary
- **Fully implemented & tested (backend):** authentication/identity, memberships/invitations, tenancy isolation, RBAC, student attendance, audit, notifications (core), file storage (core).
- **Partially implemented:** academics (create-only), settings, notifications (no delete, few producers).
- **Schema only:** students/guardians CRUD, fees, payments, receipts, examinations, marks, results, timetable, homework, notices, events.
- **Schema missing for existing UI features:** none after the §11 contract fixes (staff attendance, leave requests, periods, curriculum and counters were added).
- **Frontend + mock only:** every UI screen, dashboards, reports, profile.
- **Missing entirely:** password reset/email verification, real route protection, Convex-backed login.

---

## 3. Completed backend functionality (verified)
- Multi-school isolation: every school table carries `schoolId`; ids are loaded with `getInSchool` (cross-school ⇒ `NOT_FOUND`).
- Server-derived actor (`requireActor`): session → user → active membership → active school; optional `membershipId` selector verified against the caller's own memberships.
- Convex Auth Password provider keyed by Login ID (email optional contact only); no self sign-up; admin-created accounts with server-generated one-time temporary passwords and forced change; disable = suspended membership + session invalidation; `beforeSessionCreation` blocks disabled users and users without active access; Convex Auth's built-in sign-in rate limit (10 failed attempts / hour / account) applies.
- Data onboarding: CSV/XLSX import of students and teachers (preview with per-row errors/warnings, all-or-nothing commit) and manual entry through the same validation; internal `setup:initSchool` for a real school (independent of the demo seed).
- One permission catalogue (`convex/core/permissions.ts`) shared with the frontend.
- Attendance: class-teacher-only mark/edit; school-day, future-date, roster-completeness checks; audit + absence notifications.
- Dataset-driven demo seed guarded by `ALLOW_DEMO_SEED`.

## 4. Completed frontend functionality
- All Stage 1 screens for Admin, Teacher and Student/Guardian portals, working end-to-end **against mock data** (82 E2E checks).
- Convex-backed screens: login (Login ID), `/account`, Admin → Accounts & Import. Other screens still use the mock services; the server identity is bound to its demo record by Login ID.

## 5. Modules still using mocks / localStorage
**All of them.** Specifically: `src/lib/store/db.ts` (whole database in `localStorage["ssms-db"]`), `src/lib/services/session-store.ts` (session in local/session storage), `src/lib/mock-data/seed.ts`, and every `src/lib/services/*.service.ts`. Only harmless UI preference storage (`app-shell.tsx` sidebar state) should remain after migration.

## 6. Missing backend functions (by owner)
| Area | Missing | Owner |
|---|---|---|
| Auth/session | Convex login screen wiring, session provider on `users.viewer`, route protection in `src/proxy.ts`, password reset (needs email provider), sign-out everywhere | **Aanya** |
| Users | guardian accounts in the admin UI (backend supports them); additional admins/permission sets in the UI (CLI only today); account search/filters | **Aanya** |
| Students & guardians | `students.list/get/create/update/setStatus`, guardian create/link/unlink, admission-number counter | Trisha (with Aanya review) |
| Academics | update/archive class/section/subject, `setCurrentAcademicYear`, class-subject curriculum, promotion/year rollover | Trisha |
| Teachers/staff | `teachers.list/get/create/update`, staff attendance + leave (tables + functions) | Trisha |
| Exams/marks/results | exams CRUD + status flow (add `in_progress`), paper schedule, `saveMarks` (assigned-subject check), publish (single readiness rule, results snapshot + notifications) | Trisha |
| Timetable | `periods` table, entries CRUD with clash checks, teacher/section/student views | Trisha |
| Homework | CRUD, submissions, review, attachments via `files` | Trisha |
| Fees/payments/receipts | structures, assignment → obligations, concessions, `recordPayment` (allocation + receipt counter, atomic), reversal, ledger/balance queries | Apporva (Aanya reviews money/security) |
| Notices/events/notifications | notices CRUD + audience resolution, events, notification `remove`, producers for fees/homework/exams | Apporva |
| Dashboards/reports | server-side aggregate queries (bounded/paginated) | Apporva |
| Settings/profile | logo upload, set current year, my contact/password change | Apporva (Aanya: password) |

## 7. Security gaps (prioritised)
1. **Critical (if deployed as is):** the live UI authenticates against a mock user table in the browser's `localStorage` (plain-text demo passwords, editable role). Any Vercel deployment of the current UI has **no real authentication or authorization**. Do not put real data in it until auth is migrated.
2. **High:** `src/proxy.ts` performs no route protection; protection is client-side (`AppShell`) only.
3. **High:** no Convex functions yet for fees/exams/students etc. — when teammates build them, every function must use `schoolQuery/schoolMutation` + `getInSchool` (a source-guard test enforces the builder; reviews must enforce the rest).
4. ~~**Medium:** `attendance.getByDate` reads the clock in a query~~ — **fixed** (§11): `today` is an explicit argument; `mark` still checks the real date.
5. ~~**Medium:** unbounded user-facing queries~~ — **fixed** (§11): `studentHistory` / `listBySection` limited to ≤ 366-day ranges, `memberships.list` paginated. Remaining `.collect()` calls are bounded by domain size (rosters, sections per year, a user's memberships) — see §11.
6. ~~**Medium:** schema/UI contract mismatches~~ — **fixed** (§11).
7. ~~**Low:** invitation-code sign-up attempts are not rate limited~~ — invitation codes removed (13 Oct 2026); public sign-up is refused outright.
8. **Low:** no security headers/CSP in `next.config.ts`.
9. **Process:** `ALLOW_DEMO_SEED` must never be set on a production deployment; seed refuses otherwise.

## 8. Test / build status (run during this audit on a clean clone of `main` @ 6fda652)
| Command | Result |
|---|---|
| `npm ci` | ✅ |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| `npm run test:authz` (mock attendance rules) | ✅ 23/23 |
| `npm run test:convex` (convex-test: tenancy, RBAC, attendance) | ✅ 31/31 |
| `npm run test:e2e` (Playwright vs mock UI) | ✅ 82/82, no page errors |
| `npm run test:convex:integration` (fresh local Convex backend, seeded) | ✅ 58/58 |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities (8 remain in dev tooling: Tailwind 3 watcher chain, Playwright 1.51) |

Not run: anything against the Convex Cloud dev deployment (no deploy/seed performed), Vercel.

## 9. Recommended implementation order
1. ✅ **Contract fixes (Aanya, small) — done, see §11:** align schema with UI — add exam `in_progress`, homework status mapping, `periods`, `staffAttendance`, `leaveRequests`, class-subject curriculum, per-school counters table; remove clock read from `attendance.getByDate`; bound `.collect()` hot spots. Unblocks everyone.
2. **Auth & session migration (Aanya):** login via Convex Auth, `SessionProvider` from `users.viewer`, guardian child switch from `viewer.students`, route protection in `src/proxy.ts`, logout. Everything else depends on a real identity.
3. **Attendance UI → Convex (Aanya + Trisha):** first module migration (backend already done); delete mock attendance service. Establishes the migration pattern.
4. **Students, guardians, teachers, academics CRUD (Trisha):** core records everything else references.
5. **Timetable, homework, exams/marks/results (Trisha).**
6. **Fees → payments → receipts (Apporva, Aanya reviews):** money; needs atomic counters + audit.
7. **Notices/events/notifications producers, settings/profile (Apporva).**
8. **Dashboards & reports (Apporva)** last — they aggregate everything above.
9. **Remove mock layer** (`src/lib/store`, `mock-data`, mock services, `test:authz`), production deployment checklist.

## 10. Aanya's checklist
- [ ] Decide what to do with untracked files on your machine: `AGENTS.md`, `CLAUDE.md`, `convex/_generated/ai/`, `.agents/`, `skills-lock.json` (Convex AI files — commit or add to `.gitignore`), `.claude/` (local, don't commit).
- [ ] Update local `main` (it is behind `origin/main`): `git switch main && git pull`.
- [x] Contract fixes (step 1) implemented and tested — **review, then commit/push on `feat/convex-backend-foundation`**.
- [ ] Fix the date-dependent E2E check A7 (fails on school-day mornings on untouched `main` too — see §11).
- [ ] Convex Cloud dev: run `npx @convex-dev/auth` once if not done; set `SITE_URL`; set `ALLOW_DEMO_SEED=true` **only on dev**; `npm run seed:demo`; run `test:convex:integration` with `CONVEX_URL` set.
- [ ] Auth/session migration PR (step 2) with E2E updated to real sign-in.
- [ ] Route protection in `src/proxy.ts`.
- [ ] Review checklist for teammates' PRs: builders, `getInSchool`, permissions, bounded queries, audit, tests (docs/BACKEND.md §10).
- [ ] Email provider decision (self-service password reset by email; today an admin issues a new temporary password).
- [ ] Production: separate Convex prod deployment + Vercel env vars; never enable demo seed there; security headers.

---

## 11. Contract fixes applied (12 Oct 2026, branch `feat/convex-backend-foundation`, not yet committed)

| # | Change | Where |
|---|---|---|
| 1 | Exam status adds `in_progress` (flow `draft → scheduled → in_progress → marks_entry → published`, same as UI) | `convex/core/validators.ts` |
| 2 | Homework status canonical `active \| closed` (no drafts in the product); submissions `submitted \| late \| reviewed` | validators, seed |
| 3 | `periods` table (bell schedule); `timetableEntries.periodId` replaces copied `periodNo/startTime/endTime`; slot indexes for clash checks | `convex/schema.ts`, seed |
| 4 | `staffAttendance` table (present / absent / on_leave per teacher per date) | schema |
| 5 | `leaveRequests` table (type, dates, status, decision fields) | schema |
| 6 | `classSubjects` curriculum + `academics.listClassSubjects` / `academics.setClassSubjects` (academics:manage, audited, blocks removing assigned subjects); `assignSubjectTeacher` now requires a curriculum subject | schema, `convex/academics.ts`, seed |
| 7 | `counters` table + `convex/model/counters.ts` (`allocateNumber`, `ensureCounterAtLeast`, `nextAdmissionNumber`, `nextEmployeeId`, `nextReceiptNumber`); seed allocates through it | new file, schema, seed |
| 8 | `attendance.getByDate` takes `today` (no clock read in the query) | `convex/attendance.ts` |
| 9 | `studentHistory` defaults to the academic year, ranges ≤ 366 days; `listBySection` validates range instead of silently truncating at 200; `memberships.list` paginated | `convex/attendance.ts`, `convex/memberships.ts` |

`.collect()` review (33 outside the seed): fixed the 3 that grow without bound with school size or time
(above). The rest are bounded by domain size and left as is: academic years/classes/subjects per school,
sections per year, assignments per section or teacher, rosters (enrollments per section), records per register,
a user's/teacher's/student's/guardian's memberships and links, holidays in a 60-day window, files per owner.

Security: every new/changed public function uses `schoolQuery`/`schoolMutation`, loads ids with `getInSchool`,
checks permissions (`academics:manage`, `users:manage`) and audits writes (`curriculum.updated`). No new
authorization system; attendance ownership rules unchanged (new tests confirm a subject assignment still grants no
mark rights).

Tests after the fixes (fresh clone + fresh local Convex backend):
`npm run typecheck` ✅ · `npm run test:convex` ✅ 44/44 (was 31) · `npm run test:convex:integration` ✅ 68/68 (was 58)
· `npm run test:authz` ✅ 23/23 · `npm run build` ✅ · `npm run test:e2e` ⚠️ 81/82 — **A7 fails identically on
untouched `main`** (date-dependent mock-UI check: on a school-day morning today's 10-A register is not yet marked,
so no "Present" label is shown). Not caused by these backend changes (no `src/` file changed).

Contract changes teammates must know: `getByDate` requires `today`; `memberships.list` takes `paginationOpts` and
returns `{ page, isDone, continueCursor }`; `studentHistory` returns `range`; timetable entries use `periodId`.

---

## 12. Login ID authentication & onboarding (13 Oct 2026, branch `feat/convex-backend-foundation`, not yet committed)
- Sign-in is **Login ID + password** (Convex Auth Password provider; account id = canonical Login ID). No role
  selector, no public registration, no invitation codes. Demo Login IDs: README.
- Accounts are created by an administrator in **Admin → Accounts & Import** (Convex-backed page): per person
  (generated or custom Login ID + one-time temporary password), reset password, disable/enable; manual "Add
  student/teacher"; CSV/XLSX import with column mapping, server preview and all-or-nothing commit, optional
  account creation and a credentials CSV download. The existing mock Students / Teachers screens are unchanged.
- First-login: `mustChangePassword` banner → `/account` (works for every valid account, even without a
  demo-data record).
- Real school setup: `npx convex run setup:initSchool …` (refuses if a school exists). The demo seed is unchanged
  in role but now provisions demo accounts through the same `reserveAccount` → `provisionAccount` path.
- Schema: `users.loginId` (+ `by_login_id`), `users.mustChangePassword`; `schoolMemberships.loginId`
  (+ `by_login_id`), `email` optional, invite fields removed, `createdByUserId`. **Existing deployments must be
  reset and reseeded** (dev: `npx convex import --replace-all` of an empty snapshot, then `seed:demo`).
- Tests: `test:convex` 84/84 · `test:convex:integration` 91/91 · `test:authz` 28/28 · `test:e2e` 108/109 (A7 is
  the known date-dependent mock-UI check, §11) · typecheck ✅ · build ✅.

---

## 13. Demo-login fix and temporary-password enforcement (13 Oct 2026, uncommitted)
- **Root cause of "every demo login is rejected":** the dev deployment still ran the previous (email + invitation)
  backend and held demo accounts keyed by email. The Login ID functions were never deployed there, and they could
  not be: the new schema rejected the deployment's old `schoolMemberships.invitedByUserId` documents. Even once
  deployed, `ADMIN-001` etc. did not exist (accounts were keyed by email) and `seed:demo` refuses an existing school.
- **Fix (non-destructive):** deprecated invite fields kept optional in the schema; `seed:upgradeDemoLoginIds`
  re-keys the demo accounts to their Login IDs in place. Reproduced and verified on a sandbox seeded with the old code.
- **Temporary passwords:** server-enforced forced change (`PASSWORD_CHANGE_REQUIRED`), 7-day expiry, reset re-imposes
  it, live-session check makes revocation immediate, password change refused for disabled/suspended accounts,
  `memberships.updateAccess` now revokes sessions on suspend and cannot toggle pending accounts.

---

## 14. System-assigned roll numbers + bulk student accounts (13 Oct 2026, uncommitted)
- Roll numbers: whole-section alphabetical renumbering in the same transaction as every roster change (import,
  enrollment/transfer, new `academics.endEnrollment`, seed). File roll numbers are ignored (shown as
  "system-assigned" in the import wizard). `academics.enrollStudent` no longer accepts `rollNo`.
- Bulk accounts: Students tab has row checkboxes, a page checkbox, "select all N without an account" (server-side
  snapshot), a section filter, a confirmation dialog, batched/resumable processing with exact progress, failed-item
  retry, re-issue for undelivered passwords and a credentials CSV. New tables `bulkAccountJobs`, `bulkAccountJobItems`.
- Verified: unit 123/123 · integration 100/100 · authz 28/28 · E2E 120/121 (A7 known) · load test 1,050 imported +
  1,095 accounts created on a local backend (~358 ms/account) · UI run of 120 accounts via "select all matching".
- Load test (writes data — disposable deployments only):
  `LOAD_TEST_DISPOSABLE=yes CONVEX_URL=… STUDENTS=1050 npx tsx --tsconfig tsconfig.json scripts/bulk-accounts-load.ts`.

---

## 15. Student portal for school-created accounts (14 Oct 2026, uncommitted)
- **Root cause of "your school records aren't available in this preview yet":** the backend links were correct
  (every creation path — single, import, bulk — stores `schoolMemberships.studentId`, and `users.session` resolved
  the student). The FRONTEND was the gap: the student portal only ran on the in-browser demo data, and
  `services.auth.bindIdentity` bound a signed-in account to a demo persona by Login ID. Any account the school
  created had no demo persona, so binding failed and the session became "unavailable" → `/account` with that message.
- **Fix:** the session now has a `dataSource`. Demo personas of the demo school (`aster-academy`) keep the demo data;
  every other student-portal account (student or guardian) uses the **live** portal, which reads only Convex:
  new `studentPortal.myProfile` (own record, current-year enrollment, class/section/roll, class teacher, guardians;
  explicit `no_student_record` / `missing` / `ended` / `no_current_year` states), `attendance.studentHistory` and
  `notifications.*`. Timetable, homework, results, fees and notices have no backend yet: in live mode they are hidden
  from the navigation and their pages say "not available yet". Demo binding is now restricted to the demo school.
  After the forced first-login password change, `/account` continues to the portal.
- **Read-only diagnostic:** `npx convex run studentPortal:diagnoseStudentAccounts '{"schoolSlug":"aster-academy"}'`
  reports per-account link problems and duplicate accounts (writes nothing).
- Verified: unit 133/133 (new `student-portal.test.ts`, 9) · integration 107/107 (real sign-in of a single and a
  bulk-created account) · authz 29/29 · E2E 129/131 — W3 and A7 also fail on the untouched baseline (date-dependent
  demo-data checks) · typecheck ✅ · build ✅.
- Still demo-only: staff accounts (admins/teachers) that are not demo personas still get the "preview" notice.

---

## 16. Post-merge fixes for the academic-workflow merge (15 Oct 2026, uncommitted)
- **Attendance filter crash** (`attendance:getByDate … sectionId "sec_10a"`): after `d3d7454`/`4822b0d` the register
  and overview called Convex, but the Class/Section filters (and `?section=` links from the demo teacher pages) still
  came from the in-browser demo dataset (`useAcademicOptions` → ids like `sec_10a`), and were cast to
  `Id<"sections">`. The filters now list `academics.listClasses/listSections` (server-scoped: admins all, teachers
  their scope); only a listed section is ever queried; `?section=` takes a real id or a label ("10-A").
- **`Could not find public function for 'academics:getStudentProfile'`**: the function exists in `main`
  (`d87bbdc`) but the dev deployment had not been pushed since the merge. The merged query also had no
  authorization (any member could read any student by id or admission number) and spread whole documents; it is now
  tiered (school staff / assigned teacher / self & linked guardian), explicit-field, `normalizeId`-validated.
  Demo personas viewing demo records (`stu_*`) get the demo profile again.
- **Student admission** (`createStudentWithEnrollment`): no longer falls back to the first section of the school,
  takes class + section ids validated against each other and the current year, uses the atomic admission counter,
  re-uses guardians by phone, renumbers the section (alphabetical roll numbers), reports a missing class teacher,
  and returns no credentials (the hard-coded `DemoPassword123!` is gone).
- **Student portal for school-created accounts**: timetable, homework (with own submission status), published
  results, fees (obligations, concessions, payments, receipts) and notices (audience-filtered) are now Convex
  queries (`studentPortal.my*`) backed by `convex/model/studentRecords.ts`.
- **Also fixed:** `next build` failed on `main` (three finance/communications test scripts used the old
  email-based identity bridge); `scripts/e2e-communications-finance.mjs` used the old login form; the W5 E2E
  assertions removed in the merge were restored (they pass).
- Verified (sandbox): unit 155/155 · integration 114/114 · authz 29/29 · fees-reports 36/36 ·
  notices-notifications 24/24 · dashboard-settings 30/30 · E2E 141/141 · comms/finance E2E 16/16 · typecheck ✅ ·
  build ✅.
- **Still demo-only:** admin/teacher Students list, My Classes, timetable/homework/exams/fees management and the
  demo student portal; homework submission and online fee payment have no backend yet.

---

## 17. Roster ordering, roll-number reconciliation and demo attendance (16 Oct 2026, uncommitted)
- **Root cause (audit 16 Oct):** the register/roster sorted by the STORED `rollNo`; numbers written before
  alphabetical renumbering (seed order, older imports, admissions without a number) were never reconciled.
- **Reads:** `activeRoster` uses the roll-number comparator (first name, last name, ids) instead of stored numbers.
  `accounts.listPeople` (students) sorts before paginating, first-name rule for the all-students view, complete
  duplicate-free pages (`model/sortedPagination.ts`).
- **Existing data:** explicit, internal, dry-run-first `rollNumberMaintenance:dryRun` / `:apply` (see BACKEND.md).
  Not run against any deployment.
- **Demo "My Attendance"** (`src/features/attendance/my-attendance.tsx`, d78a25d layout kept): reads the demo dataset
  again (no hard-coded records), late counts per school setting, excused days excluded (`attendance-summary.ts`),
  calendar opens on the latest record's month, empty states when there is no data. Live accounts keep
  `LiveMyAttendance`.
- **Still demo-only:** My Classes / admin Students list rosters and student renames use the in-browser demo data
  (demo roll numbers are not renumbered on rename).

---

## 18. Backend completion A-00 – A-06 (16 Oct 2026, uncommitted)
- **A-00 live staff sessions:** school-created admins/teachers were sent to "records aren't available in this
  preview" because the session only had a live path for student-portal accounts. They now get the live
  workspace for their server-derived role (no demo personas, no client-claimed role); pages still on demo data
  are gated for live accounts (`isLiveRoute`). Tests: `tests/convex/live-staff-session.test.ts`.
- **A-01 authorization:** new shared `isSubjectTeacherOf` / `requireSubjectTeacher` (persisted
  `teacherAssignments` only) used by marks entry, homework and timetable validation; direct-call matrix in
  `tests/convex/a01-authorization.test.ts` (forged cross-school ids, unauthenticated, role matrix).
- **A-02 fees** (`convex/fees.ts`), **A-03 exams** (`convex/exams.ts`), **A-04 timetable/homework**
  (`convex/timetable.ts`, `convex/homework.ts`), **A-05 notices/events/staff** (`convex/notices.ts`,
  `convex/events.ts`, `convex/staff.ts`), **A-06 files/reports** (homework & submission attachments in
  `convex/files.ts`, `src/lib/convex/use-file-upload.ts`, `convex/reports.ts`) and
  `academics.updateStudentProfile` (rename renumbers the active section). Contracts:
  `docs/BACKEND_API_CONTRACTS.md`.
- **Schema (additive, optional fields/indexes only):** `feePayments.clientRequestId` + `by_school_request`,
  `studentFees.by_structure`, `timetableEntries.by_school_day_period`, `notifications.dedupeKey` +
  `by_user_dedupe`, file kinds `homework_attachment` / `submission_attachment`, owner types `homework` /
  `submission`. No data migration is needed.
- **Not done here:** connecting the admin/teacher fee, exam, timetable, homework, notice, report and staff
  SCREENS to these functions (portal work for Trisha / Apporva); payment gateway; outbound SMS/email/push;
  report-card PDFs; promotion / year rollover.


---

## 19. Integration pass: academics (Trisha), finance & communications (Apporva, PR #11) (17 Oct 2026, uncommitted)
- **Not merged:** PR #11 is not merged. Its backend (`fees` / `notices` / `reports`) duplicated the A-02/A-05/A-06
  modules with weaker guarantees; one authoritative module of each is kept (the A-0x ones) and the functions
  PR #11's screens needed were added to it: `fees.overview / listBalances / listPayments`, `notices.restore`,
  `notifications.remove`, `reports.adminDashboard / studentStatistics / attendanceReport`. PR #11's tests for
  guardian switching and settings were ported to this API (`guardian-child-switching.test.ts`,
  `reports-settings.test.ts`).
- **Fixed from the audit:** retry-safe payments (UI sends one `clientRequestId` per intended payment),
  overpayment / future-date / foreign-allocation rejection, receipt sequencing, notice audiences validated
  against the school, notification when a draft (or a future-dated notice) is published, notice lifecycle
  without hard delete, percentage concessions in every total, finance-only dashboard scope, school-local
  dates, indexed school-year fee reads (no table scans, no per-student ledger queries). Regression tests:
  `tests/convex/integration-regressions.test.ts`.
- **Academics (fec0ceb):** type errors fixed; the live workspace uses `useSchoolQuery`, keeps the server's roster
  order, has no invented year, and restores class teachers, subject teachers, class curriculum, current year
  and enrolment of unplaced students. Demo personas keep the original demo workspace
  (`academics-workspace-demo.tsx`).
- **Screens now on live data** (in addition to §18): admin Dashboard, Students list + edit, Academics, Fees
  (overview, balances, structures, payments, ledger, receipts, concessions, collect-fee picker), Notices,
  Notifications (one centre for every role), Reports (students, attendance, fees, published exam
  performance), Settings; teacher My Classes, Homework (+ review), Examinations + marks entry, Timetable,
  Notices.
- **Still demo-only for live accounts (gated):** admin Examinations, Timetable, Homework, Teachers & Staff
  (incl. leave), teacher Dashboard, the academic-trend report tab and per-student attendance bands.
- **Schema (additive):** `studentFees.by_school_year`, `feeConcessions.by_school_year`,
  `feePayments.by_school_year`, optional `notices.publishedAt`.
