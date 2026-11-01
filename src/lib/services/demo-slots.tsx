"use client";
/**
 * Demo-only screens, mounted by id through DemoSlot (src/lib/demo/demo-slot.tsx).
 * Part of the demo layer: internal full build only.
 */
import type { ComponentType } from "react";
import { services } from "./index";
import { TeachersWorkspace } from "@/features/teachers/teachers-workspace";
import { TeacherForm } from "@/features/teachers/teacher-form";
import { TeacherProfileView } from "@/features/teachers/teacher-profile";
import { ProfilePage } from "@/features/profile/profile-page";
import { MyAttendance } from "@/features/attendance/my-attendance";
import { StudentForm } from "@/features/students/student-form";
import { DemoStudentProfile } from "@/features/students/demo-student-profile";
import { MyClasses, TeacherClassDetail } from "@/features/teachers/my-classes";
import { StudentDashboard } from "@/features/dashboard/student-dashboard";
import { TeacherDashboard } from "@/features/dashboard/teacher-dashboard";
import { MyHomeworkDemo } from "@/features/homework/my-homework-demo";
import { DemoAcademicsWorkspace } from "@/features/academics/academics-workspace-demo";
import { ExamsList } from "@/features/examinations/exams-list";
import { ExamDetail } from "@/features/examinations/exam-detail";
import { MarksEntry } from "@/features/examinations/marks-entry";
import { TeacherExams } from "@/features/examinations/teacher-exams";
import { MyResults } from "@/features/examinations/my-results";
import { MyFees } from "@/features/fees/my-fees";
import { HomeworkManager, TeacherHomeworkDetail } from "@/features/homework/homework-manager";
import { StudentTimetable, TeacherTimetable } from "@/features/timetable/timetable-pages";

function DemoStudentEditForm({ studentId }: { studentId: string }) {
  return <StudentForm studentId={studentId} demoEdit={{ load: () => services.students.getEditable(studentId), save: (v) => services.students.update(studentId, v) }} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEMO_SLOTS: Record<string, ComponentType<any>> = {
  "teachers.workspace": TeachersWorkspace,
  "teachers.form": TeacherForm,
  "teachers.profile": TeacherProfileView,
  "profile.page": ProfilePage,
  "attendance.myAttendance": MyAttendance,
  "students.edit": DemoStudentEditForm,
  "students.profile": DemoStudentProfile,
  "teacher.myClasses": MyClasses,
  "teacher.classDetail": TeacherClassDetail,
  "student.dashboard": StudentDashboard,
  "teacher.dashboard": TeacherDashboard,
  "homework.myHomework": MyHomeworkDemo,
  "academics.workspace": DemoAcademicsWorkspace,
  "exams.list": ExamsList,
  "exams.detail": ExamDetail,
  "exams.marks": MarksEntry,
  "exams.teacher": TeacherExams,
  "exams.myResults": MyResults,
  "fees.myFees": MyFees,
  "homework.manager": HomeworkManager,
  "homework.detail": TeacherHomeworkDetail,
  "timetable.student": StudentTimetable,
  "timetable.teacher": TeacherTimetable,
};
