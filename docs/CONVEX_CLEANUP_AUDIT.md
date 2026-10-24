# Convex function and table audit — 24 Oct 2026

Scope: every file under `convex/` (schema, functions, `core/`, `model/`, `seedData/`, crons, HTTP routes, Convex Auth), and every reference from `src/`, `tests/`, `scripts/` and `docs/`. Uncommitted, on `feat/convex-backend-foundation` @ `bc8856d` plus P1. Nothing was published to a deployment and no database was touched.

## Method
- **Function inventory:** every `export const X = <builder>(` in `convex/*.ts`, classified by builder (public `query`/`mutation`/`action` and the wrappers `schoolQuery`, `moduleQuery`, … vs `internal*`). Convex Auth's `signIn`, `signOut`, `store` and `isAuthenticated` are counted too.
- **References** looked for: `api.<module>.<fn>` and `internal.<module>.<fn>` (direct calls, `ctx.scheduler.runAfter`, `ctx.runMutation/runQuery/runAction`, `crons.ts`), CLI strings `"<module>:<fn>"` (operator runbooks, `package.json`), and dynamic access (`api[...]`, `makeFunctionReference`, `anyApi` — none found). Git history was checked for each removal candidate.
- **Confirmation:** after a removal, `tsc --noEmit` type-checks every remaining `api.*` / `internal.*` reference against the generated API, and the full test suites were re-run.
- Unused indexes and unused exported helpers were also listed.

## Functions — 195 reviewed (194 after cleanup)

| Visibility | Query | Mutation | Action | Total |
|---|---|---|---|---|
| Public (app functions) | 82 | 72 | 6 | 160 |
| Internal | 5 | 20 | 6 | 31 |
| Convex Auth (library) | 1 (`isAuthenticated`) | 1 internal (`store`) | 2 (`signIn`, `signOut`) | 4 |

### Classification
1. **Required and actively used (frontend):** 151 of the 160 public app functions are called from `src/`. The other 9 are: 3 used only by scripts (class 3), 5 uncertain (class 7) and 1 removed (class 6).
2. **Required indirectly or by schedules:**
   - **Cron:** `feeReminders.runDaily` (`crons.ts`) → `feeReminders.remindSchool`.
   - **Scheduler:** `notices.notifyOnPublishDate`; `accounts.revokeSessions` (from `memberships.updateAccess`).
   - **Internal steps of actions:** `account.passwordChangeContext`, `account.clearMustChangePassword`, `accounts.reserveForPerson`, `accounts.targetForCredentials`, `accounts.recordCredentialsIssued`, `accounts.applyStatus`, `bulkAccounts.claimBatch`, `bulkAccounts.beginItem`, `bulkAccounts.finishItem`.
   - **HTTP:** `auth.addHttpRoutes` (JWKS/OpenID), plus the Convex Auth functions.
3. **Setup, operations, seeding, migration, testing (CLI/dashboard only; all internal unless noted):**
   - **Setup:** `setup.createSchoolAndAdmin`, `initSchool`, `reserveAdministrator`, `addAdministrator`, `userForLoginId`, `issueTemporaryPassword`.
   - **Seeding:** `seed.demo`, `upgradeDemoLoginIds`, `createStructure`, `createActivity`.
   - **Roll-number maintenance:** `rollNumberMaintenance.dryRun`, `applySection`, `apply`.
   - **Module entitlements:** `schoolModules.getSchoolModules`, `setSchoolModules`.
   - **Migration:** `migrations.removeGuardianAccounts`.
   - **Diagnostics:** `audit.accountCreationReport`, `studentPortal.diagnoseStudentAccounts`.
   - **Public, used only by `scripts/convex-integration.test.ts` (and the new `scripts/module-entitlements-check.ts`):** `users.viewer`, `audit.list`, `memberships.list`.
4. **Apparently duplicated, but with meaningful differences (all retained):**
   - `academics.listTeachers` vs `staff.listTeachers`. The first needs `academics:manage` and returns active teachers only, as picker rows. The second needs `staff:manage` and returns full staff records with class-teacher roles, subject load and account status.
   - `audit.list` vs `audit.feed`. `list` filters by entity, is bounded (≤200) and returns raw rows; it is used by the integration script. `feed` is paginated, resolves actor names, and is what the UI uses.
   - `users.session` vs `users.viewer`. `session` never throws: it returns signedOut / noSchool / signedIn for the UI. `viewer` is a school query that throws `UNAUTHENTICATED` / `NO_SCHOOL_ACCESS` and is used by the integration script. Both use one shared `buildViewer`, so there is no duplicated logic.
   - Teacher/admin read paths vs student portal paths (`studentPortal.*`):
     - `timetable.myTimetable` vs `studentPortal.myTimetable`;
     - `homework.listMine` vs `studentPortal.myHomework`;
     - `notices.feed` vs `studentPortal.myNotices`;
     - `exams.sectionResults` vs `studentPortal.myResults`;
     - `fees.studentLedger` vs `studentPortal.myFees`;
     - `profile.mine` (the caller's staff profile) vs `studentPortal.myProfile` (the student record).

     The portal versions resolve the student from the caller's own membership, so a student cannot pass another student's id. They are different authorization paths, not duplicates.
   - `reports.enrollmentSummary` vs `reports.studentStatistics`. The first counts every student by status and includes active teachers. The second gives a per-class gender split, section fill and parent-contact count.
   - `reports.attendanceSummary` vs `reports.attendanceReport`. The first counts school days and missing registers (≤120 days). The second gives monthly and per-section percentages (≤366 days).
   - `reports.feeSummary` vs `fees.overview` vs `fees.collectionSummary`. They report per class, per year (including students who have left), and payments in a date range respectively.
   - `accounts.issueTemporaryPassword` (school admin) vs `setup.issueTemporaryPassword` (operator, internal). They have different trust boundaries.
5. **Confirmed duplicate:** none.
6. **Confirmed unused:** `timetable.canManage`, now removed (see below).
7. **Uncertain — retained.** Each is unused by the UI but is a documented API contract (`docs/BACKEND_API_CONTRACTS.md`), and its tests assert authorization and tenant behaviour:

   | Function | Visibility | Callers | Why retained |
   |---|---|---|---|
   | `homework.get` (`convex/homework.ts`) | public | tests only | Single-homework read, including the student's own submission. Tests cover access scope. A homework detail page may use it. |
   | `notices.get` (`convex/notices.ts`) | public | 3 test files | Single-notice read with audience checks. Notice privacy tests depend on it. |
   | `reports.enrollmentSummary` (`convex/reports.ts`) | public | tests (incl. module + A01 authorization) | Different output from `studentStatistics` (see 4). |
   | `reports.attendanceSummary` (`convex/reports.ts`) | public | tests | Missing-register counts exist nowhere else. |
   | `schools.publicProfile` (`convex/schools.ts`) | public, unauthenticated | tests | Branding for a sign-in page. It exposes only name, short name, tagline and logo, and only for active schools. |

   Removing any of these needs a product decision, not just a code change. Their tests would have to be removed or rewritten against another function.

### Removed (local only, not published)

| Symbol | File | Kind | Callers before removal | Why it is safe | Replaced by |
|---|---|---|---|---|---|
| `canManage` | `convex/timetable.ts` | public `academicsQuery` | None in `src/`, `convex/`, `tests/`, `scripts/` or git history of `src/`. Only a row in `docs/BACKEND_API_CONTRACTS.md`, also removed. | It was a UI helper that returned `hasPermission(actor, "timetable:manage")`. It wrote nothing and enforced nothing. Every timetable mutation still checks `timetable:manage` on the server. | The session's `permissions` (`useSession().can("timetable:manage")`), which the UI already uses. |
| `hasPermission` import | `convex/timetable.ts` | import | Used only by `canManage` | Dead import | — |
| `moduleLabel`, `LEGACY_DEFAULT_MODULES` | `convex/core/modules.ts` | exported helpers added in P1 (uncommitted) | None | Never used; the legacy default is computed from `MODULES[k].legacyDefault` in `model/modules.ts` | — |

When P1 is next published, `timetable:canManage` disappears from the deployment. No data is involved.

### Unused helpers retained
These remain in place because they are documented building blocks in `docs/BACKEND.md` and carry no runtime cost. Remove them later if you prefer:
- `core/authorization.ts` `requireTeacherAssignment`. Note: it is *weaker* than attendance marking needs (any assignment, not class teacher). Attendance correctly uses the class-teacher check, so this should not be adopted for attendance.
- `core/validators.ts` `normalizeEmail`
- `model/counters.ts` `peekCounter`

## Tables — 41 app tables + 6 Convex Auth tables reviewed

All 41 app tables are both written and read by current code, so none is redundant. Convex Auth tables (`authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits`) and the overridden `users` table are required for sign-in.

| Table(s) | Purpose / data class | Required for |
|---|---|---|
| `users`, `schoolMemberships` | Identity; one membership per person per school (role, permission sets, Login ID, links to teacher/student) | Authentication, authorization, tenant isolation |
| `schools`, `schoolSettings`, `schoolModules`, `counters` | School profile and settings, module entitlements, number sequences (admission, receipt, Login ID) | Tenant root, P1 entitlements, never-reused numbers |
| `academicYears`, `classes`, `sections`, `subjects`, `classSubjects`, `teacherAssignments` | Academic structure and class/subject teacher assignments | Core; the class-teacher attendance rule |
| `teachers`, `staffAttendance`, `leaveRequests` | Staff records; staff attendance and leave (Attendance module) | Staff, Attendance |
| `students`, `enrollments`, `guardians`, `guardianLinks` | Student records, academic history (roll numbers, scholar/admission numbers), parent *contact* records (no accounts) | Students; history must be retained |
| `attendanceSessions`, `attendanceRecords` | Registers and marks | Attendance (historical) |
| `feeStructures`, `studentFees`, `feeConcessions`, `feePayments`, `receipts` | Financial records | Finance (must be retained) |
| `exams`, `examSubjects`, `marks`, `results`, `periods`, `timetableEntries`, `homework`, `homeworkSubmissions` | Academics data | Academics |
| `notices`, `events` | Administration; `events` also holds holidays used by attendance (see REMAINING_WORK G16) | Administration |
| `notifications` | Per-user inbox | Core |
| `auditLogs` | Audit trail | Must be retained |
| `bulkAccountJobs`, `bulkAccountJobItems` | Bulk account creation jobs (resumable) | Accounts |
| `files` | File metadata; kind-to-module gating | Files |

**Overlapping names with different responsibilities:**
- `attendanceSessions` (one register per section/day) vs `attendanceRecords` (one mark per student) vs `staffAttendance`.
- `studentFees` (obligations) vs `feePayments` vs `receipts`.
- `marks` (per paper) vs `results` (computed per exam).
- `guardians` (contact) vs `guardianLinks` (student ↔ contact).

**Empty in a dataset is not evidence:** for example, `schoolModules` is empty for every legacy school by design.

### Schema items proposed for later removal (need approval and a data check, not done)
1. **`schoolMemberships.guardianId` and index `schoolMemberships.by_guardian`.** These are left over from the removed guardian sign-in. `migrations:removeGuardianAccounts` deletes those memberships. Remove the field and index only after that migration has run on every deployment and shows none left; Convex refuses a schema push while documents still carry the field.
   - Also update `audit.accountCreationReport`, which still checks `!m.guardianId`. The check is harmless today and becomes always-false after the migration.
2. **Indexes no query uses:**
   - `guardianLinks.by_guardian` and `receipts.by_school_number`. Dropping an index deletes no data, but each looks intended for lookups (contact → students, receipt number lookup). Retained; decide with the owners.
   - `users.email` and `users.phone` belong to Convex Auth's own lookups. Keep.

No table is proposed for deletion.
