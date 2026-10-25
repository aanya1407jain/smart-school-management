# Staff permissions (RBAC) and student lifecycle — contracts

_24 Oct 2026, updated 25 Oct 2026 (Phase 2: import scholar numbers and duplicate blocking, roll-number history, admission register, Students → Export). Aanya's scope: authorization engine, student administration engine, Principal's Staff & Permissions page. For teammates building on it (Teacher portal — Trisha; Student portal, Finance, Dashboard — Apoorva)._

## 1. The access model in one page

A request is allowed only if **all** of the following pass, on the server, in this order:

1. **Identity.** Convex Auth session → `users` row (`disabled` is refused).
2. **Membership.** An `active` `schoolMemberships` row in an `active` school (`core/actor.ts`). The school always comes from the membership, never from the client.
3. **Module.** The school is entitled to the module (`moduleQuery(key)` / `moduleMutation(key)`, P1). Otherwise `MODULE_DISABLED`.
4. **Permission.** `requirePermission` / `requireAnyPermission` on the member's **effective permissions**.
5. **Record scope.** `getInSchool` (tenant), `requireSectionRead` / `requireStudentAccess` (assigned sections, own record), and `requireClassTeacher` (attendance marking).

**Effective permissions** are produced by `resolvePermissions(role, permissionSets, { grants, sectionLimited })` in `convex/core/permissions.ts`:

| Membership | Effective permissions |
|---|---|
| `admin`, no `grants` | Full administrator (the Principal): every admin permission |
| `admin` with `grants` (even `[]`) | Restricted office login: `OFFICE_BASE` + its grants, nothing else |
| `admin` with legacy `permissionSets: ["accountant"]` | Accountant permissions (kept for existing logins) |
| `teacher` | Teacher permissions + its grants (+ `area:admin` when a grant adds anything beyond teaching) |
| `student` | Student permissions; grants are never applied |

There are still exactly three account roles. "Accountant", "Admission officer", "Exam coordinator" and similar titles are only **presets and labels** for grants (`GRANT_PRESETS`, `accessProfile`). They never create a role.

## 2. Grants — `convex/core/grants.ts`

```ts
type Action = "view" | "create" | "edit" | "delete" | "approve" | "export";
type Grant  = { module: ModuleKey; actions: Action[] };    // stored on schoolMemberships.grants
CAPABILITIES[module][action]: { kind: "grantable"; permissions; sectionScoped?; link?; description }
                            | { kind: "unavailable"; reason }
```

- **How cells take effect.** Each grantable cell maps to existing permission strings, so the existing function checks enforce it. No handler checks grants directly.
- **Linked cells.** Cells that share one server control have the same `link` and must be granted together. The server rejects a partial group, and stored partial data grants nothing. Examples: Students Create+Edit; Finance View/Create/Edit/Delete.
- **Dependent cells** (`requires`) need another action of the same module. Students → Export (`students:export`) needs Students → View; the server rejects Export alone, and stored Export-without-View grants nothing.
- **Unavailable cells** have no server control yet (Export outside Students, Finance Approve) or are reserved:
  - attendance marking: class teacher only;
  - Principal-only (`PRINCIPAL_ONLY`): `users:manage`, `settings:manage`, `audit:read`, `staff:manage`.
- **Section limits** (`schoolMemberships.sectionScope`) apply to teachers only. With limits, Students/Attendance **view** grants stay at the `*:read:assigned` tier, and the member's read scope becomes their teaching sections plus the listed sections (`readScopeSectionIds`). Teaching duties (marking, homework, marks entry) never use those extra sections.
- **New permission** `students:lifecycle` covers promotion, TC and pass-out. It maps to Students → Approve.

### Server API (`convex/memberships.ts`)

All three functions require a **full administrator**. They return `FORBIDDEN` for restricted office logins, teachers and students.

| Function | Args | Notes |
|---|---|---|
| `staffAccess` (query) | — | Admin and teacher logins with `fullAdministrator`, `grants`, `accessProfile`, `sections`, `summary`, `isSelf` |
| `setPermissions` (mutation) | `targetMembershipId`, `fullAdministrator?`, `grants`, `accessProfile?`, `sectionIds?` | See the rules below |
| `permissionHistory` (query) | `targetMembershipId?`, `limit?` | Permission and access audit rows, newest first |

`setPermissions` rules:
- **Refused:** your own login, students, another school's member (`NOT_FOUND`), unknown, unavailable or partial cells, section limits on office logins.
- **Effect:** applies on the member's next call.
- **Audit:** writes `membership.permissions_changed` with before and after.

The legacy `memberships.updateAccess` (suspend/reactivate, accountant set) still works. Setting a permission set clears grants.

### Session and frontend

- **Server values.** `users.session` → `viewer.permissions` (effective, server-computed), `viewer.restricted` and `viewer.accessProfile`.
- **Frontend helpers.** `useSession().can(p)`, `hasPermission(user, p)` and the nav and route guards use the server's list when present (`withServerAccess`), and fall back to the role otherwise. Hiding UI is never the security boundary.
- **Restricted office logins** land on their first allowed page (`landingRouteFor`).
- **Teachers with school-wide grants** get an **Additional duties** menu linking to the admin pages those grants open.

### Rules for new functions (all teammates)

1. Use `moduleQuery/moduleMutation(key)` for module data and `schoolQuery/schoolMutation` for core data. Never use raw `query`/`mutation`.
2. Check permissions, never roles: `requirePermission(ctx.actor, "...")`. A grant can then turn your function on for the right staff without code changes.
3. If a new action needs its own control (for example a finance "approve refund"), add the permission to `PERMISSIONS`, check it in the function, and map it in `CAPABILITIES`. Until then the cell stays unavailable.
4. Load every client-supplied id with `getInSchool`. Use `requireStudentAccess` / `requireSectionRead` for per-student or per-section reads.

## 3. Student administration — `convex/academics.ts`, `convex/studentLifecycle.ts`

| Function | Permission | Behaviour |
|---|---|---|
| `academics.createStudentWithEnrollment` | `students:write` | See below |
| `academics.updateStudentProfile` | `students:write` | `scholarNo`: `""` clears it; any other value must be unique (`CONFLICT`) |
| `studentLifecycle.findByScholarNo` | `students:read:all` or `students:lifecycle` | Exact lookup; case and spaces are ignored |
| `studentLifecycle.promotionPlan` | `students:lifecycle` | Who can move from a section to a section of a later year, and why not |
| `studentLifecycle.promote` | `students:lifecycle` | See below |
| `studentLifecycle.passOut` | `students:lifecycle` | Enrollment becomes `completed`; student becomes `alumni`. Atomic, ≤ 200 students |
| `studentLifecycle.sectionStudents` | `students:lifecycle` | Active roster for choosing who passes out |
| `studentLifecycle.issueTransferCertificate` | `students:lifecycle` | See below |
| `studentLifecycle.cancelTransferCertificate` | `students:lifecycle` | TC becomes `cancelled` (row and number kept); the student's previous status is restored; the enrollment is not reopened |
| `studentLifecycle.transferCertificates` / `transferCertificate` | `students:lifecycle` or `students:read:all` | List; one TC with the school header for printing |

`createStudentWithEnrollment`:
- Optional `scholarNo`, unique per school (`CONFLICT`).
- Refuses a child with the same name and date of birth as an existing student, in any status (`CONFLICT`, `fields.duplicateOf`), unless `confirmNotDuplicate: true`. The confirmation is audited.

`promote`:
- The target must be a later academic year, at the same or a higher class level.
- The old enrollment becomes `promoted` and keeps its roll number. A new `active` enrollment is created for the **same** student, and both rosters are renumbered.
- Atomic: one ineligible student refuses the whole request. At most 200 students per request.

`issueTransferCertificate`:
- Ends the active enrollment as `withdrawn` and renumbers the roster.
- The student becomes `transferred`.
- The certificate is numbered `TC/<code>/<yy-yy>/0001` (per academic year) and stores a snapshot.
- One issued TC per student at a time.

| `academics.rollNumberHistory` | `students:read:all`, or the student's own record | Every roll number the student was given (newest first, ≤ 200): year, section, from → to, reason |
| `imports.previewStudents` / `commitStudentRows` | `students:write` | Optional **Scholar number** column (unique in the file and the school). A child with the same name and date of birth as an existing student (any status) or as an earlier row is an **error**, not a warning; a genuinely different child is admitted through the admission form with `confirmNotDuplicate` |

All of these are in the Student Management module, so they return `MODULE_DISABLED` when it is off and keep their data.

### Roll numbers (`convex/model/rollNumbers.ts`)

- **Scope:** the section (one school, academic year and class). The number lives on that year's `enrollments` row, never on the student.
- **Allocation:** the active roster is renumbered 1..n alphabetically in the same transaction as any roster change (admission, import, transfer, withdrawal, TC, promotion, name correction).
- **History:** every assignment or change is appended to `rollNumberHistory` (`applyRollNo`) with the acting user, so the numbers a student had earlier in the year are kept. Ended enrollments keep their last number; a promotion starts a new number in the new year's section.

### Admission register / CSR (`convex/admissionRegister.ts`)

The register is ordered by admission number and includes every status (leavers stay in it).

| Function | Permission | Behaviour |
|---|---|---|
| `admissionRegister.page` | `students:read:all` | Paginated rows (≤ 100 per page) + the school's active extra `columns` |
| `admissionRegister.exportPage` | `students:read:all` **and** `students:export` | Same rows, for downloading (Students → Export) |
| `admissionRegister.studentEntry` | `students:read:all` | One student's row |
| `admissionRegister.fields` | `students:read:all` or `settings:manage` | Extra columns; `includeInactive` needs `settings:manage` |
| `admissionRegister.defineField` | `settings:manage` (Principal only) | Create/change a column: `key` (a-z0-9_), `label`, `type` (`text`/`number`/`date`/`select`/`boolean`), `options`, `required`, `order`, `active`. Key and type are fixed once created; deactivate instead of deleting (values are kept) |
| `admissionRegister.setStudentValues` | `students:write` | `{ studentId, values: { key: value \| null } }`. Unknown/inactive columns, wrong types and an empty required column are refused. Audited with column keys only |

Row shape: `admissionNo, scholarNo, name, gender, dateOfBirth, admissionDate, status, address, parent { name, relation, phone }, admittedTo { academicYear, className, section }, current { academicYear, className, section, rollNo }, leaving { tcNo, leavingDate, reason }, custom { [key]: value | null }, missingRequired: key[]`. Standard columns are derived from existing records; only the school's extra columns are stored. **No extra columns exist by default** — they wait for each school to confirm its register format.

**Invariants (tested):**
- A student record is never duplicated by promotion.
- Ended enrollments keep their class, section, dates and last roll number.
- Nothing is deleted.
- Scholar numbers are unique per school, including against concurrent mutations (Convex serializable transactions on the `by_school_scholar` index).
- Sign-in accounts are not changed by lifecycle operations; suspend them in Accounts if needed.

### Schema additions (additive, optional fields only)

- **`schoolMemberships`:** `grants?`, `accessProfile?`, `sectionScope?`.
- **`students`:** `scholarNo?`, `scholarNoKey?`, plus the index `by_school_scholar`.
- **New table `transferCertificates`:** indexes `by_school_student` and `by_school_number`.
- **New table `rollNumberHistory`** (append-only): `schoolId, academicYearId, sectionId, enrollmentId, studentId, fromRollNo?, toRollNo, changedAt, changedByUserId?, reason: "roster_change" | "reconciliation"`; indexes `by_school_student`, `by_enrollment`.
- **New table `admissionRegisterFields`:** `schoolId, key, label, type, options?, required, order, active, updatedAt, updatedByUserId`; index `by_school_key`.
- **New table `admissionRegisterValues`:** `schoolId, studentId, values: Record<key, string | number | boolean>, updatedAt, updatedByUserId`; index `by_school_student`.
- **New permission `students:export`** (full administrators have it; grantable as Students → Export).

No data migration is needed; existing documents stay valid.

## 4. Pages

- **`/admin/permissions` — Staff & Permissions** (full administrators):
  - staff list and module × action matrix;
  - presets and a label;
  - teacher section limits;
  - a confirmation listing every change;
  - the change history.
- **`/admin/promotions` — Promotions & TC** (`students:lifecycle`): promote, pass out, and issue, reprint or cancel transfer certificates.
- **Admission form and student edit:** scholar number field, and a confirmation for a possible duplicate child.

## 5. Not done yet

- **Admission register page (UI):** the backend and pluggable columns are done; the screen and each school's extra columns wait for the school to confirm its register format.
- **Export controls outside Students, Finance view-only and finance approvals:** need new server controls first (see rule 3). Existing on-screen CSV downloads (fees, reports, attendance) are not gated separately: anyone who can view the list can download it.
- **Section limits for office logins:** they are school-wide by design.
- **Live end-to-end and integration tests** for these pages need the functions on a deployment, which needs approval.

## 6. Audit log conventions (all teammates)

Write one audit row in the **same mutation** as the change, with `writeAudit(ctx, …)` from `convex/model/audit.ts`. It commits or rolls back with the change.

| Field | Convention |
|---|---|
| `schoolId` | Always `ctx.actor.schoolId` (never a client value) |
| `actor` | `ctx.actor` (records user and role). Omit only in operator tools (`internal*` functions) |
| `action` | `<entity>.<past_tense_verb>`, lower snake case: `student.admitted`, `enrollment.transferred`, `membership.permissions_changed`, `admission_register.field_created`, `school.modules_changed` |
| `entity` | `{ table, id }` of the main record changed |
| `summary` | One plain sentence for the audit page (names and numbers, no secrets) |
| `metadata` | Ids and changed field/column **names**. For access changes, `before` and `after`. Never passwords, tokens, or free-text personal values (the register audit stores column keys only) |

Always audit: permission and access changes, module changes, admissions and imports, enrollment and lifecycle changes (promotion, TC, pass-out), account creation/reset/disable, fee payments and reversals, result publication. Reads and exports are not audited (queries cannot write).

## 7. Frontend integration checklist (Trisha, Apoorva)

1. **Call Convex through the school hooks** (`useSchoolQuery` / `useSchoolMutation`). Never pass a `schoolId`; the server takes it from the membership.
2. **Gate UI on server-computed values only:** `useSession().can("<permission>")` and `useSession().hasModule("<module>")`. Hiding is convenience; the server refuses anyway.
3. **New pages:** add a nav item and a route rule (`src/lib/permissions/navigation.ts`, `routes.ts`) with the same `anyOf` permissions and `module` the server checks. Mark `live: true` only when the page reads Convex.
4. **Handle error codes:** `getAppError(e)` → `FORBIDDEN`, `NOT_FOUND` (also another school's id), `MODULE_DISABLED`, `CONFLICT` (duplicates), `INVALID_ARGUMENT` (with `fields` for form hints), `PASSWORD_CHANGE_REQUIRED`.
5. **Student identity:** show `admissionNo` and `scholarNo`. Never create a second student for an existing child; use `enrollStudent` (section transfer) or `studentLifecycle.promote`.
6. **Roll numbers are read-only** in every UI. Show `enrollment.rollNo`; for history use `academics.rollNumberHistory`.
7. **Downloads of the admission register** must page through `admissionRegister.exportPage` (≤ 100 rows per page) and show the button only when `can("students:export")`.
8. **New server actions that need their own control** (for example a finance "approve refund" or an export): ask for a permission to be added to `PERMISSIONS`, check it in the function, then map it in `CAPABILITIES` so the Principal can grant it. Until then the cell stays unavailable.
9. **Tests:** add every new public function to the inventory in `tests/convex/module-entitlements.test.ts` (module or core). The suite fails otherwise.
