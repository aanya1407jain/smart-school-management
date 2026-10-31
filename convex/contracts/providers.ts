/**
 * Cross-module provider contracts (docs/modularization/02-step1-contracts-and-registries.md §4).
 *
 * Every cross-module dependency found by the audit is a READ. Instead of one
 * module querying another's tables, the owning module implements a provider
 * and a consumer asks the registry for it (convex/core/registry.ts). Providers
 * run inside the caller's Convex transaction (plain function call with the
 * caller's ctx), so reads stay consistent and authorization stays with the
 * caller.
 *
 * Contract rules:
 *  - No import from any module and no generated data model: ids are
 *    `GenericId<"table">` and the ctx is structural, so these types compile in
 *    every export whatever tables it contains.
 *  - Methods (not function-valued properties), so an implementation can take
 *    the app's concrete `QueryCtx` / documents.
 *  - A consumer always receives `Provided<T>` and must handle
 *    `installed: false` explicitly — absence is never treated as zero/empty.
 *  - Providers never authorize on their own unless stated (file owners do):
 *    callers check access first, as they did before the split.
 */
import type { GenericId } from "convex/values";

/** The caller's Convex ctx (structural: any app QueryCtx / MutationCtx fits). */
export type Ctx = { readonly db: object };

type SchoolId = GenericId<"schools">;
type YearRef = { _id: GenericId<"academicYears">; name: string; startDate: string; endDate: string };
type SectionRef = { _id: GenericId<"sections">; schoolId: SchoolId; academicYearId: GenericId<"academicYears">; displayName: string };
type StudentRef = { _id: GenericId<"students">; schoolId: SchoolId };
type StudentId = GenericId<"students">;
type TeacherId = GenericId<"teachers">;

/** Result of asking for an optional provider. */
export type Provided<T> = { installed: true; provider: T } | { installed: false; reason: string };

// ================================================================ Students
export interface StudentRosterProvider {
  /** Active students of a section in roll-number order (display data only). */
  activeRoster(ctx: Ctx, sectionId: GenericId<"sections">): Promise<{ studentId: StudentId; name: string; rollNo: number | null }[]>;
  /** Distinct students enrolled in the year (admin dashboard). */
  enrolledCount(ctx: Ctx, schoolId: SchoolId, yearId: GenericId<"academicYears">): Promise<number>;
  /** Enrolled vs active student records for the year (Academics setup cockpit). */
  enrollmentHealth(ctx: Ctx, schoolId: SchoolId, yearId: GenericId<"academicYears">): Promise<{ enrolled: number; activeRecords: number; notEnrolled: number }>;
}

// ================================================================ Attendance
export type AttendanceDay = { date: string; status: "present" | "absent" | "late" | "excused"; remark: string | null };
export interface StudentAttendanceProvider {
  /** Day-by-day records of the academic year. */
  recordsInYear(ctx: Ctx, studentId: StudentId, year: YearRef): Promise<AttendanceDay[]>;
  /** Registers the student was on, and days attended (present, and late when the school counts it). */
  totals(ctx: Ctx, studentId: StudentId, year: Pick<YearRef, "startDate" | "endDate">, upTo: string, lateCounts: boolean): Promise<{ workingDays: number; attendedDays: number }>;
  /** Is anything recorded for the student in [from, to]? (promotion rollback guard) */
  hasRecordsBetween(ctx: Ctx, studentId: StudentId, from: string, to: string): Promise<boolean>;
}
export type AttendanceOverview = {
  teachersOnLeave: number;
  pendingLeave: number;
  attendance: { date: string; isToday: boolean; percentage: number | null; absent: number; marked: number; totalSections: number; delta: number | null } | null;
  attendanceTrend: { date: string; percentage: number | null; present: number; counted: number }[];
  unmarkedToday: number;
};
export interface AttendanceOverviewProvider {
  /** The admin dashboard's attendance, leave and register figures. */
  dashboard(ctx: Ctx, args: { schoolId: SchoolId; yearId: GenericId<"academicYears">; today: string; lateCounts: boolean; isSchoolDay: boolean; sectionCount: number }): Promise<AttendanceOverview>;
}
export interface RegisterStatusProvider {
  /** Is the section's register for `date` marked? (teacher dashboard) */
  markedOn(ctx: Ctx, sectionId: GenericId<"sections">, date: string): Promise<boolean>;
}
export interface CalendarConflictProvider {
  /** Why [from, to] cannot become a holiday (registers already marked), or null. */
  holidayConflict(ctx: Ctx, schoolId: SchoolId, from: string, to: string): Promise<string | null>;
}

// ================================================================ Academics
export interface TeacherScopeProvider {
  /** Sections where the teacher teaches a subject in the year (class-teacher sections are Core, not included). */
  teachingSectionIds(ctx: Ctx, teacherId: TeacherId, yearId: GenericId<"academicYears">): Promise<GenericId<"sections">[]>;
  /** "Mathematics · 10-A" labels for the teacher's subject assignments in the year. */
  teachingLabels(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId, yearId: GenericId<"academicYears">): Promise<string[]>;
  /** The teacher's subject assignments in the year, with display names. */
  assignmentsOf(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId, yearId: GenericId<"academicYears">): Promise<{ _id: GenericId<"teacherAssignments">; sectionId: GenericId<"sections">; sectionName: string; subjectId: GenericId<"subjects">; subjectName: string }[]>;
  /** Number of subject assignments in the year. */
  subjectLoad(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId, yearId: GenericId<"academicYears">): Promise<number>;
}
export interface SubjectCatalogProvider {
  /** Every subject of the school (active and inactive). */
  subjects(ctx: Ctx, schoolId: SchoolId): Promise<{ id: string; code: string; name: string; active: boolean }[]>;
}
export type TimetableView = {
  periods: { periodId: GenericId<"periods">; index: number; label: string; startTime: string; endTime: string; isBreak: boolean }[];
  lessons: { entryId: GenericId<"timetableEntries">; dayOfWeek: number; periodId: GenericId<"periods">; subjectId: GenericId<"subjects">; teacherId: TeacherId; subject: string; teacher: string; room: string | null }[];
};
export interface StudentTimetableProvider {
  /** The weekly timetable of a section (its own academic year) with the bell schedule. */
  sectionWeek(ctx: Ctx, section: SectionRef): Promise<TimetableView>;
}
export type LessonView = { entryId: GenericId<"timetableEntries">; periodLabel: string; startTime: string; endTime: string; section: string; subject: string; room: string | null };
export type HomeworkReviewView = { homeworkId: GenericId<"homework">; title: string; section: string; subject: string; dueDate: string; pending: number };
export interface TeacherDayProvider {
  /** The teacher's lessons on `weekday` from the published timetable of the year, by start time. */
  todayLessons(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId, yearId: GenericId<"academicYears">, weekday: number): Promise<LessonView[]>;
  /** The teacher's open homework of the year with submissions still to review. */
  homeworkToReview(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId, yearId: GenericId<"academicYears">): Promise<HomeworkReviewView[]>;
  /** The teacher's active homework per section (My Classes). */
  activeHomeworkBySection(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId): Promise<{ sectionId: GenericId<"sections">; count: number }[]>;
}
export type HomeworkView = {
  homeworkId: GenericId<"homework">; title: string; description: string; subject: string; teacher: string | null; assignedOn: string; dueDate: string;
  homeworkStatus: "active" | "closed"; attachmentFileIds: GenericId<"files">[];
  submission: { submissionId: GenericId<"homeworkSubmissions">; status: "submitted" | "late" | "reviewed"; submittedAt: number; content: string | null; attachmentFileIds: GenericId<"files">[]; feedback: string | null } | null;
};
export interface StudentHomeworkProvider {
  /** Homework set for the student's section in its year, with the student's own submission. */
  homeworkFor(ctx: Ctx, student: StudentRef, section: SectionRef): Promise<HomeworkView[]>;
}

// ================================================================ Fees
export type FeeDues = { outstandingMinor: number; overdueMinor: number; assigned: boolean };
export interface StudentDuesProvider {
  /** Minor units (paise). Used by the TC dues gate. */
  dues(ctx: Ctx, student: StudentRef, yearId: GenericId<"academicYears">, today: string): Promise<FeeDues>;
  /** Same for many students of one school/year (one school-wide read). */
  duesMany(ctx: Ctx, schoolId: SchoolId, yearId: GenericId<"academicYears">, studentIds: StudentId[], today: string): Promise<Map<string, FeeDues>>;
  /** Are fees assigned to the student for the year? (promotion rollback guard) */
  hasFeesInYear(ctx: Ctx, studentId: StudentId, yearId: GenericId<"academicYears">): Promise<boolean>;
}
export type FeeOverview = {
  outstandingMinor: number; overdueMinor: number; overdueStudents: number; collectedMinor: number; netMinor: number; collectionRate: number;
  byClass: { name: string; collectedMinor: number; outstandingMinor: number }[];
};
export interface FeeOverviewProvider {
  /** The admin dashboard's fee cards for the year (minor units). */
  dashboard(ctx: Ctx, schoolId: SchoolId, yearId: GenericId<"academicYears">, today: string): Promise<FeeOverview>;
}
export type FeeLedgerView = {
  academicYear: string;
  obligations: { obligationId: GenericId<"studentFees">; label: string; dueDate: string; amountMinor: number; concessionMinor: number; netMinor: number; paidMinor: number; outstandingMinor: number }[];
  payments: { paymentId: GenericId<"feePayments">; paidOn: string; amountMinor: number; method: "cash" | "upi" | "card" | "bank_transfer" | "cheque" | "online"; receiptNo: string | null; receiptId: GenericId<"receipts"> | null; reference: string | null }[];
  totals: { grossMinor: number; concessionMinor: number; paidMinor: number; outstandingMinor: number };
};
export interface StudentLedgerProvider {
  ledger(ctx: Ctx, student: StudentRef, year: YearRef): Promise<FeeLedgerView>;
}

// ================================================================ Examinations
export type Standing = "eligible" | "compartment" | "detained";
export type LatestResult = { examName: string; percentage: number; grade: string | null; failedSubjects: number; standing: Standing };
export interface StudentStandingProvider {
  /** Latest published result per student, limited to exams of the year. */
  latestResults(ctx: Ctx, schoolId: SchoolId, yearId: GenericId<"academicYears">, studentIds: StudentId[]): Promise<Map<string, LatestResult>>;
  /** Any published result for the student in an exam of the year? (promotion rollback guard) */
  hasResultsInYear(ctx: Ctx, studentId: StudentId, yearId: GenericId<"academicYears">): Promise<boolean>;
}
export type ExamOverview = {
  performance: { examName: string | null; rows: { name: string; average: number }[] };
  upcomingExams: { examId: GenericId<"exams">; name: string; status: "draft" | "scheduled" | "in_progress" | "marks_entry" | "published"; startDate: string; endDate: string; classCount: number; paperCount: number }[];
};
export interface ExamOverviewProvider {
  /** The admin dashboard's examination panels for the year. */
  dashboard(ctx: Ctx, schoolId: SchoolId, yearId: GenericId<"academicYears">, today: string): Promise<ExamOverview>;
}
export type MarksTaskView = { examId: GenericId<"exams">; examName: string; examSubjectId: GenericId<"examSubjects">; sectionId: GenericId<"sections">; label: string; entered: number; total: number };
export interface TeacherMarksProvider {
  /** Papers the teacher is assigned to, in exams of the year open for marks entry, with marks still missing. */
  marksTasks(ctx: Ctx, schoolId: SchoolId, teacherId: TeacherId, yearId: GenericId<"academicYears">): Promise<MarksTaskView[]>;
}
export type PublishedResultView = {
  examId: GenericId<"exams">; examName: string; term: string | null; startDate: string; totalMarks: number; maxMarks: number; percentage: number;
  grade: string | null; rank: number | null; sectionSize: number; sectionLabel: string | null;
  subjects: { subjectId: GenericId<"subjects">; subject: string; marks: number | null; isAbsent: boolean; maxMarks: number; grade: string | null; passed: boolean }[];
};
export interface StudentResultsProvider {
  publishedResults(ctx: Ctx, student: StudentRef): Promise<PublishedResultView[]>;
}

// ================================================================ Files owned by module records
/**
 * Authorisation for files attached to a module's records (receipts, report
 * cards, homework and submissions). The provider throws the usual NOT_FOUND /
 * FORBIDDEN errors; Core keeps the upload/storage rules.
 */
export interface FileOwnerProvider {
  /** Owner types this provider handles (e.g. "receipt"). */
  readonly ownerTypes: readonly string[];
  /** Tenant check of the owner record (throws NOT_FOUND). */
  loadOwner(ctx: Ctx, ownerType: string, ownerId: string): Promise<void>;
  /** May the caller read a file attached to this owner? (throws when not) */
  requireRead(ctx: Ctx, ownerType: string, ownerId: string): Promise<void>;
  /** Owners whose records list their attachments (homework, submissions): the caller's write rule + link handle. */
  writableRecord(ctx: Ctx, ownerType: string, ownerId: string): Promise<AttachmentRecord | null>;
}
export type AttachmentRecord = { attachments: number; attach(fileId: GenericId<"files">): Promise<void>; detach(fileId: GenericId<"files">): Promise<void> };

/** Every provider id with the interface it must implement. */
export type ProviderContracts = {
  "students.roster": StudentRosterProvider;
  "attendance.studentRecords": StudentAttendanceProvider;
  "attendance.calendarConflicts": CalendarConflictProvider;
  "attendance.registers": RegisterStatusProvider;
  "attendance.overview": AttendanceOverviewProvider;
  "academics.teacherScope": TeacherScopeProvider;
  "academics.subjects": SubjectCatalogProvider;
  "academics.studentTimetable": StudentTimetableProvider;
  "academics.studentHomework": StudentHomeworkProvider;
  "academics.homeworkFiles": FileOwnerProvider;
  "academics.teacherDay": TeacherDayProvider;
  "fees.studentDues": StudentDuesProvider;
  "fees.studentLedger": StudentLedgerProvider;
  "fees.receiptFiles": FileOwnerProvider;
  "fees.overview": FeeOverviewProvider;
  "examinations.studentStanding": StudentStandingProvider;
  "examinations.studentResults": StudentResultsProvider;
  "examinations.resultFiles": FileOwnerProvider;
  "examinations.teacherMarks": TeacherMarksProvider;
  "examinations.overview": ExamOverviewProvider;
};
export type ProviderId = keyof ProviderContracts;

export const PROVIDER_IDS = [
  "students.roster",
  "attendance.studentRecords", "attendance.calendarConflicts", "attendance.registers", "attendance.overview",
  "academics.teacherScope", "academics.subjects", "academics.studentTimetable", "academics.studentHomework", "academics.homeworkFiles", "academics.teacherDay",
  "fees.studentDues", "fees.studentLedger", "fees.receiptFiles", "fees.overview",
  "examinations.studentStanding", "examinations.studentResults", "examinations.resultFiles", "examinations.teacherMarks", "examinations.overview",
] as const satisfies readonly ProviderId[];

/** A provider registry: what a build contains (generated per export). */
export type ProviderRegistry = { readonly [K in ProviderId]?: ProviderContracts[K] };

/** The module that owns (must implement) a provider: its id prefix. */
export function providerOwner(id: ProviderId): string {
  return id.slice(0, id.indexOf("."));
}

/** What a consumer sees for a provider that is not shipped in this build. */
export function notInstalled(id: ProviderId): { installed: false; reason: string } {
  return { installed: false, reason: `${providerOwner(id)} is not installed` };
}

/** Look a provider up in a registry, with explicit absence. */
export function lookup<K extends ProviderId>(registry: ProviderRegistry, id: K): Provided<ProviderContracts[K]> {
  const provider = registry[id] as ProviderContracts[K] | undefined;
  return provider ? { installed: true, provider } : notInstalled(id);
}
