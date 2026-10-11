/**
 * Service registry — the ONLY entry point the UI uses for data.
 *
 * Stage 1 wires every service to its mock implementation. The Convex backend
 * (convex/, see docs/BACKEND.md) is now the target source of truth. Modules
 * migrate ONE AT A TIME: a migrated screen calls Convex directly through
 * `useSchoolQuery` / `useSchoolMutation` (src/lib/convex/membership.tsx) and
 * its mock service is deleted in the same change, so mock data and Convex are
 * never two live sources of truth for the same module.
 */
import { mockAcademicsService, type AcademicsService } from "./academics.service";
import { mockAttendanceService, type AttendanceService } from "./attendance.service";
import { mockAuthService, type AuthService } from "./auth.service";
import { mockDashboardService, type DashboardService } from "./dashboard.service";
import { mockExamService, type ExamService } from "./exams.service";
import { mockFeeService, type FeeService } from "./fees.service";
import { mockHomeworkService, type HomeworkService } from "./homework.service";
import { mockLookupService, type LookupService } from "./lookup.service";
import { mockNoticeService, type NoticeService } from "./notices.service";
import { mockNotificationService, type NotificationService } from "./notifications.service";
import { mockReportService, type ReportService } from "./reports.service";
import { mockSchoolService, type SchoolService } from "./school.service";
import { mockStudentService, type StudentService } from "./students.service";
import { mockTeacherService, type TeacherService } from "./teachers.service";
import { mockTimetableService, type TimetableService } from "./timetable.service";

export interface Services {
  auth: AuthService;
  lookup: LookupService;
  school: SchoolService;
  students: StudentService;
  academics: AcademicsService;
  teachers: TeacherService;
  attendance: AttendanceService;
  fees: FeeService;
  exams: ExamService;
  timetable: TimetableService;
  homework: HomeworkService;
  notices: NoticeService;
  notifications: NotificationService;
  dashboard: DashboardService;
  reports: ReportService;
}

export const services: Services = {
  auth: mockAuthService,
  lookup: mockLookupService,
  school: mockSchoolService,
  students: mockStudentService,
  academics: mockAcademicsService,
  teachers: mockTeacherService,
  attendance: mockAttendanceService,
  fees: mockFeeService,
  exams: mockExamService,
  timetable: mockTimetableService,
  homework: mockHomeworkService,
  notices: mockNoticeService,
  notifications: mockNotificationService,
  dashboard: mockDashboardService,
  reports: mockReportService,
};

export { ServiceError } from "./core";
export type { CurrentUser } from "./auth.service";
