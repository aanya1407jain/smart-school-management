# Remaining work — Smart School Management System

_As of 18 Oct 2026, after the MVP-completion pass (uncommitted). Companion to `docs/IMPLEMENTATION_STATUS.md` and `docs/VERIFICATION_REPORT.md`._

## 1. Needs an owner decision or approval (blocked on people, not code)

| # | Item | Why it is blocked | What is needed |
|---|---|---|---|
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

## 3. Out of scope by decision

- Payroll / HR beyond daily staff attendance and leave.
- A separate accountant portal or primary role (accountant = restricted admin).
- Removing the demo experience: demo personas keep the mock services; live accounts never see demo data.

## 4. Deployment parity checklist (do not run without approval)

1. Confirm the target deployment name and that it is **not** production unless production is intended; never point tests or seeds at production.
2. `git status` clean on the reviewed commit; `npm ci`; `npm run typecheck`; `npm run test:convex`; `npm run build`.
3. `npx convex deploy` to the approved target. New in this pass: `convex/crons.ts` (daily 02:30 UTC fee reminders), `convex/feeReminders.ts`, `convex/profile.ts`, `convex/dashboards.ts`; no schema changes.
4. In the Convex dashboard: Functions list includes `profile:*`, `dashboards:teacherOverview`, `audit:feed`, `reports:lowAttendance`, `feeReminders:*`; Crons shows "fee-due reminders".
5. Frontend: deploy the same commit with `NEXT_PUBLIC_CONVEX_URL` of the same deployment.
6. Smoke as a school-created admin: Teachers & Staff, Examinations, Timetable, Audit log, Profile, Accounts → Office & access; as a teacher: dashboard, profile → apply leave; as an accountant-only login: only Dashboard, Students, Fees, Notifications, Reports, Profile in the navigation.
7. Record the deployed commit SHA next to the deployment name.
