import type { StudentEditInput } from "@/types/students";
import type { Gender, GuardianLink, ID, Student, StudentStatus } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { hasPermission } from "@/lib/permissions";
import {
  assertStudentInScope, forbidden, handle, invalid, notFound, requireActor, requireAny, requirePermission, scopeFor,
} from "./core";
import {
  accountsForStudent, attendanceStats, currentEnrollment, examResultFor, feeLedger, fullName, homeworkStatusFor,
  primaryGuardian, sectionInfo, teacherName, type FeeStanding,
  schoolCode, schoolEmailDomain,
} from "./derive";
import { assignStructure } from "./fees.service";
import { notify } from "./notify";

export interface StudentFilters {
  search?: string;
  classId?: string;
  sectionId?: string;
  academicYearId?: string;
  status?: StudentStatus | "all";
  sortBy?: "name" | "admissionNo" | "class" | "attendance" | "outstanding";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface StudentListItem {
  id: ID;
  admissionNo: string;
  name: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  email: string;
  status: StudentStatus;
  classId: ID;
  sectionId: ID;
  grade: number;
  classLabel: string;
  rollNo: number | null;
  guardianName: string | null;
  guardianRelation: string | null;
  guardianPhone: string | null;
  attendancePct: number | null;
  feeStanding: FeeStanding | null; // null when the viewer cannot see fees
  outstanding: number | null;
}

export type StudentInput = StudentEditInput;

function validate(input: StudentInput) {
  const errors: Record<string, string> = {};
  if (!input.firstName.trim()) errors.firstName = "First name is required";
  if (!input.lastName.trim()) errors.lastName = "Last name is required";
  if (!input.dateOfBirth) errors.dateOfBirth = "Date of birth is required";
  if (!input.sectionId) errors.sectionId = "Select a class and section";
  if (!input.guardian.name.trim()) errors["parentContact.name"] = "Parent name is required";
  if (!/^[+\d\s-]{8,}$/.test(input.guardian.phone)) errors["parentContact.phone"] = "Enter a valid phone number";
  if (Object.keys(errors).length) throw invalid("Please fix the highlighted fields.", errors);
}

export const mockStudentService = {
  async list(filters: StudentFilters = {}) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["students:read:all", "students:read:assigned"]);
      const db = readDb();
      const scope = scopeFor(actor, db);
      const canSeeFees = hasPermission(actor, "fees:manage");
      const yearId = filters.academicYearId || db.school.currentAcademicYearId;
      const q = filters.search?.trim().toLowerCase();

      let items: StudentListItem[] = [];
      for (const s of db.students) {
        if (!scope.all && !scope.studentIds.has(s.id)) continue;
        const enr = db.enrollments.find((e) => e.studentId === s.id && e.academicYearId === yearId);
        if (!enr) continue; // not enrolled in the selected academic year
        const info = sectionInfo(db, enr.sectionId);
        const g = primaryGuardian(db, s.id);
        const ledger = canSeeFees ? feeLedger(db, s.id) : null;
        items.push({
          id: s.id, admissionNo: s.admissionNo, name: fullName(s), firstName: s.firstName, lastName: s.lastName, gender: s.gender,
          email: s.email, status: s.status, classId: info.cls?.id ?? "", sectionId: enr.sectionId, grade: info.cls?.grade ?? 0,
          classLabel: info.label, rollNo: enr.rollNo, guardianName: g?.name ?? null, guardianRelation: g?.relation ?? null,
          guardianPhone: g?.phone ?? null, attendancePct: attendanceStats(db, s.id).percentage,
          feeStanding: ledger?.standing ?? null, outstanding: ledger?.totals.outstanding ?? null,
        });
      }

      if (q) items = items.filter((s) => s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q) || (s.guardianName ?? "").toLowerCase().includes(q));
      if (filters.classId) items = items.filter((s) => s.classId === filters.classId);
      if (filters.sectionId) items = items.filter((s) => s.sectionId === filters.sectionId);
      if (filters.status && filters.status !== "all") items = items.filter((s) => s.status === filters.status);

      const dir = filters.sortDir === "desc" ? -1 : 1;
      const by = filters.sortBy ?? "class";
      items.sort((a, b) => {
        switch (by) {
          case "name": return dir * a.name.localeCompare(b.name);
          case "admissionNo": return dir * a.admissionNo.localeCompare(b.admissionNo);
          case "attendance": return dir * ((a.attendancePct ?? -1) - (b.attendancePct ?? -1));
          case "outstanding": return dir * ((a.outstanding ?? 0) - (b.outstanding ?? 0));
          default: return dir * (a.grade - b.grade || a.classLabel.localeCompare(b.classLabel) || (a.rollNo ?? 0) - (b.rollNo ?? 0));
        }
      });

      const total = items.length;
      const pageSize = filters.pageSize ?? 12;
      const page = Math.max(1, Math.min(filters.page ?? 1, Math.max(1, Math.ceil(total / pageSize))));
      const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
      return { items: pageItems, total, page, pageSize, statusCounts: countStatuses(db.students.filter((s) => scope.all || scope.studentIds.has(s.id))) };
    });
  },

  /** Full connected profile. Scope-checked: teachers only their students, students only themselves. */
  async getProfile(studentId: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const s = db.students.find((x) => x.id === studentId);
      if (!s) throw notFound("Student");
      if (actor.role === "student") {
        if (!actor.studentIds?.includes(studentId)) throw forbidden("You can only view your own profile.");
      } else {
        requireAny(actor, ["students:read:all", "students:read:assigned"]);
        assertStudentInScope(actor, studentId);
      }
      const enr = currentEnrollment(db, studentId);
      const info = sectionInfo(db, enr?.sectionId);
      const canSeeFees = hasPermission(actor, "fees:manage") || (actor.role === "student");
      const guardians = db.guardianLinks
        .filter((l) => l.studentId === studentId)
        .map((l) => ({ ...db.guardians.find((g) => g.id === l.guardianId)!, relation: l.relation, isPrimary: l.isPrimary,
          otherChildren: db.guardianLinks.filter((x) => x.guardianId === l.guardianId && x.studentId !== studentId).map((x) => {
            const sib = db.students.find((st) => st.id === x.studentId)!;
            return { id: sib.id, name: fullName(sib), classLabel: sectionInfo(db, currentEnrollment(db, sib.id)?.sectionId).label };
          }) }));

      const sessions = db.attendance.filter((a) => a.sectionId === enr?.sectionId && a.entries[studentId]).sort((a, b) => b.date.localeCompare(a.date));
      const monthly: Record<string, { month: string; present: number; late: number; absent: number }> = {};
      sessions.forEach((a) => {
        const key = a.date.slice(0, 7);
        monthly[key] ??= { month: key, present: 0, late: 0, absent: 0 };
        monthly[key][a.entries[studentId]] += 1;
      });

      const teachers = db.teacherAssignments
        .filter((a) => a.sectionId === enr?.sectionId && a.academicYearId === db.school.currentAcademicYearId)
        .map((a) => {
          const t = db.teachers.find((x) => x.id === a.teacherId)!;
          return { subjectId: a.subjectId, subject: db.subjects.find((x) => x.id === a.subjectId)!.name, teacherId: t.id, teacher: teacherName(t) };
        })
        .sort((a, b) => a.subject.localeCompare(b.subject));

      const visibleExams = db.exams.filter((e) => actor.role === "admin" || actor.role === "teacher" ? e.status !== "scheduled" && e.status !== "draft" : e.status === "published");
      const results = visibleExams.map((e) => examResultFor(db, studentId, e)).filter(Boolean);

      const homework = db.homework
        .filter((h) => h.sectionId === enr?.sectionId)
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
        .map((h) => {
          const sub = db.submissions.find((x) => x.homeworkId === h.id && x.studentId === studentId);
          return { id: h.id, title: h.title, subject: db.subjects.find((x) => x.id === h.subjectId)!.name, dueDate: h.dueDate, status: homeworkStatusFor(h, sub), submittedAt: sub?.submittedAt ?? null };
        });

      return {
        student: s,
        enrollment: enr ?? null,
        classInfo: { classId: info.cls?.id ?? null, sectionId: enr?.sectionId ?? null, label: info.label, longLabel: info.longLabel, room: info.section?.room ?? null,
          classTeacher: info.section?.classTeacherId ? teacherName(db.teachers.find((t) => t.id === info.section!.classTeacherId)!) : null },
        guardians,
        attendance: {
          stats: attendanceStats(db, studentId),
          recent: sessions.slice(0, 20).map((a) => ({ date: a.date, status: a.entries[studentId] })),
          monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
        },
        fees: canSeeFees ? feeLedger(db, studentId) : null,
        results,
        teachers,
        homework,
        account: accountsForStudent(db, studentId).map((u) => ({ email: u.email }))[0] ?? null,
      };
    });
  },

  async create(input: StudentInput) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "students:write");
      validate(input);
      return writeDb((db) => {
        const email = input.email.trim().toLowerCase() || `${input.firstName.trim().toLowerCase()}.${input.lastName.trim().toLowerCase()}@students.${schoolEmailDomain(db.school)}`;
        if (db.users.some((u) => u.email.toLowerCase() === email)) throw invalid("A user with this email already exists.", { email: "Email already in use" });
        const section = db.sections.find((x) => x.id === input.sectionId);
        if (!section) throw invalid("Select a valid section.", { sectionId: "Invalid section" });
        const seq = db.students.length + 1;
        const year = (input.admissionDate || new Date().toISOString()).slice(0, 4);
        const student: Student = {
          id: newId("stu"),
          admissionNo: `${schoolCode(db.school)}-${year}-${String(seq + 1000).slice(-4)}`,
          firstName: input.firstName.trim(), lastName: input.lastName.trim(), gender: input.gender, dateOfBirth: input.dateOfBirth,
          bloodGroup: input.bloodGroup, email, phone: input.phone.trim(), address: input.address.trim(),
          admissionDate: input.admissionDate, status: input.status, documents: [],
        };
        db.students.push(student);
        const rollNo = db.enrollments.filter((e) => e.sectionId === section.id && e.academicYearId === db.school.currentAcademicYearId).reduce((m, e) => Math.max(m, e.rollNo), 0) + 1;
        db.enrollments.push({ id: newId("enr"), studentId: student.id, academicYearId: db.school.currentAcademicYearId, sectionId: section.id, rollNo, status: "active" });
        const guardian = { id: newId("g"), name: input.guardian.name.trim(), phone: input.guardian.phone.trim(), email: input.guardian.email.trim(), occupation: input.guardian.occupation.trim(), address: input.address.trim() };
        db.guardians.push(guardian);
        db.guardianLinks.push({ id: newId("gl"), guardianId: guardian.id, studentId: student.id, relation: input.guardian.relation, isPrimary: true });
        db.users.push({ id: `u_${student.id}`, email, role: "student", displayName: fullName(student), phone: student.phone, studentIds: [student.id] });

        let feeAssigned = false;
        if (input.assignFees) {
          const fs = db.feeStructures.find((f) => f.classIds.includes(section.classId) && f.academicYearId === db.school.currentAcademicYearId);
          if (fs) feeAssigned = assignStructure(db, fs.id, student.id);
        }
        // Let the teachers of that section know.
        const teacherIds = new Set(db.teacherAssignments.filter((a) => a.sectionId === section.id).map((a) => a.teacherId));
        if (section.classTeacherId) teacherIds.add(section.classTeacherId);
        const label = sectionInfo(db, section.id).label;
        notify(db, db.users.filter((u) => u.teacherId && teacherIds.has(u.teacherId)).map((u) => u.id), {
          category: "general", title: `New student in ${label}`, message: `${fullName(student)} has joined Class ${label} (Roll ${rollNo}).`, href: `/teacher/classes/${section.id}`,
        });
        notify(db, [`u_${student.id}`], { category: "general", title: `Welcome to ${db.school.name}`, message: `You are enrolled in Class ${label}.`, href: "/student/dashboard" });
        return { id: student.id, email, feeAssigned };
      });
    });
  },

  async update(studentId: ID, input: StudentInput) {
    return handle(() => {
      requirePermission(requireActor(), "students:write");
      validate(input);
      return writeDb((db) => {
        const s = db.students.find((x) => x.id === studentId);
        if (!s) throw notFound("Student");
        Object.assign(s, {
          firstName: input.firstName.trim(), lastName: input.lastName.trim(), gender: input.gender, dateOfBirth: input.dateOfBirth,
          bloodGroup: input.bloodGroup, email: input.email.trim() || s.email, phone: input.phone.trim(), address: input.address.trim(),
          admissionDate: input.admissionDate, status: input.status,
        });
        const enr = currentEnrollment(db, studentId);
        if (enr && enr.sectionId !== input.sectionId) {
          enr.sectionId = input.sectionId;
          enr.rollNo = db.enrollments.filter((e) => e.sectionId === input.sectionId && e.id !== enr.id).reduce((m, e) => Math.max(m, e.rollNo), 0) + 1;
        } else if (!enr) {
          db.enrollments.push({ id: newId("enr"), studentId, academicYearId: db.school.currentAcademicYearId, sectionId: input.sectionId, rollNo: 1, status: "active" });
        }
        const link = db.guardianLinks.find((l) => l.studentId === studentId && l.isPrimary);
        const g = link && db.guardians.find((x) => x.id === link.guardianId);
        if (g && link) {
          Object.assign(g, { name: input.guardian.name.trim(), phone: input.guardian.phone.trim(), email: input.guardian.email.trim(), occupation: input.guardian.occupation.trim() });
          link.relation = input.guardian.relation;
        }
        const user = db.users.find((u) => u.id === `u_${studentId}`);
        if (user) user.displayName = fullName(s);
        return { id: studentId };
      });
    });
  },

  async setStatus(studentId: ID, status: StudentStatus) {
    return handle(() => {
      requirePermission(requireActor(), "students:write");
      return writeDb((db) => {
        const s = db.students.find((x) => x.id === studentId);
        if (!s) throw notFound("Student");
        s.status = status;
        return { id: studentId, status };
      });
    });
  },

  /** Form defaults for editing. */
  async getEditable(studentId: ID): Promise<StudentInput> {
    return handle(() => {
      requirePermission(requireActor(), "students:write");
      const db = readDb();
      const s = db.students.find((x) => x.id === studentId);
      if (!s) throw notFound("Student");
      const g = primaryGuardian(db, studentId);
      return {
        firstName: s.firstName, lastName: s.lastName, gender: s.gender, dateOfBirth: s.dateOfBirth, bloodGroup: s.bloodGroup, email: s.email,
        phone: s.phone, address: s.address, admissionDate: s.admissionDate, sectionId: currentEnrollment(db, studentId)?.sectionId ?? "", status: s.status,
        guardian: { name: g?.name ?? "", relation: (g?.relation ?? "Other") as GuardianLink["relation"], phone: g?.phone ?? "", email: g?.email ?? "", occupation: g?.occupation ?? "" },
      };
    });
  },
};

function countStatuses(list: Student[]) {
  const out: Record<StudentStatus | "all", number> = { all: list.length, active: 0, inactive: 0, transferred: 0, alumni: 0 };
  list.forEach((s) => (out[s.status] += 1));
  return out;
}

export type StudentService = typeof mockStudentService;
export type StudentProfile = Awaited<ReturnType<StudentService["getProfile"]>>;
