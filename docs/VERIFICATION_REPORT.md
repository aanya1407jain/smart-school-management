# Verification report — MVP completion pass

_18 Oct 2026. Code: `feat/convex-backend-foundation` @ `9ffbbc6` plus this pass's uncommitted changes (tree of `9ffbbc6` = `origin/main` @ `a9cf740`). Nothing was committed, pushed or deployed to a shared deployment._

## Environment

- **Isolated staging = local sandbox Convex backend** (self-hosted, `127.0.0.1:3310`, throwaway data directory restored from a seeded snapshot before the run). No Convex Cloud deployment (dev or production) was read or written.
- Functions were pushed to the sandbox with `npx convex deploy` (self-hosted URL + sandbox admin key); the Next.js app was built with `NEXT_PUBLIC_CONVEX_URL` pointing at the sandbox and served on `localhost:3000`.
- Browser: Playwright with the preinstalled Chromium headless shell.
- Test-only accounts used in the sandbox (a throwaway administrator, an accountant-only login and an imported teacher) exist only in that sandbox. No credentials are recorded here.

## Gate results

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

## New Convex tests (this pass)

| File | Covers |
|---|---|
| `tests/convex/mvp-p1-fees-reports.test.ts` | Concession revoke (reason, roles, other school, audit, history kept); cancel assignment (refused while paid, allowed after reversal, rows kept, append-only payments); structure edit lock; fee-due reminders (due-soon + overdue once per installment & recipient, rerun-safe, paid installments skipped, school isolation, setting off, inactive school, daily fan-out with scheduled jobs); low-attendance (threshold, late rule, section filter, roles, isolation, bad range) |
| `tests/convex/mvp-p1-people.test.ts` | Accountant-only resolution (exact set) and server refusals across modules; access changes (self, other school, non-admin, users:manage only), staff-login reservation; staff profile (teacher phone only, admin rename, students refused, audit); student documents (admin/family read, teacher/accountant/other school refused, admin-only delete, audit); enrollment history across transfer/withdrawal; teacher records edit (validation, sync of sign-in name, isolation, deactivate); leave apply/overlap/withdraw/decide once + single notification; staff attendance (leave link, future date, roles); audit feed (role, order, actor, filter, isolation) |
| `tests/convex/mvp-p1-exams-homework.test.ts` | Exam marks-entry progress gates publication; subject-teacher scoping; publish once with one notification per family member; report-card data; homework submission counts and admin oversight isolation |
| `tests/convex/teacher-dashboard.test.ts` | Teacher landing data limited to the caller's own sections/lessons/homework/marks; other roles refused; other school isolated |

## Existing tests changed (intentional behaviour changes, not weakening)

| Test | Change | Reason |
|---|---|---|
| `tests/convex/tenancy.test.ts` | A subject teacher reading a **student document** now expects `NOT_FOUND` (was allowed) | Decision "Admins only, audited": documents visible to admins and the family only. Stricter than before |
| `tests/convex/student-records.test.ts` | `studentPortal.myResults` now also returns `school` and `student {name, admissionNo}`; the assertion checks those exact values | Report-card header |
| `tests/convex/live-staff-session.test.ts` | Newly connected routes are expected to be live; nav lists updated; adds an accountant-only nav assertion and negative cases for unknown routes | Routes were connected by design in this pass |
| `scripts/e2e.mjs` | Live homework text pattern accepts the consolidated live component's wording | Component consolidation; the check still requires the real page state |

## Live-UI smoke (sandbox) — what was exercised in the browser

- School-created admin: changes the temporary password; navigation lists Teachers & Staff, Examinations, Timetable, Homework, Audit log, Profile; `/admin/teachers` (teachers, staff attendance, leave tabs), `/admin/audit`, `/admin/profile`, `/admin/timetable`, `/admin/examinations`, `/admin/homework` render live screens; low-attendance list shows the school threshold; student profile shows enrollment history, transfer/withdraw actions and documents with upload; Accounts → Office & access creates an accountant-only login with a one-time password.
- Accountant-only login: navigation shows only Dashboard, Students, Fees, Notifications, Reports, Profile; Reports shows only the Fees tab; Settings content is not shown; fee structure edit dialog opens (amounts locked when in use); a student ledger shows the corrections panel; students list is read-only.
- Teacher imported through Accounts & Import with a new sign-in: lands on the live teacher dashboard; profile shows My leave; applies for leave → admin sees and approves it → the teacher receives the "Leave approved" notification → the audit log lists `leave.approved` with the acting admin's name.

## Not verified here

- Any Convex Cloud deployment (dev/production) — see `docs/REMAINING_WORK.md` §4.
- The fee-reminder cron firing on a real schedule (verified via convex-test fake timers only).
- Uploading a real file through the browser (server-side file rules are covered by convex-test).
