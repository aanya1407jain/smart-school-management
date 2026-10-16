# Backend foundation — Smart School Management System

Convex is the backend and database. This document is the **shared contract** for everyone building on it
(Admin Portal, Teacher Portal, Student/Guardian Portal). If you need to change anything in the
"Rules" sections, talk to the backend owner first.

> Aster Academy is only demo data (`convex/seedData/asterAcademy.ts`). Nothing in the backend may
> depend on a particular school.

---

## 1. Layout

```
convex/
├── schema.ts              All tables + indexes (single schema for the whole team)
├── auth.ts                Convex Auth (Login ID + password, no self sign-up, session gate)
├── auth.config.ts         JWT issuer config (generated, do not edit)
├── http.ts                Auth HTTP routes (JWKS / OpenID discovery)
│
├── core/                  Cross-cutting building blocks — use these, don't re-implement
│   ├── functions.ts       schoolQuery / schoolMutation / schoolAction / userQuery / userMutation
│   ├── actor.ts           getCurrentUser, requireAuthenticatedUser, requireActor (school + role resolution)
│   ├── authorization.ts   requirePermission, getInSchool, requireClassTeacher, requireTeacherAssignment,
│   │                      requireSectionRead, requireStudentAccess, requireGuardianStudentAccess, …
│   ├── permissions.ts     THE permission catalogue (shared with the frontend)
│   ├── validators.ts      Enum validators + date/time/money/email checks
│   └── errors.ts          AppError + codes
│
├── model/                 Server-only domain helpers (not callable from clients)
│   ├── academics.ts       roster / name helpers
│   ├── memberships.ts     membership shape + access checks
│   ├── accounts.ts        reserve / provision accounts, Login ID generation, temporary passwords
│   ├── loginIds.ts        Login ID canonical form + generated formats (shared with the frontend)
│   ├── importSpecs.ts     import field specs, column mapping, date parsing (shared with the frontend)
│   ├── importers.ts       import analysers (preview) + committers (all-or-nothing)
│   ├── calendar.ts        today-in-school-timezone, school-day rules (working days − holidays)
│   ├── grading.ts         grading schemes (per school setting)
│   ├── counters.ts        atomic per-school document numbers (admission, employee, receipt)
│   ├── audit.ts           writeAudit()
│   └── notifications.ts   notifyUsers(), userIdsForStudent()
│
├── users.ts               me, viewer, session, studentContext
├── account.ts             changePassword (own account)
├── accounts.ts            admin: create, issueTemporaryPassword, issuePendingCredentials, setStatus, listPeople
├── imports.ts             previewStudents / commitStudentRows, previewTeachers / commitTeacherRows
├── setup.ts               internal only: initSchool, addAdministrator, issueTemporaryPassword (operator CLI)
├── memberships.ts         list (paginated), updateAccess
├── schools.ts             publicProfile, current, updateProfile, updateSettings
├── academics.ts           years/classes/subjects/sections, curriculum, roster, assignments, class teacher, enrollment
├── attendance.ts          getByDate, listBySection, studentHistory, dailyOverview, mark, update
├── notifications.ts       list, unreadCount, markRead, markAllRead
├── files.ts               generateUploadUrl, register, getUrl, listForOwner, remove (+ homework / submission attachments)
├── fees.ts                structures, assignment, concessions, recordPayment (retry-safe), reversePayment, ledger, receipts, collection
├── exams.ts               exams, papers, marks entry (subject-teacher scope), publish → results, section results
├── timetable.ts           periods, lessons with clash checks, section / teacher views
├── homework.ts            create/update/close, submissions (own work only), review
├── notices.ts             draft → publish → archive, audience-scoped feed
├── events.ts              school calendar (holidays affect attendance school days)
├── staff.ts               staff attendance, leave apply / decide
├── reports.ts             enrollment, attendance, fee and exam-performance summaries
├── audit.ts               list
├── seed.ts                demo (internal) — dataset-driven seeding
└── seedData/              datasets (types.ts + asterAcademy.ts)
```

**Why flat module files?** The public API reads as `api.attendance.mark`, `api.academics.listSections`.
Put a new module in `convex/<module>.ts`; put its non-public helpers in `convex/model/<module>.ts`.
Do not create a folder with the same name as a module file (Convex paths would collide).

Frontend side: `src/lib/convex/` (provider, hooks, errors, `api` re-export, `use-file-upload.ts`) and `src/proxy.ts`.

**Function-by-function contracts** (arguments, who may call, rules, errors, retry guarantees):
[`docs/BACKEND_API_CONTRACTS.md`](./BACKEND_API_CONTRACTS.md).

**Live vs demo sessions (A-00).** Demo personas of the demo school bind to the in-browser demo data. Every
other account — student, guardian, teacher or admin created by the school — gets the LIVE workspace for its
server-derived role (`src/features/auth/live-user.ts`). Live accounts only open pages backed by Convex
(`src/lib/permissions/navigation.ts` `isLiveRoute`: admin Accounts & Import, Attendance, Notifications, student
admission/profile; teacher Attendance, Notifications, student profile; the whole student portal). Other pages
show "not connected to your school's records yet" instead of demo data until their screens are wired to the
functions above.

---

## 2. Running it

```bash
npm install
npx convex dev              # first run: log in / create the project; writes CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL to .env.local
npx @convex-dev/auth        # once per deployment: sets JWT_PRIVATE_KEY, JWKS, SITE_URL
npx convex env set ALLOW_DEMO_SEED true   # dev deployments only
npm run seed:demo           # seeds the Aster Academy demo school + demo logins
npm run dev                 # Next.js
```

Demo logins (Login ID / password): `ADMIN-001 / Admin@123`, `TCH-00001 / Teacher@123` (Rahul Verma, class
teacher 10-A), `TCH-00002 / Welcome@123` (Meera Iyer, class teacher 10-B), `TCH-00003 / Welcome@123` (Sunita Rao,
English 10-A/B/C, class teacher 10-C), `STU-2026-00001 / Student@123` (Aarav, 10-A), `GRD-00001 / Guardian@123`
(Priya Sharma → Aarav 10-A + Ananya 8-B). Teachers `TCH-00004`…`TCH-00010` and `STU-2026-00002` (Amaira) use
`Welcome@123`.

A **real school** is never created by the seed: run the internal `setup:initSchool` action once (see README),
which creates the school, its current academic year, default settings and the first administrator
(`ADMIN-001` + a temporary password).

`NEXT_PUBLIC_CONVEX_URL` unset → the app runs exactly as Stage 1 (mock services, static pages).
`NEXT_PUBLIC_CONVEX_URL` set → Convex + Convex Auth providers and `src/proxy.ts` are active.

---

## 3. Rules: multi-school tenancy

1. **Every school-owned table has `schoolId`.** Global tables: `users`, Convex Auth tables, `schools`.
2. **Access comes only from `schoolMemberships`** (`userId`, `schoolId`, `role`, `status`, person link).
   The backend resolves `session → user → active membership → school` (`convex/core/actor.ts`).
3. **The client never supplies a trusted `schoolId`, `role` or `userId`.** Every school function accepts an
   optional `membershipId` *selector*; it is checked against the caller's own active memberships.
   - one active membership → used automatically;
   - several → client must send `membershipId`, else `SCHOOL_SELECTION_REQUIRED`;
   - not yours / suspended / school suspended → `NO_SCHOOL_ACCESS`.
4. **Every client-supplied id is loaded with `getInSchool(ctx, table, id)`.** Missing *and* other-school
   documents both throw `NOT_FOUND`, so ids from School B are indistinguishable from nonexistent ones.
5. Lists use indexes that start with `schoolId` (or a parent id already verified with `getInSchool`).

Isolation is tested in `tests/convex/tenancy.test.ts` (two schools with identical shapes).

---

## 4. Rules: identity & authentication

- **Convex Auth, Password provider, keyed by Login ID.** The provider's account id is the canonical Login ID
  (`convex/model/loginIds.ts`: NFKC, trimmed, upper-case, `^[A-Z0-9][A-Z0-9._-]{2,39}$`). Email is an optional
  contact field and never a sign-in identifier. Generated formats: `ADMIN-001`, `TCH-00001`, `STU-<year>-00001`,
  `GRD-00001` (per-school counters; an explicit generated-shape ID advances the counter). Password policy:
  ≥ 8 chars with a letter and a digit. Passwords are hashed by Convex Auth (Scrypt); hashes never leave the server.
- **No self-registration.** `flow: "signUp"` always fails (`validatePasswordRequirements` throws FORBIDDEN);
  password-reset flows are not configured. Accounts exist only because an administrator (or the operator CLI)
  created them:
  1. `reserveAccount` writes an *invited* (pending) membership carrying the Login ID and the person link
     (student / teacher / guardian record). Import with "create accounts" stops here.
  2. `provisionAccount` (action) calls Convex Auth `createAccount` with a server-generated temporary password
     (12 chars, `crypto.getRandomValues`, rejection sampling). `createOrUpdateUser` creates the `users` row
     (`loginId`, `mustChangePassword: true`) and activates the pending membership(s).
  3. The temporary password is returned once to the admin UI and stored nowhere readable. After sign-in the
     user is asked to change it (`account.changePassword`, which verifies the current password, clears the flag
     and signs out other sessions).
- **Admin API** (`convex/accounts.ts`, permission `users:manage`): `create`, `issueTemporaryPassword` (reset; signs
  the account out everywhere), `issuePendingCredentials` (≤ 50 per call, per-item results), `setStatus`
  (disable = membership `suspended` + `invalidateSessions`; enable), `listPeople`. Admins cannot disable or reset
  themselves. Role, school and person link are derived server-side; extra arguments are rejected by validators.
- **Temporary passwords** are server-enforced. Issuing one (account creation, admin reset, setup, break-glass)
  sets `users.mustChangePassword` + `users.temporaryPasswordIssuedAt` (server clock). While set, `requireActor`
  throws `PASSWORD_CHANGE_REQUIRED` for every school function; only `users.session` (opts in with
  `allowPendingPasswordChange`) and `account.changePassword` (no actor) work. It expires after
  `TEMPORARY_PASSWORD_TTL_MS` (7 days): `beforeSessionCreation` and `account.changePassword` refuse it with
  `TEMPORARY_PASSWORD_EXPIRED`. A successful change clears both fields and signs the other sessions out.
- **Sessions must exist.** `getCurrentUser` also checks that the token's `authSessions` row still exists, so
  `invalidateSessions` (reset, password change, disable) takes effect immediately rather than when the access
  token expires. `account.changePassword` additionally requires an active membership (disabled/suspended accounts
  cannot use it).
- **Older demo deployments** (accounts keyed by email) are upgraded in place with `seed:upgradeDemoLoginIds`
  (dry run by default; `{"apply":true}` to apply). `schoolMemberships` keeps the old invitation fields as
  deprecated optional fields only so such deployments pass schema validation.
- **Roll numbers are system-assigned** (`convex/model/rollNumbers.ts`). They live on the year-specific
  `enrollments` row. Whenever a section's active roster changes (import, `academics.enrollStudent` incl. transfers,
  `academics.endEnrollment`, demo seed), the whole section is renumbered 1..n in the SAME mutation: first name, then
  last name (case-, accent- and whitespace-insensitive), then student `_id`, then enrollment `_id`. Only that
  section is touched; closed/historical enrollments keep their last number. Roll numbers in uploaded files are
  ignored. Limit: 1,000 active students per section (`MAX_SECTION_ROSTER`). There is no student-name editing in
  Convex yet; when it is added it must call `renumberSections` for the student's active section.
- **Roster order on reads** (`model/academics.ts` `activeRoster` → `attendance.getByDate`, `academics.sectionRoster`):
  always the same comparator as roll numbers (`compareRosterEntries`), NOT the stored `rollNo`, so legacy rosters
  still list alphabetically; each row shows its STORED roll number. `accounts.listPeople` (students) sorts with the
  same rule before paginating (`model/sortedPagination.ts`: sort-key cursors, pages pinned via `splitCursor`, no
  duplicates/gaps when students are added, removed or renamed; inactive students are filtered before paging).
  Bounds: a section ≤ 1,000 active enrollments; the all-students view ≤ 5,000 active students
  (`MAX_SCHOOL_STUDENT_LIST`, above that filter by section).
- **Reconciling existing roll numbers** (`convex/rollNumberMaintenance.ts`, internal only — CLI/dashboard): rosters
  that have not changed since alphabetical numbering was introduced keep legacy numbers until reconciled. Nothing
  runs automatically. Dry run (read-only query, chunked by `startAt`/`nextStartAt`):
  `npx convex run rollNumberMaintenance:dryRun '{"schoolSlug":"…","academicYear":"2026-27"}'` → per section and
  student: current vs proposed number, missing/duplicate numbers, a fingerprint, totals and `applyArgs`. Apply
  (writes, only after review): `npx convex run rollNumberMaintenance:apply '<applyArgs>'` — confirmation string
  `APPLY_ROLL_NUMBER_RECONCILIATION`, one transaction per section, school/year/section re-validated, a section whose
  roster or names changed since the dry run is `stale` (not written), already-correct sections are
  `already_reconciled` (idempotent). Each applied section writes an `enrollment.roll_numbers_reconciled` audit row.
- **Audit semantics** (`auditLogs`): `actorUserId`/`actorRole` describe WHO acted (e.g. the administrator who
  created an account); `entity` is what changed. Account and membership events (`account.created`,
  `account.credentials_issued`, `account.disabled/enabled`, `membership.access_changed`) also record the AFFECTED
  account in `metadata.targetRole`/`targetKind`/`targetLoginId`. For `account.created` the actor's role is derived
  from the creator's membership in that school (it was previously written as a constant "admin"). Older rows are
  left untouched (no `metadata.target*`; the summary still names the account's role). Read-only check:
  `npx convex run audit:accountCreationReport '{"schoolSlug":"…"}'` compares each `account.created` row with the
  membership's actual role and student link.
- **Student records** (`convex/model/studentRecords.ts`): shared read models (placement, guardians, attendance,
  published results, fee ledger, homework with own submission, section timetable, audience-filtered notices). They
  do not authorize; `studentPortal.my*` (own / linked children only) and `academics.getStudentProfile` (school
  staff, assigned teacher, self/guardian; guardian contact and fees only for staff with full/fee access and the
  family) authorize first and return explicit fields only.
- **Admission form** (`academics.createStudentWithEnrollment`): class + section ids must match each other and the
  current year (no fallback), atomic admission number, guardian re-use by phone, section renumbered in the same
  transaction; no account or password is created (Accounts & Import does that).
- **Student portal** (`convex/studentPortal.ts`): `myProfile` resolves the caller's OWN student record purely
  server-side (session → membership → `studentId` or guardian links → student → current-year enrollment). An
  optional `studentId` only chooses among the students the server links to the caller; anything else is NOT_FOUND.
  Staff get FORBIDDEN. Missing data is explicit (`no_student_record`, enrollment `missing`/`ended`/`no_current_year`).
  `diagnoseStudentAccounts` (internal, read-only) checks every student account's links for one school.
- **Bulk student accounts** (`convex/bulkAccounts.ts`, `users:manage`): a run snapshots its scope (selected ids, or
  "all without an account" in a section/school, `prepareJob` in pages of 200), then the initiator's browser calls
  `processBatch` repeatedly (25 accounts per call — measured ~350 ms per account on a local backend, far below the
  10-minute action limit). Claims are exclusive mutations; stale claims (> 11 min) are re-queued; each student is
  handled idempotently through `reserveAccount`/`provisionAccount`. Temporary passwords are returned once per batch
  and never stored; accounts whose passwords were not acknowledged by the browser are listed and get NEW temporary
  passwords through `accounts.issuePendingCredentials`. Audit: `accounts.bulk_started/completed/cancelled`.
- **Imports** (`convex/imports.ts`): `preview*` (query) and `commit*Rows` (mutation) take mapped rows
  `{ rowNumber, values }` (≤ 300). The commit re-runs the same analyser and throws if any row is invalid, so a
  file imports completely or not at all. Students need `students:write`, teachers `staff:manage`, and
  `users:manage` in addition when accounts are created.
- **Session gate:** `beforeSessionCreation` refuses sign-in for disabled users and users with no active
  membership in an active school. Suspending a membership also cuts off existing sessions immediately
  (every call re-resolves the membership).
- Server-side token for RSC/Route Handlers: `convexAuthNextjsToken()`; cookies are maintained by `src/proxy.ts`.

---

## 5. Rules: roles & permissions (RBAC)

Roles are **portals**: `admin` (Admin/Principal), `teacher`, `student`.
**Guardian is not a role** — it is a `student`-role membership with `guardianId` set; it sees exactly the
students linked through `guardianLinks`. **Accountant is not a role** — it is an optional permission set
(`permissionSets: ["accountant"]`) on an admin-portal membership.

The catalogue lives in **`convex/core/permissions.ts`** and is imported by the frontend
(`src/lib/permissions/permissions.ts` re-exports it). There is no second list.

| Area | Admin | Teacher | Student / Guardian |
|---|---|---|---|
| Students | `students:read:all`, `students:write` | `students:read:assigned` | — |
| Attendance | `attendance:read:all` (view only) | `attendance:read:assigned`, `attendance:mark:class_teacher`, `attendance:edit:class_teacher` | `attendance:read:own` |
| Fees | `fees:manage` | — | `fees:read:own` |
| Exams | `exams:manage`, `exams:publish`, `marks:enter:any` | `marks:enter:assigned`, `exams:read:assigned` | `results:read:own` |
| Homework | `homework:read:all` | `homework:manage:assigned` | `homework:read:own`, `homework:submit` |
| Platform | `users:manage`, `audit:read`, `settings:manage`, `academics:manage`, `staff:manage` | `files:upload` | — |

Use `requirePermission(ctx.actor, "...")` / `requireAnyPermission` — **never** `if (actor.role === "admin")`.
`*:assigned` and `*:own` permissions always need a scope check as well (sections 6–7).

---

## 6. Rules: academic structure & teacher scope

```
schools ─┬─ schoolSettings (currentAcademicYearId, workingDays, attendance, grading, notifications)
         ├─ academicYears (2026-27)
         ├─ classes (Grade 8, level 8)                       year-independent
         ├─ sections (8-A: classId + academicYearId + classTeacherId)   per year
         ├─ subjects ──── classSubjects (class × subject × year)        ← CURRICULUM
         ├─ teachers ─┬── teacherAssignments (teacher × curriculum subject × section × year)
         │            ├── staffAttendance (teacher × date: present | absent | on_leave)
         │            └── leaveRequests (casual | sick | earned | duty; pending | approved | rejected)
         ├─ periods (bell schedule) ── timetableEntries (section × weekday × period → subject + teacher)
         ├─ counters (per-school document number sequences)
         ├─ students ─┬── enrollments (student × year × class × section, status, rollNo)  ← placement + history
         │            └── guardianLinks ── guardians
         └─ schoolMemberships (user ↔ school, role, teacherId | studentId | guardianId)
```

- A student's class/section is **never** a field on `students`; it is the enrollment for a year.
  Moving section closes the old enrollment (`transferred`) and creates a new one. Promotion creates next
  year's enrollment. History is never overwritten.
- **Teacher scope** for a year = sections from `teacherAssignments` ∪ sections where they are class teacher
  (`teacherSectionIds`). "Assigned" read permissions are limited to that scope.
- Three different relationships — never mix them up:

  | Relationship | Table / field | Means | Grants |
  |---|---|---|---|
  | Curriculum | `classSubjects` | the class studies this subject this year | nothing |
  | Subject assignment | `teacherAssignments` | this teacher teaches that curriculum subject to this section | read access to the section (teacher scope), marks entry later |
  | Class teacher | `sections.classTeacherId` | this teacher owns the section | **attendance mark/edit** |

  `academics.assignSubjectTeacher` rejects subjects that are not in the class's curriculum
  (`INVALID_RELATIONSHIP`); `academics.setClassSubjects` refuses to remove a subject that still has a teacher
  assigned. **SUBJECT ASSIGNMENT ≠ ATTENDANCE OWNERSHIP.** A teacher can own (be class teacher of) at most one
  section per academic year (enforced in `academics.setClassTeacher`).

---

## 7. Rules: attendance (first fully implemented workflow)

Owner = `sections.classTeacherId`. Enforced in `requireClassTeacher` inside `attendance.mark` / `attendance.update`:
authenticated → active membership → `attendance:mark|edit:class_teacher` permission → section in caller's school →
`section.classTeacherId === actor.teacherId`.

| Who | View | Mark (create register) | Edit / correct |
|---|---|---|---|
| Class teacher of the section | ✔ | ✔ | ✔ |
| Subject teacher of the section | ✔ read-only | ✘ | ✘ |
| Teacher with no link to the section | ✘ | ✘ | ✘ |
| Admin / Principal | ✔ all sections + overview | ✘ | ✘ |
| Student | own records | ✘ | ✘ |
| Guardian | linked students' records | ✘ | ✘ |

Additional server rules: date must be a real `YYYY-MM-DD`, not in the future (school timezone), a working
day and not a holiday; one register per section per date (`CONFLICT` → use `update`); entries must cover the
section's active roster exactly once (no students from other sections). No delete exists. Mark and every
correction are audited (`attendance.marked`, `attendance.corrected` with a per-student diff). Absences notify
the student's and linked guardians' accounts when the school enables attendance alerts.

Data: `attendanceSessions` (one per section/date, with counts) + `attendanceRecords` (one per student).

Query contracts:
- `getByDate({ sectionId, date, today })` — queries must not read the clock, so the client passes **today in the
  school's timezone** (`users.viewer().school.timezone`). `today` only drives the `canMark` hint; `mark` re-checks
  the real date server-side.
- `listBySection({ sectionId, from, to })` and `studentHistory({ studentId, from?, to? })` accept ranges of at most
  366 days (longer → `INVALID_ARGUMENT`, never silent truncation). `studentHistory` defaults to the current
  academic year and returns the `range` it used.

---

## 8. Rules: student & guardian access

`requireStudentAccess(ctx, studentId, { all, assigned, own })`:
- `all` permission → any student in the school;
- `assigned` → only if the student's **current active enrollment** is in the teacher's scope;
- `own` → only the student themself, or a student linked to the caller's guardian record.
Anything else → `NOT_FOUND` (never confirms that a student exists).

---

## 9. Fees, exams, timetable, homework, notices (schema ready, modules not yet built)

- **Fees:** `feeStructures` → `studentFees` (one obligation per installment, immutable amount) →
  `feePayments` (append-only transactions with `allocations`; reversals are new rows) → `receipts`;
  `feeConcessions` (percent in basis points or fixed). Balance = obligations − completed allocations −
  concessions; **never store a mutable balance**. Money is integer minor units (paise).
- **Exams:** status flow `draft → scheduled → in_progress → marks_entry → published` (same as the UI).
  Marks entry is open in `in_progress` and `marks_entry`; publishing requires one of those states, at least one
  paper and no pending paper–section sheets. `exams` → `examSubjects` (paper per class/subject with schedule + max/pass marks) → `marks`
  (per student per paper) → `results` (snapshot computed at publish, with per-subject breakdown and rank).
- **Timetable:** `periods` is the school's bell schedule (`index`, `label`, `startTime`, `endTime`, `isBreak`).
  `timetableEntries` reference a `periodId` (times are read from the period, never copied). Clash checks use
  `by_section_day_period` (one lesson per section per slot) and `by_teacher_day_period` (one section per teacher
  per slot).
- **Homework:** `homework` status is `active | closed` (no drafts) → `homeworkSubmissions`
  (`submitted | late | reviewed`).
- **Staff:** `staffAttendance` (one row per teacher per date; `on_leave` may point at the approved
  `leaveRequests` row) and `leaveRequests` (applied-at = `_creationTime`). Workflows not built yet.
- **Document numbers:** `counters` + `convex/model/counters.ts`. Allocate **inside the mutation that creates the
  document**: `nextAdmissionNumber(ctx, school, "2026")` → `AA-2026-0001`, `nextEmployeeId(ctx, school)` →
  `AA-EMP-001`, `nextReceiptNumber(ctx, school, year)` → `AA/26-27/0001`. Convex mutations are serializable, so
  concurrent allocations from the same key cannot produce duplicates; there is no public "give me a number"
  function. Use `ensureCounterAtLeast` when importing existing documents.
- **Notices/events:** `notices` and `events` with a server-resolved `audience` (all / roles / classes / sections).

---

## 10. How to add a query or mutation

```ts
// convex/homework.ts
import { v } from "convex/values";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, requirePermission, requireTeacherAssignment } from "./core/authorization";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { writeAudit } from "./model/audit";

export const create = schoolMutation({
  args: { sectionId: v.id("sections"), subjectId: v.id("subjects"), title: v.string(), description: v.string(), dueDate: v.string() },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "homework:manage:assigned");          // 1. capability
    const section = await requireTeacherAssignment(ctx, args.sectionId); // 2. scope (+ tenant check)
    const subject = await getInSchool(ctx, "subjects", args.subjectId);  // 3. every id via getInSchool
    assertIsoDate(args.dueDate, "dueDate");                              // 4. validate values
    const id = await ctx.db.insert("homework", {
      schoolId: ctx.actor.schoolId,                                      // 5. schoolId from the actor, never args
      academicYearId: section.academicYearId, sectionId: section._id, subjectId: subject._id,
      teacherId: ctx.actor.teacherId!, title: assertNonEmpty(args.title, "title"), description: args.description,
      assignedOn: new Date().toISOString().slice(0, 10), dueDate: args.dueDate, status: "published", attachmentFileIds: [],
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "homework.created",
      entity: { table: "homework", id }, summary: `Homework "${args.title}" for ${section.displayName}` });
    return id;
  },
});
```

Checklist (enforced partly by `tests/convex/permissions.test.ts`):
1. Public functions use `schoolQuery` / `schoolMutation` (or `userQuery` / `userMutation` for pre-school
   identity calls). Raw `query`/`mutation` only for the allow-listed public endpoints.
2. Arguments use `v.id("table")` for ids, enum validators from `core/validators.ts`, and value checks
   (`assertIsoDate`, `assertTime`, `assertAmountMinor`, `assertNonEmpty`, `normalizeEmail`).
3. Write `schoolId: ctx.actor.schoolId` on inserts — never from args.
4. Read with `withIndex(...)`; add an index to `schema.ts` only for a real query you are writing.
   Bound lists with `.take(n)` or pagination.
5. Throw only `AppError` helpers (`forbidden`, `notFound`, `invalid`, `invalidRelationship`, `conflict`).
6. Audit important changes with `writeAudit`; notify with `notifyUsers` in the same mutation.
7. Return plain view-models (strings/ids/numbers) — not whole documents with internal fields.

**Naming:** module files are plural nouns of the domain (`attendance`, `academics`, `notifications`);
queries are `get…`, `list…`, nouns (`viewer`, `dailyOverview`); mutations are verbs (`mark`, `update`,
`create`, `setClassTeacher`). Audit actions are `"<entity>.<past_tense>"`. Indexes are `by_<field>_<field>`.
**Dates** `YYYY-MM-DD` strings, **times** `HH:MM`, **timestamps** epoch ms, **money** integer minor units.

**Error codes** (`ConvexError.data.code`): `UNAUTHENTICATED`, `NO_SCHOOL_ACCESS`, `SCHOOL_SELECTION_REQUIRED`,
`FORBIDDEN`, `NOT_FOUND`, `INVALID_ARGUMENT` (with optional `fields`), `INVALID_RELATIONSHIP`, `CONFLICT`.

---

## 11. Storage, notifications, audit

- **Files:** `files.generateUploadUrl` → browser POSTs the file → `files.register({ storageId, kind, ownerType,
  ownerId, fileName })`. Kind/owner/permission policy is in `convex/files.ts`; size and content type come from
  Convex's `_storage` metadata (PDF/PNG/JPEG/WebP ≤ 10 MB). `files.getUrl` re-checks access on every read.
- **Notifications:** `notifyUsers(ctx, schoolId, userIds, { type, title, message, href?, entity? })` inside the
  producing mutation; clients use `notifications.list / unreadCount / markRead / markAllRead`.
- **Audit:** `writeAudit(...)`; read with `audit.list` (`audit:read`). There is no update/delete for audit rows.

---

## 12. Frontend usage

```tsx
import { api } from "@/lib/convex/api";
import { useSchoolQuery, useSchoolMutation, useMembership } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { useAuthActions } from "@convex-dev/auth/react";

const register = useSchoolQuery(api.attendance.getByDate, { sectionId, date, today }); // undefined while loading
const mark = useSchoolMutation(api.attendance.mark);
try { await mark({ sectionId, date, entries }); } catch (e) { toast(getAppError(e)?.message ?? "Failed"); }

const { signIn, signOut } = useAuthActions();
await signIn("password", { email, password, flow: "signIn" });
```

`useSchoolQuery` / `useSchoolMutation` add the active `membershipId` automatically. `useMembership()` exposes
`me.memberships` for a school/role switcher.

**Migration path (module by module, one source of truth at a time):**
1. ✅ Auth/session (done): the login screen uses `useAuthActions().signIn("password", …)`; `SessionProvider`
   reads `api.users.session` (signedOut / noSchool / signedIn + viewer); `src/proxy.ts` redirects signed-out
   requests for `/admin|teacher|student/*` to `/login`; guardian child switching is verified with
   `api.users.studentContext`; password changes use `api.account.changePassword`. Until each module
   migrates, the server identity is bound in memory to its demo-data record (by Login ID; linked students
   by name, and only if linked on both sides) so the mock services know the caller — no session, role or
   password is kept in Web Storage by the app. (The Convex Auth client caches its 1-hour access JWT in
   localStorage; its `inMemory` mode is broken in 0.0.96. The refresh token stays in the httpOnly cookie.)
2. Then per module: rewrite the screen's data calls to `useSchoolQuery`/`useSchoolMutation` and **delete** the
   corresponding mock service + its seed slice in the same PR.
3. When the last module moves, delete `src/lib/mock-data`, `src/lib/store`, and the mock services.

---

## 13. Tests

| Command | What |
|---|---|
| `npm run test:convex` | In-process Convex tests (`convex-test` + Vitest): tenant isolation, auth resolution, accounts, imports, setup, attendance ownership, permission catalogue, source guard |
| `npm run test:convex:integration` | Against a real seeded deployment (`CONVEX_URL=…`): real Login ID sign-in, admin account creation, import, temporary password → change, disable/enable, attendance rules, guardian switching, notifications, audit |
| `npm run test:authz` | Mock-service attendance ownership, acting as server-shaped identities (no passwords) + identity-bridge rules |
| `npm run test:e2e` | Browser suite. Needs a seeded Convex deployment and a build with `NEXT_PUBLIC_CONVEX_URL`: real Login ID sign-in, server-side route protection, role routing, Accounts & Import flow, workflows |

---

## 14. Not built yet (intentional placeholders)

- Business logic for fees, exams/marks/results, timetable, homework, notices/events, students/teachers CRUD
  and reports: **schema only**. Build them in the module that owns them following §10.
- Password reset and email verification (Password provider supports both; needs an email provider such as
  Resend configured on the deployment). Today an administrator issues a new temporary password instead.
- Delivery channels for notifications (push/email/SMS) — add by scheduling an action from `notifyUsers`.
- Multi-school platform administration (creating a new school is currently done by a seed dataset or a
  future internal "provision school" mutation).
- Frontend screens still run on mock services (see §12).
