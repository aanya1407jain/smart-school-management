# Smart School Management System

A reusable, role-based school management platform built around connected workflows —
students, academics, attendance, fees, examinations, timetable, homework, notices and reports.

**Status:** the Stage 1 frontend is complete and still runs on its mock service layer. The **production
backend foundation is in place on Convex** (`convex/`): multi-school tenancy, Convex Auth (Login ID + password, admin-created accounts),
centralised RBAC, the academic structure, server-enforced attendance ownership, audit, notifications,
storage and a dataset-driven seed. UI modules migrate to Convex one at a time.
**Backend contract for the team: [docs/BACKEND.md](docs/BACKEND.md).**

## Product vs. demo school

| | What it is | Where it lives |
|---|---|---|
| **Smart School Management System** | The product / platform | `src/lib/constants/product.ts` (name, browser title, storage namespace) |
| **Aster Academy** | A fictional demo school — the seed tenant used for development and tests | `src/lib/mock-data/seed.ts` (`db.school`, people, emails, IDs) |

Nothing outside the seed and the test scripts hard-codes the school. The app chrome (splash, login, sidebar,
breadcrumbs) shows the tenant name from `services.school.getPublicProfile()`, and generated values derive from
the school record (`services/derive.ts`):

- login emails → domain of the school's office email (`firstname.lastname@students.<domain>`)
- admission, employee and receipt numbers → school initials (`AA-2026-0123`, `AA-EMP-014`, `AA/26-27/0001`)
- welcome notifications → `Welcome to <school name>`

Rename the school in **Settings → School profile** and every one of these follows. To onboard a different school,
replace the seed (Stage 1) or create a new school record (Stage 2).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
# or
npm run build && npm start
```

Requires Node 20+. Fonts are self-hosted (`@fontsource`), so no external font calls are made at runtime.

## Demo accounts (Aster Academy)

Sign-in is real **Convex Auth** with a **Login ID + password** (email is only a contact field). These
accounts exist once a Convex deployment has been seeded with `npm run seed:demo` (see *Backend* below);
without a configured backend nobody can sign in. Aster Academy is demo data only.

| Portal | Account | Login ID | Password |
|---|---|---|---|
| Admin | Aanya Jain, Principal | `ADMIN-001` | `Admin@123` |
| Teacher | Rahul Verma — Maths 10-A, 10-B, 9-A · Science 10-A · class teacher 10-A | `TCH-00001` | `Teacher@123` |
| Teacher | Meera Iyer — Science · class teacher 10-B | `TCH-00002` | `Welcome@123` |
| Teacher | Sunita Rao — English 10-A/B/C · class teacher 10-C | `TCH-00003` | `Welcome@123` |
| Student | Aarav Sharma, Class 10-A | `STU-2026-00001` | `Student@123` |
| Student (guardian) | Priya Sharma — guardian of Aarav (10-A) and Ananya (8-B) | `GRD-00001` | `Guardian@123` |
| Student | Amaira Desai, Class 10-B (useful for audience tests) | `STU-2026-00002` | `Welcome@123` |

All ten seeded teachers have a login: `TCH-00001` … `TCH-00010` (Verma, Iyer, Rao, Khan, Nair, Mishra,
Kapoor, Singh, Joshi, Desai), password `Welcome@123` except Rahul Verma. Login IDs are case-insensitive.

**Accounts are created by the school, never by self-registration.** An administrator opens
**Accounts & Import** (Convex-backed) to add students/teachers one by one or import them from CSV/XLSX, create
sign-in accounts (Login ID generated as `STU-<year>-00001` / `TCH-00001`, or entered), issue or reset a
one-time temporary password, and disable/enable accounts. The person must change the temporary password after
signing in (`/account`). Students and teachers created in the older mock screens (*Students*, *Teachers &
Staff*) live only in the browser's demo store and get no account.

**The login form has no role selector.** The role, school and linked students come from the server
(`users.session`), so each account opens its own portal. Signed-out requests to `/admin`, `/teacher`, `/student`
and `/account` are redirected to `/login` by the server (`src/proxy.ts`) before any page code is sent.

The login page has a collapsible *Development demo accounts* helper that fills these in.
To start over, sign in as admin → **Settings → Demo data → Reset**.

## What to demo

Splash → Login → role-specific dashboard, then these cross-module workflows
(all verified by the end-to-end test run):

1. **Admin adds a student** (Students → Add student, Class 10-A) → student appears in the list →
   Mr. Verma sees them in *My Classes → 10-A* and in his attendance register → after he marks them,
   the new student logs in and their dashboard shows the updated attendance.
2. **Fees**: Fees → Fee structures → *New fee structure* → *Assign to class* → Aarav's ledger shows the
   new obligation → *Record payment* → receipt is generated → Aarav's *My Fees* shows the receipt and
   the lower balance.
3. **Teacher assignment**: Academics → Teacher assignments → change a subject's teacher → the new teacher is
   notified and immediately sees the class, its students and marks entry (attendance stays with the class teacher).
4. **Homework**: Mr. Verma creates homework for 10-A Mathematics → Aarav (10-A) sees it and can submit →
   Amaira (10-B) does not see it.
5. **Exams**: Half-Yearly is in *marks entry*. Mr. Verma enters Maths 10-A marks (Examinations → *Marks to enter*);
   admin enters/opens the remaining sheet, then *Publish results* → students see grades and ranks.
6. **Notices**: admin posts a notice to *Specific sections → 10-B* → only 10-B students (and their teachers) see it.

Route guards: try `/admin/fees` as a teacher, `/admin/students` or `/teacher/attendance` as a student,
`/teacher/classes/sec_12a` as Mr. Verma — each shows an *Unauthorized* state. Signed-out visits to any
workspace route redirect to `/login`.

## Architecture

```
src/
  app/                    Routes only (thin pages) — /login, /admin/*, /teacher/*, /student/*
  components/
    ui/                   Design-system components (GlassCard, StatCard, DataTable, Modal, Drawer,
                          FormField, Tabs, Toast, Empty/Loading/Error/Unauthorized states, …)
    layout/               AppShell (route guard), Sidebar, Topbar, MobileNav
    charts/  brand/
  features/               One folder per module (students, academics, teachers, attendance, fees,
                          examinations, timetable, homework, notices, notifications, reports,
                          settings, profile, dashboard, auth)
  lib/
    services/             ← the data/service layer the UI talks to (see below)
    permissions/          Roles, permission sets, route rules, navigation config
    mock-data/            Deterministic, relational seed (names, timetable generator, …)
    store/                Mock persistence (in-memory + localStorage, reactive)
    hooks/                useQuery / useMutation
    constants/  utils/
  types/domain.ts         Domain model (mirrors the future database schema)
```

### Service layer (the backend seam)

Components never import mock data. They call `services.<module>.<method>()` from
`src/lib/services/index.ts`, e.g. `services.students.list(filters)`,
`services.attendance.saveRegister(sectionId, date, entries)`, `services.fees.recordPayment(input)`.

Each mock service behaves like a backend function: it resolves the signed-in actor, checks
permissions **and data scope** (teacher → assigned sections only; student/guardian → linked
students only), reads/writes the store and returns plain data. Business rules — attendance %,
FIFO fee allocation, concessions, grades, notice audiences — live in `services/derive.ts`, never in components.

`useQuery` re-runs queries whenever the store changes (the same reactive model as Convex), which is
why a payment, attendance save or published result shows up everywhere without manual refreshes.

**Stage 2 migration:** implement e.g. `convexStudentService` with the same type as
`StudentService` and swap it in `services/index.ts`. Replace `useQuery`/`useMutation` with Convex's
hooks and `session-store.ts`/`auth.service.ts` with the real auth provider. Pages, forms and tables stay as they are.

### Attendance ownership

Student attendance is owned by the **class teacher** of each section (`sections.classTeacherId`).

| Who | View | Mark (new register) | Edit / correct |
|---|---|---|---|
| Class teacher of the section | ✔ | ✔ | ✔ |
| Subject teacher of the section (not class teacher) | ✔ read-only | ✘ | ✘ |
| Teacher with no link to the section | ✘ | ✘ | ✘ |
| Admin / Principal | ✔ all sections, reports, monitoring | ✘ | ✘ |
| Student / guardian | ✔ own / linked students | ✘ | ✘ |

A subject assignment, timetable slot or access to student records never grants attendance rights. The rule lives in
`lib/permissions/attendance.ts` (`canMarkAttendance`, `canEditAttendance`) and is enforced inside
`attendance.service.ts → saveRegister` against the live store, so a direct service call from an unauthorized user is
rejected with `FORBIDDEN`. Changing a section's class teacher in Academics moves ownership immediately. There is no
attendance delete action. (Staff attendance under Teachers & Staff is a separate admin function.)

Demo: Mr. Verma owns 10-A and sees 10-B (where he teaches Maths; class teacher Ms. Meera Iyer) read-only.
Mrs. Sunita Rao (`TCH-00003` / `Welcome@123`) teaches English in 10-A and owns 10-C.

### Permissions

`lib/permissions/permissions.ts` maps roles → permissions; `routes.ts` maps every protected route to
the permissions it needs; `navigation.ts` derives each sidebar from permissions. Utilities:
`hasPermission()`, `canAccessRoute()`, `getNavigationForUser()`. An **accountant** permission set
(fees, receipts, concessions, balances, financial reports — no settings, staff or exams) is already defined
in `PERMISSION_SETS` and can be attached to an account via `permissionSets: ["accountant"]`.

> This is frontend authorization only. In Stage 2 the same rules **must** be enforced server-side
> inside the Convex functions — the mock services show exactly where each check belongs.

### Guardians

There is no parent role or parent dashboard. A guardian is a `GuardianLink` between a `Guardian`
and one or more students. A guardian login is a student-portal account with several `studentIds`;
the top bar shows a student switcher and every query is scoped to the selected linked student.

## Design system

- Palette (exact): Scooter Teal `#2F9D94`, Blue Lagoon `#025F67`, Sapphire `#063154`,
  Soft Pink Lavender `#F3CCDE`, Dusty Lavender `#D6A8C4`, Muted Purple `#BA88AE`, Purple `#9E6899`,
  Deep Purple `#5B3765`, Alabaster `#F7F6F2` (app background), Heather `#BCC5CC`.
- Tokens live in `src/app/globals.css` (CSS variables) and `tailwind.config.ts`; charts read
  `lib/constants/theme.ts`. No hex values inside components.
- Glass (`.glass`, `.glass-strong`) is used for dashboard widgets, the login panel, modals and dropdowns;
  tables and forms use opaque `.solid-card` surfaces for readability.
- Charts use at most two categorical colours (Sapphire + Teal — validated for colour-blind separation);
  more categories are shown as small multiples.
- Small text uses Lagoon / Deep Purple rather than Teal / Purple to meet WCAG AA contrast.

## Backend (Convex)

```bash
npx convex dev                      # link/create a deployment; writes NEXT_PUBLIC_CONVEX_URL to .env.local
npx @convex-dev/auth                # once per deployment: JWT keys + SITE_URL
npx convex env set ALLOW_DEMO_SEED true && npm run seed:demo   # dev only: Aster Academy demo school
```

**Onboarding a real school** (never via the demo seed): once per deployment, run the internal setup action,
which refuses to run if a school already exists, and hand the printed Login ID + temporary password to the
first administrator:

```bash
npx convex run setup:initSchool '{"school":{"name":"Green Valley School","shortName":"Green Valley","code":"GVS","slug":"green-valley","timezone":"Asia/Kolkata","locale":"en-IN","currency":"INR"},"academicYear":{"name":"2026-27","startDate":"2026-04-01","endDate":"2027-03-31"},"admin":{"displayName":"Principal"}}'
```

The administrator then signs in, changes the password, sets up Academics (classes, sections, subjects) and
uses **Accounts & Import** for students and teachers. `setup:addAdministrator` and
`setup:issueTemporaryPassword` are CLI-only break-glass helpers. Exact arguments: `convex/setup.ts`.

The command prints the temporary password **once** to your terminal — hand it over through a private channel,
never paste it into tickets, chat or commits. Run setup from a trusted machine; nothing is stored in the repo.

**Temporary passwords** (first admin, accounts created or reset by an admin) are enforced on the server: until the
person changes it on `/account`, every school function answers `PASSWORD_CHANGE_REQUIRED` (only the session check
and the password change work), and it expires after **7 days** (`TEMPORARY_PASSWORD_TTL_MS` in
`convex/model/accounts.ts`) — then sign-in fails with *"This temporary password has expired"*. There is no public
password reset. Recovery: an administrator uses **Accounts & Import → Reset password**; if the only administrator is
locked out, the developer runs `npx convex run setup:issueTemporaryPassword '{"loginId":"ADMIN-001"}'` and hands the
new temporary password over privately (this signs the account out everywhere).

**Upgrading a demo deployment seeded before Login IDs** (demo accounts keyed by email — every displayed demo login
is rejected there): deploy the current code, then

```bash
npx convex run seed:upgradeDemoLoginIds                    # dry run: shows what would change
npx convex run seed:upgradeDemoLoginIds '{"apply":true}'   # re-keys the demo accounts to their Login IDs
```

It deletes nothing: existing users, password hashes, sessions and school data are kept; demo passwords keep working
under the Login IDs. Demo deployments only (`ALLOW_DEMO_SEED=true`).

Without `NEXT_PUBLIC_CONVEX_URL` the app builds and shows the login page, but sign-in is unavailable and
the protected portals stay closed. Business modules (attendance, fees, exams, …) still read the mock
store in the browser; the signed-in Convex identity is bound to its demo-data record in memory
(`src/lib/services/session-store.ts`). See
[docs/BACKEND.md](docs/BACKEND.md) for the schema, tenancy, auth, permissions, attendance rules and the
conventions for writing new Convex functions.

## Known limits of Stage 1 UI

- Data lives in the browser (localStorage); each browser has its own copy.
- File uploads (documents, logos, homework attachments) store names only.
- Password reset (the "Forgot password?" link), email/SMS notifications and online payments are simulated.
  Changing a password from the profile page is real (Convex Auth).
- The mock store holds one school (the Convex backend is multi-school, with per-school timezone/locale/currency). The UI locale is fixed to India (`en-IN` dates, INR currency, `+91` phone
  placeholders) and grading follows the CBSE 8-point scale — these are product defaults to make configurable
  per school in a later stage.

## Checks

```bash
npm run typecheck
npm run build && npm start          # terminal 1
npx playwright install chromium     # once
npm run test:e2e                    # terminal 2 — 82 checks: auth, product identity, route guards, 6 workflows, attendance ownership, mobile
npm run test:authz                  # 23 service-level checks: unauthorized attendance writes are rejected by the service layer
npm run test:convex                 # Convex functions in-process (convex-test): tenant isolation, RBAC, attendance ownership
CONVEX_URL=… npm run test:convex:integration   # against a real seeded deployment, with real Convex Auth sign-in
```
