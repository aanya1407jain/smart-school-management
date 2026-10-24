# Staff permissions (RBAC) and student lifecycle — contracts

_24 Oct 2026. Aanya's scope: authorization engine, student administration engine, Principal's Staff & Permissions page. For teammates building on it (Teacher portal — Trisha; Student portal, Finance, Dashboard — Apoorva)._

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
- **Unavailable cells** have no server control yet (Export, Finance Approve) or are reserved:
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

All of these are in the Student Management module, so they return `MODULE_DISABLED` when it is off and keep their data.

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

- **CSR / admission register:** waits for the school to confirm its fields.
- **Scholar number in the spreadsheet import:** the import cannot set it yet, so it cannot create duplicates.
- **Export controls, Finance view-only and finance approvals:** need new server controls first (see rule 3).
- **Section limits for office logins:** they are school-wide by design.
- **Live end-to-end and integration tests** for these pages need the functions on a deployment, which needs approval.
