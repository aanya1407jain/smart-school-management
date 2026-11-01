/**
 * Smart School Management System — production schema.
 *
 * MULTI-TENANT RULES (read docs/BACKEND.md before adding a table):
 *  1. Every school-owned table has a `schoolId` field.
 *  2. Every index used to LIST school data starts with `schoolId` or with a
 *     parent id that is itself school-scoped (e.g. `sectionId`), and the
 *     function verifies that parent belongs to the caller's school first.
 *  3. Functions never trust a schoolId/role/userId from the client; they use
 *     `ctx.actor` from `schoolQuery` / `schoolMutation` (convex/core/functions.ts).
 *
 * Global (non-tenant) tables: `users` and Convex Auth's internal tables
 * (identity is global; access to a school is granted by `schoolMemberships`),
 * and `schools` itself.
 *
 * Conventions: dates are ISO "YYYY-MM-DD" strings, times are "HH:MM",
 * timestamps are epoch milliseconds, money is integer MINOR units (paise).
 */
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { vModuleKey } from "./core/modules";
import {
  vAcademicYearStatus, vAttendanceStatus, vAudience, vConcessionKind, vEnrollmentStatus, vEntityRef, vEventKind,
  vExamStatus, vFileKind, vFileOwnerType, vGender, vHomeworkStatus, vLeaveStatus, vLeaveType, vMembershipStatus, vNoticeStatus,
  vNoticeType, vNotificationType, vPaymentMethod, vPaymentStatus, vPermissionSet, vPersonStatus, vPriority, vRole, vSchoolStatus,
  vStaffAttendanceStatus, vStaffStatus, vSubmissionStatus, vAction, vPreviousSchool,
} from "./core/validators";

export default defineSchema({
  // Convex Auth internal tables (sessions, accounts, refresh tokens, …).
  ...authTables,

  // ============================================================ identity (global)
  /**
   * A person's login identity. Global — one person can belong to several
   * schools (e.g. a parent with children at two schools). Overrides Convex
   * Auth's default `users` table (same required fields + indexes) and adds
   * account-level flags. School-specific data lives in schoolMemberships.
   */
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** Platform-level kill switch; a disabled user cannot start a session. */
    disabled: v.optional(v.boolean()),
    /**
     * Canonical Login ID ("TCH-00124") — what the person types to sign in.
     * Also the Convex Auth account id of the "password" provider. Unique.
     */
    loginId: v.optional(v.string()),
    /** Set when an administrator issued a temporary password; cleared by account.changePassword. */
    mustChangePassword: v.optional(v.boolean()),
    /** Server time the current temporary password was issued (expiry: model/accounts.ts). */
    temporaryPasswordIssuedAt: v.optional(v.number()),
    /**
     * The current password is the school's student default (STUDENT_DEFAULT_PASSWORD).
     * It must still be changed at first sign-in, but it does not expire. Cleared
     * together with mustChangePassword.
     */
    defaultPassword: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_login_id", ["loginId"]),

  // ============================================================ tenancy
  schools: defineTable({
    name: v.string(),
    /** URL/subdomain-safe unique key, e.g. "aster-academy". */
    slug: v.string(),
    shortName: v.string(),
    /** Prefix for generated numbers (admission, employee, receipt), e.g. "AA". */
    code: v.string(),
    status: vSchoolStatus,
    timezone: v.string(), // IANA, e.g. "Asia/Kolkata"
    locale: v.string(), // BCP-47, e.g. "en-IN"
    currency: v.string(), // ISO 4217, e.g. "INR"
    tagline: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    affiliation: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
  }).index("by_slug", ["slug"]),

  /** One row per school. Kept separate so settings can change without touching identity. */
  schoolSettings: defineTable({
    schoolId: v.id("schools"),
    currentAcademicYearId: v.optional(v.id("academicYears")),
    /** ISO weekday numbers (0 = Sunday) on which school is in session. */
    workingDays: v.array(v.number()),
    /**
     * When set, students get scholar numbers automatically: this prefix + a
     * 4-digit running number (e.g. "0246CBSE" → 0246CBSE0001). Set by the
     * operator (internal scholarNumberMaintenance.configure). Absent = numbers
     * are only entered by hand.
     */
    scholarNumberPrefix: v.optional(v.string()),
    attendance: v.object({
      lateCountsAsPresent: v.boolean(),
      lowAttendanceThreshold: v.number(), // percent
    }),
    grading: v.object({
      scheme: v.string(), // e.g. "cbse_8_point"; resolved by the exams module
      passPercentage: v.number(),
    }),
    notifications: v.object({
      attendanceAlerts: v.boolean(),
      feeReminders: v.boolean(),
      homeworkAlerts: v.boolean(),
      examAlerts: v.boolean(),
      noticeAlerts: v.boolean(),
    }),
  }).index("by_school", ["schoolId"]),

  /**
   * Module entitlements: which configurable modules (convex/core/modules.ts)
   * a school may use. One row per (school, module), written only by the
   * deployment operator (internal schoolModules.setSchoolModules). A school
   * with NO rows is unconfigured and keeps the original modules; a configured
   * school has a module only if its row says enabled (convex/model/modules.ts).
   * Disabling never deletes the module's data.
   */
  schoolModules: defineTable({
    schoolId: v.id("schools"),
    module: vModuleKey,
    enabled: v.boolean(),
    /** When this row last changed (ms). `_creationTime` is when it was created. */
    updatedAt: v.number(),
    /** Who changed it: the operator's name or reference as given to the internal mutation. */
    updatedBy: v.string(),
    /** Why (e.g. the subscription or ticket reference). */
    reason: v.string(),
  }).index("by_school", ["schoolId"])
    .index("by_school_module", ["schoolId", "module"]),

  /**
   * A user's access to ONE school. This is the only thing that grants access.
   * role = portal (admin | teacher | student) — the ONLY three account roles.
   * Links:
   *  - teacher role → teacherId (required)
   *  - student role → studentId (required): the student's own account
   *  - admin role   → optionally teacherId if the principal also teaches.
   * There are no parent/guardian accounts. Parent contact details are plain
   * records on the student (`guardians` + `guardianLinks` tables below).
   * Accounts are created by the school, never self-registered: an admin (or
   * the deployment setup / import) creates the membership with status
   * "invited" and a reserved `loginId`; creating the Convex Auth account for
   * that Login ID activates it (see convex/model/accounts.ts).
   */
  schoolMemberships: defineTable({
    schoolId: v.id("schools"),
    userId: v.optional(v.id("users")),
    /** Optional contact email (never used to sign in). */
    email: v.optional(v.string()),
    /** Canonical Login ID reserved for this membership's account. */
    loginId: v.optional(v.string()),
    displayName: v.string(),
    role: vRole,
    status: vMembershipStatus,
    permissionSets: v.array(vPermissionSet),
    teacherId: v.optional(v.id("teachers")),
    studentId: v.optional(v.id("students")),
    /**
     * Per-member module × action grants set by the Principal (core/grants.ts,
     * memberships.setPermissions). On an ADMIN membership, present (even
     * empty) = a restricted office login with exactly these grants; absent =
     * full administrator. On a TEACHER membership: extra duties on top of
     * teaching. Never on students.
     */
    grants: v.optional(v.array(v.object({ module: vModuleKey, actions: v.array(vAction) }))),
    /** Label for the member's access, e.g. "Accountant" (display only; never used for authorization). */
    accessProfile: v.optional(v.string()),
    /** Teachers only: extra sections their Students/Attendance VIEW grants cover (instead of school-wide). */
    sectionScope: v.optional(v.array(v.id("sections"))),
    /**
     * LEGACY — set only on memberships of the removed guardian sign-in. Never
     * written any more and never accepted for access (core/actor.ts). Kept
     * optional so not-yet-migrated deployments still validate; the one-off
     * internal migration `migrations:removeGuardianAccounts` deletes those
     * memberships. Remove this field and `by_guardian` after every deployment
     * has run it.
     */
    guardianId: v.optional(v.id("guardians")),
    /** Administrator who created the account (absent for setup/seed). */
    createdByUserId: v.optional(v.id("users")),
    /**
     * DEPRECATED — invitation-code fields of the previous auth design. Kept
     * optional ONLY so deployments seeded before the Login ID migration still
     * pass schema validation; nothing reads them and seed:upgradeDemoLoginIds
     * clears them. Remove once no deployment has them.
     */
    inviteCodeHash: v.optional(v.string()),
    inviteExpiresAt: v.optional(v.number()),
    invitedByUserId: v.optional(v.id("users")),
    activatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_login_id", ["loginId"])
    .index("by_school_email", ["schoolId", "email"])
    .index("by_school_role", ["schoolId", "role"])
    .index("by_teacher", ["teacherId"])
    .index("by_student", ["studentId"])
    .index("by_guardian", ["guardianId"]),

  // ============================================================ academic structure
  academicYears: defineTable({
    schoolId: v.id("schools"),
    name: v.string(), // "2026-27"
    startDate: v.string(),
    endDate: v.string(),
    status: vAcademicYearStatus,
  }).index("by_school_start", ["schoolId", "startDate"]),

  /** A grade level ("Grade 8"). Year-independent; sections are per year. */
  classes: defineTable({
    schoolId: v.id("schools"),
    name: v.string(),
    /** Numeric level used for ordering/promotion (8 for Grade 8). */
    level: v.number(),
    active: v.boolean(),
  }).index("by_school_level", ["schoolId", "level"]),

  /**
   * A section of a class in ONE academic year ("8-A" in 2026-27).
   * classTeacherId is the attendance OWNER of this section.
   */
  sections: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    classId: v.id("classes"),
    name: v.string(), // "A"
    displayName: v.string(), // "8-A"
    classTeacherId: v.optional(v.id("teachers")),
    room: v.optional(v.string()),
    capacity: v.optional(v.number()),
  })
    .index("by_school_year", ["schoolId", "academicYearId"])
    .index("by_class_year", ["classId", "academicYearId"])
    .index("by_class_teacher_year", ["classTeacherId", "academicYearId"]),

  subjects: defineTable({
    schoolId: v.id("schools"),
    name: v.string(),
    code: v.string(),
    active: v.boolean(),
  }).index("by_school_code", ["schoolId", "code"]),

  /**
   * CURRICULUM: which subjects a class studies in an academic year.
   *   classSubjects       = what is taught to the class (curriculum)
   *   teacherAssignments  = who teaches a curriculum subject to one section
   *   sections.classTeacherId = who owns the section (ATTENDANCE OWNER)
   * A subject assignment must be for a subject in the class's curriculum.
   */
  classSubjects: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
  })
    .index("by_class_year_subject", ["classId", "academicYearId", "subjectId"])
    .index("by_school_year", ["schoolId", "academicYearId"]),

  // ============================================================ people
  teachers: defineTable({
    schoolId: v.id("schools"),
    employeeId: v.string(),
    title: v.optional(v.string()),
    firstName: v.string(),
    lastName: v.string(),
    gender: v.optional(vGender),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    designation: v.optional(v.string()),
    qualification: v.optional(v.string()),
    // Academics subject ids (plain ids: Core must not reference a module table in the schema).
    specializationSubjectIds: v.array(v.string()),
    joiningDate: v.optional(v.string()),
    status: vStaffStatus,
    address: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
  })
    .index("by_school_employee", ["schoolId", "employeeId"])
    .index("by_school_status", ["schoolId", "status"]),

  /** One row per teacher per date (present / absent / on_leave). Marked by staff managers. */
  staffAttendance: defineTable({
    schoolId: v.id("schools"),
    teacherId: v.id("teachers"),
    date: v.string(),
    status: vStaffAttendanceStatus,
    leaveRequestId: v.optional(v.id("leaveRequests")),
    markedByUserId: v.id("users"),
    note: v.optional(v.string()),
  })
    .index("by_school_date", ["schoolId", "date"])
    .index("by_teacher_date", ["teacherId", "date"]),

  /** A teacher's leave application. Applied-at time is `_creationTime`. */
  leaveRequests: defineTable({
    schoolId: v.id("schools"),
    teacherId: v.id("teachers"),
    type: vLeaveType,
    fromDate: v.string(),
    toDate: v.string(),
    reason: v.string(),
    status: vLeaveStatus,
    requestedByUserId: v.id("users"),
    decidedByUserId: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
  })
    .index("by_school_status_from", ["schoolId", "status", "fromDate"])
    .index("by_teacher_from", ["teacherId", "fromDate"]),

  students: defineTable({
    schoolId: v.id("schools"),
    admissionNo: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    /** Normalized lowercase last name for case-insensitive duplicate matching (BUG-005). */
    lastNameKey: v.optional(v.string()),
    gender: v.optional(vGender),
    dateOfBirth: v.optional(v.string()),
    admissionDate: v.optional(v.string()),
    status: vPersonStatus,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    bloodGroup: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    /**
     * The school's own register number ("scholar number"), entered by the
     * office. Optional; UNIQUE per school (checked in every mutation that sets
     * it — model/scholarNumbers.ts). `scholarNoKey` is the normalised form the
     * uniqueness check and lookups use (upper case, no spaces).
     */
    scholarNo: v.optional(v.string()),
    scholarNoKey: v.optional(v.string()),
    /** Admitted from another school: previous school and its incoming transfer certificate. */
    previousSchool: v.optional(vPreviousSchool),
  })
    .index("by_school_admission", ["schoolId", "admissionNo"])
    .index("by_school_status_name", ["schoolId", "status", "lastName"])
    .index("by_school_scholar", ["schoolId", "scholarNoKey"])
    .index("by_school_lastNameKey_dob", ["schoolId", "lastNameKey", "dateOfBirth"]),

  /**
   * Admission register (CSR / scholar register) — SCHOOL-DEFINED extra columns.
   * The standard columns (admission/scholar no., name, dates, parent, class
   * admitted to, leaving/TC) are derived from students, enrollments, parent
   * contacts and transfer certificates (convex/admissionRegister.ts); only the
   * columns a school adds live here, so the register can follow each school's
   * format without schema changes. Fields are deactivated, never deleted, and a
   * field's `type` is fixed once created (values stay valid).
   */
  admissionRegisterFields: defineTable({
    schoolId: v.id("schools"),
    /** Stable identifier used as the key in `admissionRegisterValues.values` (a-z, 0-9, _). */
    key: v.string(),
    label: v.string(),
    type: v.union(v.literal("text"), v.literal("number"), v.literal("date"), v.literal("select"), v.literal("boolean")),
    /** Choices for `select`. */
    options: v.optional(v.array(v.string())),
    required: v.boolean(),
    order: v.number(),
    active: v.boolean(),
    updatedAt: v.number(),
    updatedByUserId: v.id("users"),
  }).index("by_school_key", ["schoolId", "key"]),

  /** One row per student holding the values of the school-defined register columns. */
  admissionRegisterValues: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    values: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    updatedAt: v.number(),
    updatedByUserId: v.id("users"),
  }).index("by_school_student", ["schoolId", "studentId"]),

  /**
   * Transfer certificates (TC) issued when a student leaves the school
   * (convex/studentLifecycle.ts). Historical record: never deleted; a
   * cancelled TC keeps its row and number. `snapshot` freezes what the
   * certificate states (name, numbers, class, dates) at issue time.
   */
  transferCertificates: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    /** "" while a draft has no number yet (the next number is allocated when it is issued). */
    tcNo: v.string(),
    /** draft: saved form, student untouched · issued: student has left · cancelled: kept with its number. */
    status: v.union(v.literal("draft"), v.literal("issued"), v.literal("cancelled")),
    issueDate: v.string(),
    applicationDate: v.optional(v.string()),
    leavingDate: v.string(),
    reason: v.string(),
    conduct: v.optional(v.string()),
    destinationSchool: v.optional(v.string()),
    remarks: v.optional(v.string()),
    /** Student status before the TC (restored if the TC is cancelled). */
    previousStatus: vPersonStatus,
    /** The enrollment the TC ended (null if the student had none in the current year). */
    endedEnrollmentId: v.optional(v.id("enrollments")),
    snapshot: v.object({
      studentName: v.string(),
      admissionNo: v.string(),
      scholarNo: v.optional(v.string()),
      dateOfBirth: v.optional(v.string()),
      admissionDate: v.optional(v.string()),
      lastClass: v.optional(v.string()),
      lastSection: v.optional(v.string()),
      academicYear: v.optional(v.string()),
      parentName: v.optional(v.string()),
      fatherName: v.optional(v.string()),
      motherName: v.optional(v.string()),
      workingDays: v.optional(v.number()),
      attendedDays: v.optional(v.number()),
    }),
    /** Fee balance at issue and the authorised waiver that allowed a provisional issue with dues. */
    duesWaiver: v.optional(v.object({ outstandingMinor: v.number(), note: v.string(), byUserId: v.id("users") })),
    /** Random code printed on the certificate (and in its QR) for public verification. */
    verificationCode: v.optional(v.string()),
    /** Creator of a draft / issuer of the certificate. */
    issuedByUserId: v.id("users"),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    cancelledByUserId: v.optional(v.id("users")),
  })
    .index("by_school_student", ["schoolId", "studentId"])
    .index("by_school_number", ["schoolId", "tcNo"])
    .index("by_verification", ["verificationCode"]),

  /**
   * One batch promotion (Promotions & TC → Promote): which enrollment each
   * student left and which one was created, so the run can be shown in the
   * audit log and rolled back while nothing in the new year depends on it.
   */
  promotionRuns: defineTable({
    schoolId: v.id("schools"),
    fromSectionId: v.id("sections"),
    fromYearId: v.id("academicYears"),
    toYearId: v.id("academicYears"),
    moves: v.array(v.object({
      studentId: v.id("students"),
      oldEnrollmentId: v.id("enrollments"),
      newEnrollmentId: v.id("enrollments"),
      toSectionId: v.id("sections"),
      kind: v.union(v.literal("promote"), v.literal("repeat")),
    })),
    status: v.union(v.literal("applied"), v.literal("rolled_back")),
    createdAt: v.number(),
    createdByUserId: v.id("users"),
    rolledBackAt: v.optional(v.number()),
    rolledBackByUserId: v.optional(v.id("users")),
  }).index("by_school_section", ["schoolId", "fromSectionId"]),

  /**
   * Parent contacts of students (name, phone, email…). CONTACT DATA ONLY — a
   * parent contact never has an account or any access. (Storage name kept from
   * the original design; shown in the product as "Parent contact".)
   */
  guardians: defineTable({
    schoolId: v.id("schools"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    occupation: v.optional(v.string()),
    address: v.optional(v.string()),
  }).index("by_school_phone", ["schoolId", "phone"]),

  /** Parent contact ↔ student (many-to-many). Contact data only; grants no access. */
  guardianLinks: defineTable({
    schoolId: v.id("schools"),
    guardianId: v.id("guardians"),
    studentId: v.id("students"),
    relationship: v.string(), // "Mother", "Father", "Grandparent", …
    isPrimary: v.boolean(),
  })
    .index("by_guardian", ["guardianId"])
    .index("by_student", ["studentId"]),

  /**
   * Academic placement per year. History is preserved: promotion creates a new
   * enrollment for the next year and closes the old one; never overwrite.
   */
  enrollments: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    classId: v.id("classes"),
    sectionId: v.id("sections"),
    rollNo: v.optional(v.number()),
    status: vEnrollmentStatus,
    startDate: v.string(),
    endDate: v.optional(v.string()),
  })
    .index("by_student_year", ["studentId", "academicYearId"])
    .index("by_section_status", ["sectionId", "status"])
    .index("by_school_year", ["schoolId", "academicYearId"]),

  /**
   * Every roll-number assignment or change (append-only). The current number
   * lives on the enrollment; this keeps the numbers a student HAD during the
   * year when the roster was renumbered (admissions, transfers, withdrawals,
   * name corrections, operator reconciliation). See model/rollNumbers.ts.
   */
  rollNumberHistory: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    sectionId: v.id("sections"),
    enrollmentId: v.id("enrollments"),
    studentId: v.id("students"),
    /** Absent for the first number the enrollment received. */
    fromRollNo: v.optional(v.number()),
    toRollNo: v.number(),
    changedAt: v.number(),
    /** The signed-in member whose action renumbered the roster; absent for operator tools. */
    changedByUserId: v.optional(v.id("users")),
    reason: v.union(v.literal("roster_change"), v.literal("reconciliation")),
  })
    .index("by_school_student", ["schoolId", "studentId"])
    .index("by_enrollment", ["enrollmentId"]),

  /**
   * Who teaches what to whom. SUBJECT ASSIGNMENT != ATTENDANCE OWNERSHIP:
   * attendance ownership is `sections.classTeacherId` only.
   */
  teacherAssignments: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    teacherId: v.id("teachers"),
    subjectId: v.id("subjects"),
    classId: v.id("classes"),
    sectionId: v.id("sections"),
    periodsPerWeek: v.optional(v.number()),
  })
    .index("by_teacher_year", ["teacherId", "academicYearId"])
    .index("by_section_subject", ["sectionId", "subjectId"]),

  // ============================================================ attendance
  /** One register per section per school day. */
  attendanceSessions: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    sectionId: v.id("sections"),
    date: v.string(),
    markedByUserId: v.id("users"),
    markedByTeacherId: v.id("teachers"),
    markedAt: v.number(),
    lastEditedByUserId: v.optional(v.id("users")),
    lastEditedAt: v.optional(v.number()),
    presentCount: v.number(),
    absentCount: v.number(),
    lateCount: v.number(),
    excusedCount: v.number(),
  })
    .index("by_section_date", ["sectionId", "date"])
    .index("by_school_date", ["schoolId", "date"]),

  /** One row per student per register. */
  attendanceRecords: defineTable({
    schoolId: v.id("schools"),
    sessionId: v.id("attendanceSessions"),
    sectionId: v.id("sections"),
    studentId: v.id("students"),
    date: v.string(),
    status: vAttendanceStatus,
    remark: v.optional(v.string()),
  })
    .index("by_session_student", ["sessionId", "studentId"])
    .index("by_student_date", ["studentId", "date"]),

  // ============================================================ fees
  feeStructures: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    name: v.string(),
    classIds: v.array(v.id("classes")),
    components: v.array(v.object({ label: v.string(), amountMinor: v.number() })),
    installments: v.array(v.object({ label: v.string(), dueDate: v.string(), amountMinor: v.number() })),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
  }).index("by_school_year", ["schoolId", "academicYearId"]),

  /** A single obligation (one installment of one structure for one student). Immutable amount; corrections via concessions. */
  studentFees: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    feeStructureId: v.id("feeStructures"),
    label: v.string(),
    amountMinor: v.number(),
    dueDate: v.string(),
    status: v.union(v.literal("active"), v.literal("cancelled")),
  })
    .index("by_student_year", ["studentId", "academicYearId"])
    .index("by_school_due", ["schoolId", "dueDate"])
    .index("by_structure", ["feeStructureId"])
    .index("by_school_year", ["schoolId", "academicYearId"]),

  feeConcessions: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    /** Applies to one obligation, or to all of the student's obligations in the year when absent. */
    studentFeeId: v.optional(v.id("studentFees")),
    kind: vConcessionKind,
    /** percent: basis points (1000 = 10%); fixed: minor units. */
    value: v.number(),
    reason: v.string(),
    approvedByUserId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("revoked")),
  })
    .index("by_student_year", ["studentId", "academicYearId"])
    .index("by_school_year", ["schoolId", "academicYearId"]),

  /** Append-only payment transactions. A reversal is a new row pointing at the original. */
  feePayments: defineTable({
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    amountMinor: v.number(),
    method: vPaymentMethod,
    reference: v.optional(v.string()),
    paidOn: v.string(),
    status: vPaymentStatus,
    reversalOfPaymentId: v.optional(v.id("feePayments")),
    allocations: v.array(v.object({ studentFeeId: v.id("studentFees"), amountMinor: v.number() })),
    recordedByUserId: v.id("users"),
    note: v.optional(v.string()),
    /**
     * Client-generated id of the "record payment" request (fees.recordPayment).
     * A retried request with the same id returns the original payment instead
     * of charging twice. Absent on rows written before it existed.
     */
    clientRequestId: v.optional(v.string()),
  })
    .index("by_student_paid", ["studentId", "paidOn"])
    .index("by_school_paid", ["schoolId", "paidOn"])
    .index("by_school_request", ["schoolId", "clientRequestId"])
    .index("by_school_year", ["schoolId", "academicYearId"]),

  receipts: defineTable({
    schoolId: v.id("schools"),
    paymentId: v.id("feePayments"),
    studentId: v.id("students"),
    receiptNo: v.string(),
    issuedAt: v.number(),
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_school_number", ["schoolId", "receiptNo"])
    .index("by_payment", ["paymentId"])
    .index("by_student", ["studentId"]),

  // ============================================================ examinations
  exams: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    name: v.string(),
    term: v.optional(v.string()),
    classIds: v.array(v.id("classes")),
    startDate: v.string(),
    endDate: v.string(),
    status: vExamStatus,
    publishedAt: v.optional(v.number()),
    publishedByUserId: v.optional(v.id("users")),
  }).index("by_school_year", ["schoolId", "academicYearId"]),

  /** One paper: exam × class × subject, with its schedule and marking scheme. */
  examSubjects: defineTable({
    schoolId: v.id("schools"),
    examId: v.id("exams"),
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    date: v.string(),
    startTime: v.string(),
    endTime: v.string(),
    maxMarks: v.number(),
    passMarks: v.number(),
  }).index("by_exam_class", ["examId", "classId"]),

  marks: defineTable({
    schoolId: v.id("schools"),
    examId: v.id("exams"),
    examSubjectId: v.id("examSubjects"),
    studentId: v.id("students"),
    sectionId: v.id("sections"),
    marks: v.optional(v.number()),
    isAbsent: v.boolean(),
    enteredByUserId: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_paper_section", ["examSubjectId", "sectionId"])
    .index("by_paper_student", ["examSubjectId", "studentId"])
    .index("by_student_exam", ["studentId", "examId"]),

  /** Computed per student per exam when results are published (a snapshot, not a mutable "current result"). */
  results: defineTable({
    schoolId: v.id("schools"),
    examId: v.id("exams"),
    studentId: v.id("students"),
    sectionId: v.id("sections"),
    totalMarks: v.number(),
    maxMarks: v.number(),
    percentage: v.number(),
    grade: v.optional(v.string()),
    rank: v.optional(v.number()),
    subjects: v.array(v.object({
      examSubjectId: v.id("examSubjects"),
      subjectId: v.id("subjects"),
      marks: v.optional(v.number()),
      isAbsent: v.boolean(),
      maxMarks: v.number(),
      grade: v.optional(v.string()),
      passed: v.boolean(),
    })),
    publishedAt: v.number(),
  })
    .index("by_student_exam", ["studentId", "examId"])
    .index("by_exam_section", ["examId", "sectionId"]),

  // ============================================================ timetable
  /**
   * The school's bell schedule (periods and breaks). Timetable entries point at
   * a period, so changing a period's times updates every timetable that uses it.
   */
  periods: defineTable({
    schoolId: v.id("schools"),
    /** Display/order position within the school day (1, 2, 3 …), unique per school. */
    index: v.number(),
    label: v.string(), // "Period 1", "Lunch"
    startTime: v.string(), // HH:MM
    endTime: v.string(), // HH:MM
    isBreak: v.boolean(),
  }).index("by_school_index", ["schoolId", "index"]),

  /**
   * One lesson slot: section × weekday × period → subject + teacher.
   * Uniqueness (one lesson per section per slot; one section per teacher per
   * slot) is checked by the timetable mutations using the two slot indexes.
   */
  timetableEntries: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    sectionId: v.id("sections"),
    dayOfWeek: v.number(), // 0 = Sunday … 6 = Saturday
    periodId: v.id("periods"),
    subjectId: v.id("subjects"),
    teacherId: v.id("teachers"),
    room: v.optional(v.string()),
  })
    .index("by_section_day_period", ["sectionId", "dayOfWeek", "periodId"])
    .index("by_teacher_day_period", ["teacherId", "dayOfWeek", "periodId"])
    .index("by_school_day_period", ["schoolId", "dayOfWeek", "periodId"]),

  // ============================================================ homework
  homework: defineTable({
    schoolId: v.id("schools"),
    academicYearId: v.id("academicYears"),
    sectionId: v.id("sections"),
    subjectId: v.id("subjects"),
    teacherId: v.id("teachers"),
    title: v.string(),
    description: v.string(),
    assignedOn: v.string(),
    dueDate: v.string(),
    status: vHomeworkStatus,
    attachmentFileIds: v.array(v.id("files")),
  })
    .index("by_section_due", ["sectionId", "dueDate"])
    .index("by_teacher_due", ["teacherId", "dueDate"]),

  homeworkSubmissions: defineTable({
    schoolId: v.id("schools"),
    homeworkId: v.id("homework"),
    studentId: v.id("students"),
    submittedAt: v.number(),
    content: v.optional(v.string()),
    attachmentFileIds: v.array(v.id("files")),
    status: vSubmissionStatus,
    feedback: v.optional(v.string()),
    reviewedByUserId: v.optional(v.id("users")),
  })
    .index("by_homework_student", ["homeworkId", "studentId"])
    .index("by_student", ["studentId"]),

  // ============================================================ communication
  notices: defineTable({
    schoolId: v.id("schools"),
    title: v.string(),
    body: v.string(),
    type: vNoticeType,
    priority: vPriority,
    audience: vAudience,
    status: vNoticeStatus,
    publishDate: v.string(),
    expiresOn: v.optional(v.string()),
    eventDate: v.optional(v.string()),
    /** Last day of a multi-day event or holiday (`eventDate` is the first day). */
    endDate: v.optional(v.string()),
    createdByUserId: v.id("users"),
    /** Set when the notice is first published (ms). Lets an archived notice be restored to the state it had. */
    publishedAt: v.optional(v.number()),
  }).index("by_school_status_publish", ["schoolId", "status", "publishDate"]),

  events: defineTable({
    schoolId: v.id("schools"),
    title: v.string(),
    description: v.optional(v.string()),
    kind: vEventKind,
    startDate: v.string(),
    endDate: v.string(),
    audience: vAudience,
    createdByUserId: v.id("users"),
  }).index("by_school_start", ["schoolId", "startDate"]),

  notifications: defineTable({
    schoolId: v.id("schools"),
    userId: v.id("users"),
    type: vNotificationType,
    title: v.string(),
    message: v.string(),
    isRead: v.boolean(),
    readAt: v.optional(v.number()),
    href: v.optional(v.string()),
    entity: v.optional(vEntityRef),
    /**
     * Identifies the event that caused the notification (e.g.
     * "homework.created:<id>"). notifyUsers never writes a second
     * notification with the same key for the same user, so a repeated trigger
     * cannot notify twice. Absent on older rows.
     */
    dedupeKey: v.optional(v.string()),
  })
    .index("by_user_school", ["userId", "schoolId"])
    .index("by_user_school_read", ["userId", "schoolId", "isRead"])
    .index("by_user_dedupe", ["userId", "dedupeKey"]),

  // ============================================================ platform
  /**
   * Per-school sequence counters for human-readable document numbers
   * (admission numbers, employee ids, receipt numbers). Only ever read and
   * incremented inside a mutation via `allocateNumber` (convex/model/counters.ts);
   * Convex's serializable transactions make each allocation unique.
   * Keys: "admission:<YYYY>", "employee", "receipt:<academicYearId>".
   */
  counters: defineTable({
    schoolId: v.id("schools"),
    key: v.string(),
    value: v.number(), // last number handed out
  }).index("by_school_key", ["schoolId", "key"]),

  /**
   * A bulk student-account run (Admin → Accounts & Import). The scope is
   * snapshotted into bulkAccountJobItems before anything is created, so a
   * changing student list can never widen what the administrator confirmed.
   * Counters are updated in the same transactions as the items they count.
   * Temporary passwords are NEVER stored: each batch returns them once to
   * the initiating administrator (see convex/bulkAccounts.ts).
   */
  bulkAccountJobs: defineTable({
    schoolId: v.id("schools"),
    createdByUserId: v.id("users"),
    createdByMembershipId: v.id("schoolMemberships"),
    /** How the scope was chosen (for display only — the items ARE the scope). */
    scope: v.union(
      v.object({ type: v.literal("selected") }),
      v.object({ type: v.literal("all"), sectionId: v.optional(v.id("sections")) }),
    ),
    status: v.union(v.literal("preparing"), v.literal("ready"), v.literal("running"), v.literal("completed"), v.literal("cancelled")),
    /** Pagination cursor while snapshotting an "all matching" scope. */
    prepareCursor: v.optional(v.string()),
    total: v.number(),
    queued: v.number(),
    processing: v.number(),
    created: v.number(),
    skipped: v.number(),
    failed: v.number(),
    cancelled: v.number(),
    /** Created accounts whose temporary password was confirmed received by the initiator. */
    delivered: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  }).index("by_school_creator", ["schoolId", "createdByUserId"]),

  bulkAccountJobItems: defineTable({
    schoolId: v.id("schools"),
    jobId: v.id("bulkAccountJobs"),
    studentId: v.id("students"),
    status: v.union(v.literal("queued"), v.literal("processing"), v.literal("created"), v.literal("skipped"), v.literal("failed"), v.literal("cancelled")),
    /** Non-sensitive reason for skipped / failed items. */
    reason: v.optional(v.string()),
    /** Membership reserved/used for this student by this job (for idempotent retries). */
    membershipId: v.optional(v.id("schoolMemberships")),
    loginId: v.optional(v.string()),
    attempts: v.number(),
    claimedAt: v.optional(v.number()),
    delivered: v.boolean(),
  })
    .index("by_job_status", ["jobId", "status"])
    .index("by_job_student", ["jobId", "studentId"]),

  /** Append-only trail of important actions. Written via convex/audit/log.ts. */
  auditLogs: defineTable({
    schoolId: v.id("schools"),
    /** WHO performed the operation; absent for system jobs (seed, migrations). */
    actorUserId: v.optional(v.id("users")),
    /** The ACTOR's role in this school when they acted — never the affected account's role (see metadata.targetRole). */
    actorRole: v.optional(vRole),
    action: v.string(), // "<entity>.<verb>", e.g. "attendance.corrected"
    entity: vEntityRef,
    summary: v.string(),
    metadata: v.optional(v.any()),
  })
    .index("by_school", ["schoolId"])
    .index("by_school_entity", ["schoolId", "entity.table", "entity.id"])
    .index("by_school_action", ["schoolId", "action"]),

  /** Metadata for every stored file; the blob lives in Convex storage. */
  files: defineTable({
    schoolId: v.id("schools"),
    storageId: v.id("_storage"),
    kind: vFileKind,
    ownerType: vFileOwnerType,
    ownerId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    uploadedByUserId: v.id("users"),
  })
    .index("by_owner", ["schoolId", "ownerType", "ownerId"])
    .index("by_storage", ["storageId"]),
});