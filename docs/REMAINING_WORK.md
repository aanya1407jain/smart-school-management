# Remaining work — Smart School Management System

_Updated 22 Oct 2026 (student totals fix and Guardian removal, re-audited the same day; uncommitted); originally written 18 Oct 2026 after the MVP-completion pass. Companion to `docs/IMPLEMENTATION_STATUS.md` and `docs/VERIFICATION_REPORT.md`._

## 1. Needs an owner decision or approval (blocked on people, not code)

| # | Item | Why it is blocked | What is needed |
|---|---|---|---|
| R0 | Review, commit and push the 22 Oct change set (student totals + Guardian removal) | Requires explicit approval | Review `git diff`; note `tests/convex/guardian-child-switching.test.ts` now tests the removal (rename with `git mv` if preferred) |
| R0c | Review, commit and push the P1 module-entitlement change set; then push it to the dev deployment and run E2E + a two-school check | Requires explicit approval (commit, push and every deployment) | Production: deploy Convex functions before the frontend; no school is configured until an operator runs `schoolModules:setSchoolModules` (unconfigured schools keep all five modules) |
| R0d | Decide who may change module entitlements beyond the deployment operator (e.g. a provider console) | No in-app platform-operator identity exists | Until decided, only internal operator functions change them |
| R0b | Run `migrations:removeGuardianAccounts` on each real deployment | Deletes data (irreversible) on a shared database. It has only ever run on the isolated sandbox; each real deployment needs its own review and explicit owner approval | Back up / export first, then dry run (`npx convex run migrations:removeGuardianAccounts`), check the report, then `{"apply":true}`; tell any former guardian users their sign-in is gone. Until it runs, those memberships already grant no access. After every deployment has run it: drop `schoolMemberships.guardianId` + `by_guardian` from the schema |
| R1 | Commit, push and open a PR for this pass | Requires explicit approval | Approve commit/push; review the diff |
| R2 | Deploy Convex functions to the shared **dev** and **production** deployments | Remote writes need explicit approval; parity with `main` is unverified (audit P0-3) | Follow the checklist in §4; approve each deployment separately |
| R3 | Run E2E / integration against a **cloud** staging deployment | Only a local sandbox backend was used | Create a separate staging deployment (never the dev or prod one), approve its use |
| R4 | Delete `audit-args.json` from the repository root | Unreferenced by code, scripts or config (grep), but deleting a file on the working machine needs approval | Approve deletion, or delete it in the commit |
| R5 | Email/SMS self-service password reset | No approved provider or design | Choose a provider; design rate limits and token handling first |

## 2. Known gaps (PARTIAL items)

| # | Gap | Notes |
|---|---|---|
| G1 | Attendance "bands per student" chart in Reports is not computed for live data | The per-student **below-threshold list** is live; the bands chart shows an explanatory empty state |
| G2 | Fee-due reminder cron has only been verified in convex-test (incl. scheduled fan-out) | Observe the first scheduled run after deployment (Convex dashboard → Logs, `feeReminders:remindSchool`) |
| G3 | `scripts/*.test.ts` suites still exercise the **mock** layer | The changed live functions are covered by new convex-test suites instead; porting the mock suites to Convex was not done |
| G4 | No single "Add teacher" form | Teachers are added through Accounts & Import (one row or a file), which allocates the employee ID; existing records are edited in Teachers & Staff |
| G5 | Low-attendance whole-school scan is capped (15,000 attendance records) | Above the cap the page asks for a section; fine for one school-year of a mid-size school, revisit for very large schools |
| G6 | `profile_photo` files for students keep the broader read rule (teachers of the student can read) | Only `student_document` was restricted, as decided |
| G7 | Student-document upload in the browser was not exercised end-to-end (upload button rendered; server rules tested in convex-test) | convex-test does not record blob content types, so registration of a real PDF is only checkable on a real backend |

## 2b. Known follow-ups from the 22 Oct change

| # | Item | Notes |
|---|---|---|
| G8 | Storage names `guardians` / `guardianLinks` remain for parent-contact data | Renaming tables needs a data migration; the product shows "Parent contact" everywhere |
| G9 | Mock demo-data internals still use `Guardian`/`guardianName` identifiers | Internal to the in-browser demo dataset; no UI text or account uses them |
| G10 | The demo school's Students page now lists the school's Convex records (as Accounts & Import and Attendance already did), not the richer mock list (status tabs, CSV export, fee standing) | Intended: admissions are stored in Convex, so the list and totals must read the same records |
| G11 | The Students page totals are bounded at 5,000 students per school (CONFLICT above that, never a silent wrong number) | Large schools need paginated counting |
| G12 | A student sign-in whose student-record link is missing keeps a session (portal shows "no student record", reads nothing) | Deliberate, so the office can see and repair it (`studentPortal:diagnoseStudentAccounts`); it grants no data access |
| G15 | Notice notifications whose publish date falls while Administration is off are skipped (`skipped: "module_disabled"`), not sent later; fee reminders resume from the current date | Recommended behaviour, documented in BACKEND §5b; needs owner confirmation |
| G16 | Holidays come from `events` (Administration) and decide school days for attendance (`model/calendar.ts` `isSchoolDay`). With Administration off, existing holidays still apply but new ones cannot be added | Decide: make the holiday calendar core, or make Attendance require Administration |
| G17 | Users' existing notifications and audit entries from a disabled module stay visible (inbox, audit log); their links lead to the "not enabled" page | Deliberate: inbox and audit are core records; confirm with the school |
| G18 | `accounts.listPeople` (core: Accounts & Import) still lists active students when Student Management is off | Needed to manage student sign-ins; no module data beyond the student identity |
| G19 | Until P1's functions are pushed to a deployment, the P1 frontend against it shows no module pages (session has no `modules`; fail-closed, "modules could not be confirmed") | Push P1 to that deployment (needs approval) |
| G20 | Legacy `schoolMemberships.guardianId` + `by_guardian` index remain; unused indexes `guardianLinks.by_guardian`, `receipts.by_school_number`; public functions unused by the UI but documented and tested (`homework.get`, `notices.get`, `reports.enrollmentSummary`, `reports.attendanceSummary`, `schools.publicProfile`) | See `docs/CONVEX_CLEANUP_AUDIT.md`; the guardian field goes only after `migrations:removeGuardianAccounts` has run everywhere (approval) |
| G21 | Admission (CSR) register fields | Waiting for the school to confirm its CSR fields |
| G22 | Scholar number column in the student spreadsheet import | Import cannot set it yet (so cannot create duplicates); add with a per-file uniqueness check |
| G23 | Export controls, Finance view-only, finance approvals | The grant matrix shows these as unavailable until a server control exists (docs/RBAC_AND_STUDENT_LIFECYCLE.md §2, rule 3) |
| G24 | Lifecycle operations do not change sign-in accounts (a transferred or passed-out student keeps a login to their own records) | Decide whether TC / pass-out should suspend the student login automatically |
| G13 | Records with an open enrollment but a non-active student status are excluded from totals and lists, but the enrollment is not closed automatically | Clean-up is an office action (`academics.endEnrollment`); no code path creates this state today |

## 3. Out of scope by decision

- Payroll / HR beyond daily staff attendance and leave.
- A separate accountant portal or primary role (accountant = restricted admin).
- Parent or guardian accounts of any kind (decision 22 Oct 2026: account roles are Admin, Teacher and Student only).
- Removing the demo experience: demo personas keep the mock services; live accounts never see demo data.

## 4. Deployment parity checklist (do not run without approval)

1. Confirm the target deployment name and that it is **not** production unless production is intended; never point tests or seeds at production.
2. `git status` clean on the reviewed commit; `npm ci`; `npm run typecheck`; `npm run test:convex`; `npm run build`.
3. `npx convex deploy` to the approved target. New in this pass: `convex/crons.ts` (daily 02:30 UTC fee reminders), `convex/feeReminders.ts`, `convex/profile.ts`, `convex/dashboards.ts`; no schema changes.
4. In the Convex dashboard: Functions list includes `profile:*`, `dashboards:teacherOverview`, `audit:feed`, `reports:lowAttendance`, `feeReminders:*`; Crons shows "fee-due reminders".
5. Frontend: deploy the same commit with `NEXT_PUBLIC_CONVEX_URL` of the same deployment.
6. Smoke as a school-created admin: Teachers & Staff, Examinations, Timetable, Audit log, Profile, Accounts → Office & access; as a teacher: dashboard, profile → apply leave; as an accountant-only login: only Dashboard, Students, Fees, Notifications, Reports, Profile in the navigation.
7. Record the deployed commit SHA next to the deployment name.
