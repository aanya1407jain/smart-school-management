"use client";
/** Attendance's contributions to shared screens (src/lib/contributions/types.ts). */
import type { ModuleUiContributions } from "@/lib/contributions/types";
import { RegistersAction, RegistersPanel, RegistersStat } from "@/features/attendance/teacher-dashboard-parts";
import { AttendanceDashboardCard } from "@/features/attendance/student-dashboard-card";
import { AttendanceAlerts, AttendanceStat, AttendanceTrendPanel } from "@/features/attendance/admin-dashboard-parts";
import { CalendarCheck2 } from "lucide-react";
import { AttendanceReport } from "@/features/attendance/attendance-report";
import { LeaveRequests, StaffAttendance } from "@/features/attendance/staff-admin";
import { MyLeave } from "@/features/attendance/my-leave";

export const attendanceUi: ModuleUiContributions = {
  teachersWorkspace: { module: "attendance", order: 10, tabs: [{ value: "attendance", label: "Staff attendance", Content: StaffAttendance }, { value: "leave", label: "Leave", Content: LeaveRequests }] },
  staffProfile: { module: "attendance", order: 10, Section: MyLeave },
  reportTabs: { module: "attendance", order: 20, tabs: [{ value: "attendance", label: "Attendance", visible: (can) => can("reports:read") || can("attendance:read:all"), Content: AttendanceReport }] },
  adminDashboard: { module: "attendance", order: 10, Alerts: AttendanceAlerts, Stats: AttendanceStat, panels: [{ wide: true, Panel: AttendanceTrendPanel }], quickActions: [{ label: "Review attendance", href: "/admin/attendance", Icon: CalendarCheck2 }] },
  studentDashboard: { module: "attendance", order: 10, Card: AttendanceDashboardCard },
  teacherDashboard: { module: "attendance", order: 10, Actions: RegistersAction, Stats: RegistersStat, Panels: RegistersPanel },
};
