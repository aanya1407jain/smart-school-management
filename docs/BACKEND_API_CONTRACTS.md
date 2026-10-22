# Backend API contracts (Convex)

Integration reference for portal work. Every function listed here **exists** in
`convex/`; the main paths and the authorization rules are exercised by
`tests/convex/*` (fees, exams, timetable-homework, notices-events-staff,
reports-profile, a01-authorization, live-staff-session). Signatures are the Convex `args`
validators; return shapes are the handler return values (use
`FunctionReturnType<typeof api.x.y>` in TypeScript instead of copying them).

## Conventions (all school functions)

- **Calling.** Use `useSchoolQuery`, `useSchoolMutation`, `useSchoolPaginatedQuery`
  and `useSchoolAction` from `src/lib/convex/membership.tsx`. They add the active
  `membershipId`, which the server verifies belongs to the caller.
- **Identity.** The role, school, teacher and student links all come from
  the Convex Auth session and `schoolMemberships`. Never send a role or a schoolId;
  the server ignores the client for both.
- **Errors.** Failures are `ConvexError<{ code, message, fields? }>`. Read them with
  `getAppError(e)` (`src/lib/convex/errors.ts`).

  | Code | Meaning |
  |---|---|
  | `UNAUTHENTICATED` | No session |
  | `NO_SCHOOL_ACCESS` | No active membership |
  | `PASSWORD_CHANGE_REQUIRED` | Temporary password still in use |
  | `FORBIDDEN` | Wrong role, or outside the caller's scope |
  | `NOT_FOUND` | Missing, or belongs to another school (indistinguishable on purpose) |
  | `INVALID_ARGUMENT` | Bad input; `fields` says which |
  | `INVALID_RELATIONSHIP` | The ids exist but don't belong together |
  | `CONFLICT` | State or uniqueness conflict |

- **Transactions.** Each mutation is one serializable transaction. All its writes,
  audit rows and in-app notifications commit together or not at all.
- **Dates.** Dates are `YYYY-MM-DD` and times are `HH:MM`. "Today" is computed in
  the school's timezone on the server.
- **Money.** Amounts are integer minor units (paise).
- **Notifications.** In-app only (`notifications` table). No SMS, email or push
  provider is configured. Triggers carry a `dedupeKey`, so a repeated trigger never
  notifies the same user twice.

## Fees — `convex/fees.ts`

**Owner: Apporva.**

| Function | Who | Notes |
|---|---|---|
| `listStructures({ academicYearId? })` | `fees:manage`, `reports:finance` | Includes `inUse`, `classNames`, `assignedCount` and `eligibleCount` (actively enrolled students of its classes) |
| `createStructure({ academicYearId?, name, classIds, components[], installments[], activate? })` | `fees:manage` | Installments must sum to the components; due dates inside the year; names unique per year; starts as `draft` unless `activate: true` |
| `updateStructure({ structureId, … })` | `fees:manage` | Amounts and installments are locked once assigned |
| `setStructureStatus({ structureId, status: "active" \| "archived" })` | `fees:manage` | Only `active` structures can be assigned |
| `assignStructure({ structureId, target })` | `fees:manage` | See below |
| `cancelAssignment({ studentId, structureId, reason })` | `fees:manage` | Only if nothing has been paid against it |
| `addConcession({ studentId, academicYearId?, studentFeeId?, kind, value, reason })` | `fees:manage` | `percent` is in basis points (1–10000); `fixed` is in minor units |
| `revokeConcession({ concessionId, reason })` | `fees:manage` | |
| `recordPayment({ studentId, academicYearId?, amountMinor, method, paidOn, reference?, note?, clientRequestId })` | `fees:manage` | See below |
| `reversePayment({ paymentId, reason })` | `fees:manage` | Append-only: writes a reversal row; the original stops counting |
| `studentLedger({ studentId, academicYearId? })` | `fees:manage`, or the student themself | Obligations with concession, paid, outstanding and `status` (paid / overdue / partial / due / upcoming); payments with receipt id, number and reference; concessions; totals incl. `netMinor`, `overdueMinor`, `dueSoonMinor`; `standing`, `nextDue`, `classLabel`, assigned `structures` and (fee managers) `availableStructures` |
| `receipt({ receiptId })` | Same as `studentLedger` | Payment, allocations, `reversed`, who recorded it, class, school address and the balance now |
| `collectionSummary({ from, to })` | `fees:manage`, `reports:finance` | At most 366 days; effective payments only; totals by method |
| `overview({ academicYearId? })` | `fees:manage`, `reports:finance` | Year totals (gross, concession, net, paid, outstanding, overdue, due in 30 days), collection rate, standing counts of enrolled students, monthly collections, 6 recent payments |
| `listBalances({ academicYearId?, classId?, sectionId?, standing?, search?, dueBy? })` | `fees:manage`, `reports:finance` | One row per actively enrolled student: net / paid / outstanding / overdue, `standing`, real `nextDue`, `lastPaymentOn` |
| `listPayments({ academicYearId?, from?, to?, classId?, method?, search?, limit? })` | `fees:manage`, `reports:finance` | Newest first with receipt number and id; reversed payments are flagged (`reversed`), not hidden; `{ rows, truncated }` (limit ≤ 500) |

- **One calculation everywhere:** `studentLedger`, `overview`, `listBalances`, `reports.feeSummary` and `reports.adminDashboard` all use `convex/model/feeMath.ts` (percent and fixed concessions, reversals). School-wide reads load the year's rows with three bounded index ranges (`convex/model/feeData.ts`, `by_school_year`), not a ledger query per student; above 20,000 rows per table they ask for a narrower filter.
- **Standing:** `not_assigned` (no fees), `paid`, `overdue`, `due_soon` (due within 30 days or part-paid), `clear`. "Today" is the school's local date.

- **`assignStructure` targets:**
  - `{ kind: "students", studentIds }` — an ineligible student is an error.
  - `{ kind: "section", sectionId }` or `{ kind: "class", classId }` — ineligible students are skipped.
  - Already-assigned students are skipped and returned in `skipped`.
  - At most 500 students per call.
- **`recordPayment`:**
  - Allocates to outstanding obligations **oldest due date first**.
  - Rejects amounts above the outstanding balance, future dates and non-integer amounts.
  - Writes the payment, its allocations and a sequential receipt number (`<CODE>/<YY-YY>/<NNNN>`, per school and year) in one transaction.
  - **Retry-safe:** `clientRequestId` must be a client-generated id (8–100 characters). Re-sending it returns the original payment with `duplicate: true`. Reusing it for a different payment is `CONFLICT`.
  - Returns `{ paymentId, receiptId, receiptNo, allocations, duplicate }`.
- The student portal keeps using `studentPortal.myFees`.

## Examinations — `convex/exams.ts`

**Owner: Trisha.**

| Function | Who | Notes |
|---|---|---|
| `list({ academicYearId? })` | `exams:manage` (all exams); teachers with `exams:read:assigned` (exams of classes they teach) | |
| `get({ examId })` | Same as `list` | Includes papers |
| `create({ academicYearId?, name, term?, classIds, startDate, endDate })` | `exams:manage` | Dates inside the year; name unique per year |
| `update({ examId, … })` | `exams:manage` | Not after publication |
| `setStatus({ examId, status: "scheduled" \| "in_progress" \| "marks_entry" })` | `exams:manage` | Forward only |
| `upsertPaper({ examId, classId, subjectId, date, startTime, endTime, maxMarks, passMarks })` | `exams:manage` | Subject must be in the class curriculum; date inside the exam; one paper per (exam, class, subject) — repeats update it |
| `removePaper({ examSubjectId })` | `exams:manage` | Only before marks exist |
| `marksSheet({ examSubjectId, sectionId })` | Mark enterers and `exams:manage` | Roster with marks; `canEnter` |
| `enterMarks({ examSubjectId, sectionId, entries[{ studentId, marks?, isAbsent }] })` | `marks:enter:any` (admin), or `marks:enter:assigned` with a **persisted subject assignment** for that section | Upsert per student |
| `publish({ examId })` | `exams:publish` | See below |
| `sectionResults({ examId, sectionId })` | `exams:manage`, or teachers for sections in their scope | Published exams only |

- **`enterMarks` rules:**
  - Open only while the exam is `in_progress` or `marks_entry`.
  - Marks run from 0 to the maximum in steps of 0.5.
  - "Absent" has no marks.
  - A student must be in the section, and a student cannot appear twice.
- **`publish`:**
  - Requires a mark row for every active student of every section × paper.
  - Writes `results` snapshots, locks the exam and notifies students once.
- **Calculation rules (documented decisions):**
  - An absent paper counts 0 and is failed.
  - `percentage` = total ÷ maximum × 100, rounded to 2 decimal places.
  - Grade follows the school's grading scheme.
  - A paper is passed when marks ≥ its passMarks.
  - Rank is per section by percentage, using standard competition ranking (ties share a rank: 1, 1, 3).
- Students read their published results with `studentPortal.myResults`.

## Timetable — `convex/timetable.ts`

**Owner: Trisha.**

| Function | Who | Notes |
|---|---|---|
| `listPeriods()` | Any member | The bell schedule |
| `upsertPeriod({ periodId?, index, label, startTime, endTime, isBreak })` | `timetable:manage` | Positions unique; periods may not overlap |
| `removePeriod({ periodId })` | `timetable:manage` | Only if unused |
| `setEntry({ sectionId, dayOfWeek, periodId, subjectId, teacherId, room? })` | `timetable:manage` | See below |
| `removeEntry({ entryId })` | `timetable:manage` | |
| `sectionTimetable({ sectionId })` | Admin: any section; teachers: sections in their scope | |
| `myTimetable()` | Teacher | Their own week |
| `canManage()` | Any member | UI helper only; the mutations check again |

- **`setEntry` validation:**
  - Working day only, and not a break.
  - Subject must be in the class curriculum.
  - The teacher must be assigned to that subject in that section.
- **`setEntry` clashes** (checked within the academic year): one lesson per section slot (an existing lesson is **replaced**), one place per teacher per slot, one section per room per slot (case-insensitive).
- Students use `studentPortal.myTimetable`.

## Homework — `convex/homework.ts`

**Owner: Trisha.**

| Function | Who | Notes |
|---|---|---|
| `create({ sectionId, subjectId, title, description, dueDate })` | Teacher with a persisted subject assignment for that section | Due date not in the past and inside the year; notifies the section's students once |
| `update({ homeworkId, title?, description?, dueDate? })` | The teacher who set it | While open |
| `close({ homeworkId })` | The teacher who set it | Idempotent |
| `listMine()` | Teacher | With submitted and reviewed counts |
| `listForSection({ sectionId })` | `homework:read:all`, or teachers for sections in their scope | |
| `submissions({ homeworkId })` | The teacher who set it, or `homework:read:all` | The whole roster with each submission |
| `review({ submissionId, feedback })` | The teacher who set it | Status becomes `reviewed`; notifies once |
| `submit({ homeworkId, content? })` | The **student** themself | See below |
| `get({ homeworkId, studentId? })` | Anyone who may read the item | Includes the caller's own or linked child's submission |

- **`submit` rules:**
  - Only for homework of the student's own active section, while it is open.
  - Only the student account can submit (there are no parent/guardian accounts).
  - The submission is stored as `late` after the due date.
  - The student can resubmit until it is reviewed.
- Students use `studentPortal.myHomework` for the list.

## Notices and events — `convex/notices.ts`, `convex/events.ts`

**Owner: Apporva.**

| Function | Who | Notes |
|---|---|---|
| `notices.createDraft({ title, body, type, priority, audience, publishDate, expiresOn?, eventDate? })` | `notices:manage` (any audience); a teacher (`sections` audience within their own scope only) | |
| `notices.update({ noticeId, … })` | Author or `notices:manage` | Drafts only |
| `notices.publish({ noticeId })` | Author or `notices:manage` | Idempotent; re-validates the audience; rejects an expired notice; notifies the audience once — now when `publishDate` ≤ today (school timezone), otherwise by a scheduled job on the publish date. Returns `{ notified, scheduled }` |
| `notices.archive({ noticeId })` | Author or `notices:manage` | |
| `notices.restore({ noticeId })` | Author or `notices:manage` | Archived only: always back to `draft`; it must be published again (`publish` re-validates audience and dates; a notice published before is not notified twice — same dedupe key) |
| `notices.listManaged({ status? })` | Managers see all; teachers see their own | Includes `authorName` and a readable `audienceLabel` |
| `notices.feed()` | Any member | Published, current notices addressed to the caller |
| `notices.get({ noticeId })` | Author or `notices:manage`, or the audience while published and current | Otherwise `NOT_FOUND` |
| `events.create({ title, description?, kind, startDate, endDate, audience })` | `notices:manage` | At most 60 days |
| `events.update({ eventId, … })` | `notices:manage` | |
| `events.remove({ eventId })` | `notices:manage` | |
| `events.list({ from, to })` | Any member | Events addressed to the caller; at most 400 days |

- `audience` is `{kind:"all"} | {kind:"roles", roles} | {kind:"classes", classIds} | {kind:"sections", sectionIds}`. Every class / section id is loaded inside the caller's school (another school's id is `NOT_FOUND`).
- **Lifecycle:** draft → published → archived → (restore) draft → (publish) published. Published notices are immutable. **Notices are never hard-deleted** (no retention rule allows it yet).
- A holiday must be school-wide. It cannot cover a date that already has an attendance register, because holidays make the day a non-school day for attendance.
- Students use `studentPortal.myNotices({ today })`.

## Staff attendance and leave — `convex/staff.ts`

| Function | Who | Notes |
|---|---|---|
| `staffAttendanceByDate({ date })` | `staff:manage` | Includes approved leave per teacher |
| `markStaffAttendance({ date, entries[{ teacherId, status, note? }] })` | `staff:manage` | Not in the future; upsert per teacher and day |
| `applyLeave({ type, fromDate, toDate, reason })` | Teacher, for themself | At most 90 days; no overlap with pending or approved leave |
| `withdrawLeave({ leaveRequestId })` | Own pending request | |
| `myLeave()` | Teacher | |
| `listLeave({ status? })` | `staff:manage` | |
| `decideLeave({ leaveRequestId, decision, note? })` | `staff:manage` | Pending only; never one's own request; notifies the teacher once |

## Reports — `convex/reports.ts`

**Owner: Apporva.**

| Function | Who | Returns |
|---|---|---|
| `enrollmentSummary()` | `reports:read` | Students by status, enrolment per section (each student once), active teachers |
| `attendanceSummary({ from, to })` | `reports:read`, `attendance:read:all` | At most 120 days; per-section registers, missing registers, totals and percentage (honours `lateCountsAsPresent`) |
| `feeSummary({ academicYearId? })` | `reports:finance`, `fees:manage` | Per class: gross, concession, paid, outstanding and overdue (from the same ledger as `studentLedger`) |
| `examPerformance({ examId })` | `reports:read` | Published exams only; averages and pass rates per subject and per section |
| `adminDashboard()` | `reports:read` and/or `reports:finance` / `fees:manage` | `{ school, academicYear, today, overview, fees }`. `overview` (students, sections, teachers, on leave today, attendance of today or the latest marked date with delta, 15-day trend, latest published exam by class, upcoming exams, 4 recent notices, unmarked registers today, pending leave) needs `reports:read`; `fees` (outstanding, overdue, overdue students, collected, net, rate, by class) needs finance access. A section the caller may not see is `null`, never zero. |
| `studentStatistics()` | `reports:read` | Current year: enrolled total, status counts, by class × gender, section strength vs capacity, distinct parent contacts (`parentContacts`) |
| `attendanceReport({ from?, to? })` | `reports:read`, `attendance:read:all` | Default: the current year up to today; at most 366 days; per month and per section from register totals (late counts per setting, excused excluded). No per-student bands. |

## Files — `convex/files.ts` and `src/lib/convex/use-file-upload.ts`

1. `generateUploadUrl()` is authorized for staff with an upload permission and for students (`homework:submit`).
2. POST the bytes to the URL; the response is `{ storageId }`.
3. `register({ storageId, kind, ownerType, ownerId, fileName })`:
   - re-checks permission and record ownership;
   - reads size and type from storage and accepts only PDF, PNG, JPEG or WebP up to 10 MB;
   - rejects a second registration of the same upload.
4. `homework_attachment` → `homework` (the teacher who set it, while open). `submission_attachment` → `submission` (the submitting student, before review). The file id is appended to the record in the same transaction; at most 5 per record.
5. `getUrl({ fileId })` re-checks read access on every call. `remove({ fileId })` also unlinks the file from its record.

In React: `const { upload } = useFileUpload(); await upload(file, { kind, ownerType, ownerId })`.

## Students — `convex/academics.ts` (additions)

| Function | Who | Notes |
|---|---|---|
| `updateStudentProfile({ studentId, firstName?, lastName?, gender?, dateOfBirth?, email?, phone?, address?, bloodGroup? })` | `students:write` | See below |

- Status, admission number, enrollment, parent contacts, accounts and roles cannot be edited here; the validator rejects them.
- A name change renumbers every section where the student is actively enrolled, in the same transaction, using the documented alphabetical rule.

## Academics administration — `convex/academics.ts` (additions)

| Function | Who | Notes |
|---|---|---|
| `setCurrentAcademicYear({ academicYearId })` | `academics:manage` | A closed year cannot be made current; a planned year becomes active; the previous year is not closed |
| `listTeachers()` | `academics:manage` | Active teachers for assignment pickers |
| `listUnenrolledStudents({ academicYearId? })` | `students:write` | Active students with no active enrollment in the year, roster order; at most 500 (`truncated`, `total`) |

Existing and now used by the admin screen: `setClassTeacher`, `assignSubjectTeacher`, `removeTeacherAssignment`, `listClassSubjects`, `setClassSubjects`, `enrollStudent`, `sectionRoster` (returned in roll-number order — render as-is).

## Notifications — `convex/notifications.ts` (addition)

| Function | Who | Notes |
|---|---|---|
| `remove({ notificationId })` | The notification's own recipient | Deletes that personal inbox copy only; another user's notification is `NOT_FOUND` |
| `clearAll({})` | Any member (own inbox) | Deletes the caller's own notifications in this school, 500 per call (`remaining: true` → call again); never touches other users (from PR #11) |

## Not provided (explicit)

- **Payment gateway.** Payments are recorded by staff.
- **Outbound notifications.** No SMS, email or push.
- **Report-card PDF generation.**
- **Promotion and year rollover.**
- **Payroll and HR beyond staff attendance and leave.**
