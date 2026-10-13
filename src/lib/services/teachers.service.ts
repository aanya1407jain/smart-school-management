import type { ID, LeaveStatus, LeaveType, StaffAttendanceStatus, Teacher } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { todayISO, previousSchoolDay, daysBetween } from "@/lib/utils/dates";
import { forbidden, handle, invalid, notFound, requireActor, requirePermission } from "./core";
import { schoolCode, sectionInfo, teacherName } from "./derive";
import { notify } from "./notify";

export interface TeacherFilters {
  search?: string;
  subjectId?: string;
  classId?: string;
  status?: Teacher["status"] | "all";
}

export interface TeacherInput {
  title: Teacher["title"];
  firstName: string;
  lastName: string;
  gender: Teacher["gender"];
  email: string;
  phone: string;
  designation: string;
  qualification: string;
  specializationIds: ID[];
  joiningDate: string;
  address: string;
  status: Teacher["status"];
}

function validate(input: TeacherInput) {
  const e: Record<string, string> = {};
  if (!input.firstName.trim()) e.firstName = "First name is required";
  if (!input.lastName.trim()) e.lastName = "Last name is required";
  if (!/^\S+@\S+\.\S+$/.test(input.email)) e.email = "Enter a valid email";
  if (!/^[+\d\s-]{8,}$/.test(input.phone)) e.phone = "Enter a valid phone number";
  if (!input.specializationIds.length) e.specializationIds = "Select at least one subject";
  if (Object.keys(e).length) throw invalid("Please fix the highlighted fields.", e);
}

export const mockTeacherService = {
  async list(filters: TeacherFilters = {}) {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      const db = readDb();
      const yearId = db.school.currentAcademicYearId;
      const today = previousSchoolDay(todayISO());
      const q = filters.search?.trim().toLowerCase();
      return db.teachers
        .map((t) => {
          const assignments = db.teacherAssignments.filter((a) => a.teacherId === t.id && a.academicYearId === yearId);
          const sectionIds = Array.from(new Set(assignments.map((a) => a.sectionId)));
          const classIds = new Set(sectionIds.map((id) => db.sections.find((s) => s.id === id)?.classId));
          const subjectIds = Array.from(new Set(assignments.map((a) => a.subjectId)));
          const att = db.staffAttendance.filter((s) => s.teacherId === t.id);
          const present = att.filter((s) => s.status === "present").length;
          const classTeacherOf = db.sections.find((s) => s.classTeacherId === t.id);
          return {
            id: t.id, employeeId: t.employeeId, name: teacherName(t), firstName: t.firstName, lastName: t.lastName, email: t.email, phone: t.phone,
            designation: t.designation, status: t.status,
            subjects: (subjectIds.length ? subjectIds : t.specializationIds).map((id) => db.subjects.find((s) => s.id === id)?.name ?? id),
            subjectIds: Array.from(new Set([...subjectIds, ...t.specializationIds])),
            classIds: Array.from(classIds) as ID[],
            sections: sectionIds.map((id) => sectionInfo(db, id).label).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)),
            periodsPerWeek: db.timetable.filter((x) => x.teacherId === t.id).length,
            classTeacherOf: classTeacherOf ? sectionInfo(db, classTeacherOf.id).label : null,
            attendancePct: att.length ? (present / att.filter((s) => s.status !== "on_leave").length || 0) * 100 : null,
            todayStatus: db.staffAttendance.find((s) => s.teacherId === t.id && s.date === today)?.status ?? null,
          };
        })
        .filter((t) => !q || t.name.toLowerCase().includes(q) || t.employeeId.toLowerCase().includes(q) || t.email.toLowerCase().includes(q))
        .filter((t) => !filters.subjectId || t.subjectIds.includes(filters.subjectId))
        .filter((t) => !filters.classId || t.classIds.includes(filters.classId))
        .filter((t) => !filters.status || filters.status === "all" || t.status === filters.status)
        .sort((a, b) => a.lastName.localeCompare(b.lastName));
    });
  },

  /** Admin sees any teacher; a teacher can only load their own profile. */
  async getProfile(teacherId: ID) {
    return handle(() => {
      const actor = requireActor();
      if (actor.role === "teacher") {
        if (actor.teacherId !== teacherId) throw forbidden("You can only view your own profile.");
      } else requirePermission(actor, "staff:manage");
      const db = readDb();
      const t = db.teachers.find((x) => x.id === teacherId);
      if (!t) throw notFound("Teacher");
      const yearId = db.school.currentAcademicYearId;
      const assignments = db.teacherAssignments
        .filter((a) => a.teacherId === t.id && a.academicYearId === yearId)
        .map((a) => ({ ...a, subject: db.subjects.find((s) => s.id === a.subjectId)!.name, sectionLabel: sectionInfo(db, a.sectionId).label,
          grade: sectionInfo(db, a.sectionId).cls?.grade ?? 0,
          students: db.enrollments.filter((e) => e.sectionId === a.sectionId && e.academicYearId === yearId && e.status === "active").length }))
        .sort((a, b) => a.grade - b.grade || a.sectionLabel.localeCompare(b.sectionLabel));
      const att = db.staffAttendance.filter((s) => s.teacherId === t.id).sort((a, b) => b.date.localeCompare(a.date));
      const leave = db.leaveRequests.filter((l) => l.teacherId === t.id).sort((a, b) => b.fromDate.localeCompare(a.fromDate));
      const classTeacherOf = db.sections.filter((s) => s.classTeacherId === t.id).map((s) => ({ id: s.id, label: sectionInfo(db, s.id).label }));
      return {
        teacher: t,
        name: teacherName(t),
        specializations: t.specializationIds.map((id) => db.subjects.find((s) => s.id === id)?.name ?? id),
        assignments,
        classTeacherOf,
        timetable: db.timetable.filter((x) => x.teacherId === t.id).map((x) => ({ ...x, subject: db.subjects.find((s) => s.id === x.subjectId)!.name, sectionLabel: sectionInfo(db, x.sectionId).label })),
        attendance: {
          records: att.slice(0, 30),
          present: att.filter((a) => a.status === "present").length,
          absent: att.filter((a) => a.status === "absent").length,
          onLeave: att.filter((a) => a.status === "on_leave").length,
        },
        leave,
        account: db.users.find((u) => u.teacherId === t.id)?.email ?? null,
      };
    });
  },

  async create(input: TeacherInput) {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      validate(input);
      return writeDb((db) => {
        const email = input.email.trim().toLowerCase();
        if (db.users.some((u) => u.email.toLowerCase() === email)) throw invalid("Email already in use", { email: "Email already in use" });
        const maxEmp = db.teachers.reduce((m, t) => Math.max(m, Number(t.employeeId.split("-").pop())), 0);
        const id = newId("t");
        const teacher: Teacher = {
          id, employeeId: `${schoolCode(db.school)}-EMP-${String(maxEmp + 1).padStart(3, "0")}`, title: input.title, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
          gender: input.gender, email, phone: input.phone.trim(), designation: input.designation.trim() || "Teacher (TGT)", qualification: input.qualification.trim(),
          specializationIds: input.specializationIds, joiningDate: input.joiningDate, status: input.status, address: input.address.trim(),
        };
        db.teachers.push(teacher);
        db.users.push({ id: `u_${id}`, email, role: "teacher", displayName: `${teacher.firstName} ${teacher.lastName}`, phone: teacher.phone, teacherId: id });
        notify(db, [`u_${id}`], { category: "general", title: `Welcome to ${db.school.name}`, message: "Your classes will appear here once the office assigns them.", href: "/teacher/dashboard" });
        return { id, email };
      });
    });
  },

  async update(teacherId: ID, input: TeacherInput) {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      validate(input);
      return writeDb((db) => {
        const t = db.teachers.find((x) => x.id === teacherId);
        if (!t) throw notFound("Teacher");
        Object.assign(t, { ...input, firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: input.email.trim().toLowerCase() });
        const u = db.users.find((x) => x.teacherId === teacherId);
        if (u) u.displayName = `${t.firstName} ${t.lastName}`;
        return { id: teacherId };
      });
    });
  },

  async getStaffAttendance(date: string) {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      const db = readDb();
      return db.teachers
        .filter((t) => t.status !== "inactive")
        .map((t) => {
          const rec = db.staffAttendance.find((s) => s.teacherId === t.id && s.date === date);
          const onLeave = db.leaveRequests.some((l) => l.teacherId === t.id && l.status === "approved" && l.fromDate <= date && l.toDate >= date);
          return { teacherId: t.id, name: teacherName(t), employeeId: t.employeeId, designation: t.designation, status: rec?.status ?? (onLeave ? "on_leave" : null), onApprovedLeave: onLeave };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  },

  async saveStaffAttendance(date: string, entries: Record<ID, StaffAttendanceStatus>) {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      if (date > todayISO()) throw invalid("Attendance cannot be marked for a future date.");
      return writeDb((db) => {
        for (const [teacherId, status] of Object.entries(entries)) {
          const rec = db.staffAttendance.find((s) => s.teacherId === teacherId && s.date === date);
          if (rec) rec.status = status;
          else db.staffAttendance.push({ id: newId("sa"), teacherId, date, status });
        }
        return { saved: Object.keys(entries).length };
      });
    });
  },

  async listLeave(status: LeaveStatus | "all" = "all") {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      const db = readDb();
      return db.leaveRequests
        .filter((l) => status === "all" || l.status === status)
        .map((l) => {
          const t = db.teachers.find((x) => x.id === l.teacherId)!;
          return { ...l, teacherName: teacherName(t), days: daysBetween(l.fromDate, l.toDate) + 1 };
        })
        .sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || b.appliedAt.localeCompare(a.appliedAt));
    });
  },

  async decideLeave(leaveId: ID, decision: "approved" | "rejected") {
    return handle(() => {
      requirePermission(requireActor(), "staff:manage");
      return writeDb((db) => {
        const l = db.leaveRequests.find((x) => x.id === leaveId);
        if (!l) throw notFound("Leave request");
        l.status = decision;
        notify(db, [`u_${l.teacherId}`], { category: "general", title: `Leave ${decision}`, message: `Your ${l.type} leave request (${l.fromDate} → ${l.toDate}) was ${decision}.`, href: "/teacher/profile" });
        return { ok: true };
      });
    });
  },

  /** Teachers apply for leave from their own profile. */
  async applyLeave(input: { type: LeaveType; fromDate: string; toDate: string; reason: string }) {
    return handle(() => {
      const actor = requireActor();
      if (actor.role !== "teacher" || !actor.teacherId) throw forbidden();
      if (!input.fromDate || !input.toDate || input.toDate < input.fromDate) throw invalid("Check the leave dates", { toDate: "Must be on or after the start date" });
      if (input.reason.trim().length < 5) throw invalid("Please give a short reason", { reason: "At least 5 characters" });
      return writeDb((db) => {
        db.leaveRequests.push({ id: newId("lv"), teacherId: actor.teacherId!, type: input.type, fromDate: input.fromDate, toDate: input.toDate, reason: input.reason.trim(), status: "pending", appliedAt: new Date().toISOString() });
        notify(db, db.users.filter((u) => u.role === "admin").map((u) => u.id), { category: "general", title: `Leave request from ${actor.displayName}`, message: `${input.type} leave, ${input.fromDate} → ${input.toDate}`, href: "/admin/teachers?tab=leave" });
        return { ok: true };
      });
    });
  },
};

export type TeacherService = typeof mockTeacherService;
export type TeacherProfile = Awaited<ReturnType<TeacherService["getProfile"]>>;
