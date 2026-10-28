/**
 * UI contribution slots (Core). A Core or Students screen that shows parts of
 * other modules declares a slot here; each module fills it from
 * src/modules/<module>/contributions.tsx, and the composition root
 * (src/modules/ui.generated.ts) lists only the modules shipped in the build.
 * Slot data uses the provider contract types (convex/contracts/providers.ts),
 * so a slot never depends on a module.
 */
import type { ComponentType, ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ModuleKey } from "@convex/core/modules";
import type { FeeLedgerView, HomeworkView, PublishedResultView } from "@convex/contracts/providers";
import type { Notice } from "@/types/core";
import type { Permission } from "@convex/core/permissions";

/** What the staff/student profile knows about a student (module sections come from providers). */
export type StudentProfileSlotData = {
  studentId: string;
  isAdmin: boolean;
  results: PublishedResultView[];
  homework: HomeworkView[];
  fees: FeeLedgerView | null;
};

export type ProfileMetric = { key: string; label: string; value: string; tone?: "warn" };
export type ProfileTab = { value: string; label: string; count?: number; content: ReactNode };

export interface StudentProfileContribution {
  /** Stored entitlement key that gates this contribution for a school. */
  module: ModuleKey;
  order: number;
  metrics?(p: StudentProfileSlotData): ProfileMetric[];
  tabs?(p: StudentProfileSlotData): ProfileTab[];
  actions?(p: StudentProfileSlotData): ReactNode;
}

/** The teacher landing page's data (Core query; module parts filled by providers). */
export type TeacherDayData = FunctionReturnType<typeof api.dashboards.teacherOverview>;
export interface TeacherDashboardContribution {
  module: ModuleKey;
  order: number;
  /** Header buttons, stat cards and panels; each receives the day's data. */
  Actions?: ComponentType<{ d: TeacherDayData }>;
  Stats?: ComponentType<{ d: TeacherDayData }>;
  Panels?: ComponentType<{ d: TeacherDayData }>;
}

/** A card on the student's own dashboard (the module loads its own data for the student). */
export interface StudentDashboardContribution {
  module: ModuleKey;
  order: number;
  Card: ComponentType<{ studentId: Id<"students">; active: boolean }>;
}

/** The admin dashboard's view model (live: reports.adminDashboard; demo: the demo dataset). */
export type AdminDashboardVM = {
  school: { name: string };
  stats: {
    students: number | null; sections: number; teachers: number; teachersOnLeave: number | null;
    attendance: { date: string; isToday: boolean; percentage: number | null; absent: number; marked: number; totalSections: number; delta: number | null };
    fees: { outstanding: number; overdue: number; overdueStudents: number; collected: number; collectionRate: number };
  };
  attendanceTrend: { date: string; percentage: number; present?: number; counted?: number }[];
  feeByClass: { name: string; collected: number; outstanding: number }[];
  performance: { examName: string | null; rows: { name: string; average: number }[] };
  upcomingExams: { id: string; name: string; status: string; startDate: string; endDate: string; classCount: number; paperCount: number; marksProgress: number | null }[];
  notices: (Notice & { audienceLabel: string })[];
  /** Student achievements (Students' view model; demo data only for now). */
  achievements: readonly unknown[];
  tasks: { unmarkedToday: number | null; pendingLeave: number | null };
};
export type AdminDashboardPartProps = { d: AdminDashboardVM; live: boolean };
export type AdminFeesOnly = NonNullable<FunctionReturnType<typeof api.reports.adminDashboard>["fees"]>;
export interface AdminDashboardContribution {
  module: ModuleKey;
  order: number;
  HeaderActions?: ComponentType<AdminDashboardPartProps>;
  Alerts?: ComponentType<AdminDashboardPartProps>;
  Stats?: ComponentType<AdminDashboardPartProps>;
  /** Panels in the two-column grid; `wide` spans both columns. */
  panels?: { wide?: boolean; Panel: ComponentType<AdminDashboardPartProps> }[];
  /** Full-width sections below the panels. */
  Sections?: ComponentType<AdminDashboardPartProps>;
  quickActions?: { label: string; href: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }[];
  /** What a finance-only member (no school-wide reports) sees. */
  FinanceOnly?: ComponentType<{ fees: AdminFeesOnly }>;
}

/** Tabs of the Reports page; `visible` checks the member's permissions. */
export interface ReportTabsContribution {
  module: ModuleKey;
  order: number;
  tabs: { value: string; label: string; visible(can: (p: Permission) => boolean): boolean; Content: ComponentType }[];
}

/** What a contributed Academics-setup tab receives (Core records of the selected year). */
export type AcademicsSetupCtx = {
  year: FunctionReturnType<typeof api.academics.listAcademicYears>[number] | null;
  sections: FunctionReturnType<typeof api.academics.listSections>;
  teachers: FunctionReturnType<typeof api.academics.listTeachers>;
  action: string | null;
};
export interface AcademicsSetupContribution {
  /** Omitted: shown whenever the module is shipped (subjects were never gated by an entitlement). */
  module?: ModuleKey;
  order: number;
  tabs: { value: string; label: string; order: number; Content: ComponentType<{ ctx: AcademicsSetupCtx }> }[];
  /** An action on each class card (e.g. its curriculum). */
  ClassAction?: ComponentType<{ year: NonNullable<AcademicsSetupCtx["year"]>; klass: FunctionReturnType<typeof api.academics.listClasses>[number] }>;
}

/** Extra tabs of the Core Teachers & Staff workspace. */
export interface TeachersWorkspaceContribution {
  module: ModuleKey;
  order: number;
  tabs: { value: string; label: string; Content: ComponentType }[];
}
/** Sections of a teacher's own profile page. */
export interface StaffProfileContribution {
  module: ModuleKey;
  order: number;
  Section: ComponentType;
}

/** Everything a module may contribute to shared screens. */
export interface ModuleUiContributions {
  teachersWorkspace?: TeachersWorkspaceContribution;
  staffProfile?: StaffProfileContribution;
  academicsSetup?: AcademicsSetupContribution;
  reportTabs?: ReportTabsContribution;
  adminDashboard?: AdminDashboardContribution;
  studentDashboard?: StudentDashboardContribution;
  studentProfile?: StudentProfileContribution;
  teacherDashboard?: TeacherDashboardContribution;
}
