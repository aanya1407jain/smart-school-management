import type { ID, Subject } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { handle, invalid, notFound, requireActor, requirePermission, ServiceError } from "./core";
import { currentEnrollment, fullName, sectionInfo, studentsInSection, teacherName } from "./derive";
import { notify } from "./notify";

export const mockAcademicsService = {
  /** Everything the Academics workspace needs, for one academic year. */
  async getOverview(academicYearId?: ID) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      const db = readDb();
      const yearId = academicYearId ?? db.school.currentAcademicYearId;
      const classes = db.classes.filter((c) => c.academicYearId === yearId).sort((a, b) => a.grade - b.grade);
      const classIds = new Set(classes.map((c) => c.id));
      const sections = db.sections.filter((s) => classIds.has(s.classId));
      const assignments = db.teacherAssignments.filter((a) => a.academicYearId === yearId);
      const enrollments = db.enrollments.filter((e) => e.academicYearId === yearId && e.status === "active");

      const classViews = classes.map((c) => ({
        ...c,
        subjects: c.subjectIds.map((id) => db.subjects.find((s) => s.id === id)!).filter(Boolean),
        sections: sections
          .filter((s) => s.classId === c.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => {
            const ct = db.teachers.find((t) => t.id === s.classTeacherId);
            const subjectCoverage = c.subjectIds.map((subId) => {
              const a = assignments.find((x) => x.sectionId === s.id && x.subjectId === subId);
              const t = a && db.teachers.find((x) => x.id === a.teacherId);
              return { subjectId: subId, assignmentId: a?.id ?? null, teacherId: t?.id ?? null, teacherName: t ? teacherName(t) : null };
            });
            return {
              ...s,
              label: `${c.grade}-${s.name}`,
              studentCount: enrollments.filter((e) => e.sectionId === s.id).length,
              classTeacherName: ct ? teacherName(ct) : null,
              subjectCoverage,
            };
          }),
      }));

      const totalSlots = classViews.reduce((a, c) => a + c.sections.length * c.subjectIds.length, 0);
      const filledSlots = classViews.reduce((a, c) => a + c.sections.reduce((x, s) => x + s.subjectCoverage.filter((sc) => sc.teacherId).length, 0), 0);
      const activeStudents = db.students.filter((s) => s.status === "active");
      const unenrolled = activeStudents.filter((s) => !db.enrollments.some((e) => e.studentId === s.id && e.academicYearId === yearId));

      return {
        year: db.academicYears.find((y) => y.id === yearId)!,
        years: db.academicYears.map((y) => ({ ...y, isCurrent: y.id === db.school.currentAcademicYearId, classCount: db.classes.filter((c) => c.academicYearId === y.id).length })),
        classes: classViews,
        subjects: db.subjects.map((s) => ({ ...s, classCount: classes.filter((c) => c.subjectIds.includes(s.id)).length, teacherCount: new Set(assignments.filter((a) => a.subjectId === s.id).map((a) => a.teacherId)).size })),
        teachers: db.teachers.filter((t) => t.status !== "inactive").map((t) => ({ id: t.id, name: teacherName(t), specializationIds: t.specializationIds, load: assignments.filter((a) => a.teacherId === t.id).length })),
        unenrolled: unenrolled.map((s) => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo })),
        progress: {
          classes: classes.length,
          sections: sections.length,
          subjects: db.subjects.length,
          enrolled: enrollments.length,
          activeStudents: activeStudents.length,
          assignmentCoverage: totalSlots ? (filledSlots / totalSlots) * 100 : 0,
          openSlots: totalSlots - filledSlots,
        },
      };
    });
  },

  async createAcademicYear(input: { name: string; startDate: string; endDate: string }) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      if (!input.name.trim()) throw invalid("Name is required", { name: "Required" });
      if (!input.startDate || !input.endDate || input.endDate <= input.startDate) throw invalid("End date must be after start date", { endDate: "Must be after start date" });
      return writeDb((db) => {
        if (db.academicYears.some((y) => y.name === input.name.trim())) throw invalid("This academic year already exists", { name: "Already exists" });
        const id = newId("ay");
        db.academicYears.push({ id, name: input.name.trim(), startDate: input.startDate, endDate: input.endDate, status: "upcoming" });
        return { id };
      });
    });
  },

  async setCurrentYear(yearId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      return writeDb((db) => {
        const y = db.academicYears.find((x) => x.id === yearId);
        if (!y) throw notFound("Academic year");
        db.academicYears.forEach((x) => { if (x.status === "active") x.status = "archived"; });
        y.status = "active";
        db.school.currentAcademicYearId = yearId;
        return { id: yearId };
      });
    });
  },

  async createClass(input: { academicYearId: ID; grade: number; subjectIds: ID[] }) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      if (!(input.grade >= 1 && input.grade <= 12)) throw invalid("Grade must be between 1 and 12", { grade: "1–12" });
      return writeDb((db) => {
        if (db.classes.some((c) => c.academicYearId === input.academicYearId && c.grade === input.grade)) throw invalid(`Class ${input.grade} already exists for this year`, { grade: "Already exists" });
        const id = `cls_${input.grade}_${newId("").slice(1, 7)}`;
        db.classes.push({ id, academicYearId: input.academicYearId, grade: input.grade, name: `Class ${input.grade}`, subjectIds: input.subjectIds });
        return { id };
      });
    });
  },

  async updateClassSubjects(classId: ID, subjectIds: ID[]) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      return writeDb((db) => {
        const c = db.classes.find((x) => x.id === classId);
        if (!c) throw notFound("Class");
        c.subjectIds = subjectIds;
        return { id: classId };
      });
    });
  },

  async createSection(input: { classId: ID; name: string; room: string; capacity: number; classTeacherId: ID | null }) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      const name = input.name.trim().toUpperCase();
      if (!/^[A-Z]{1,2}$/.test(name)) throw invalid("Section name should be a letter, e.g. D", { name: "Use a letter such as D" });
      return writeDb((db) => {
        const cls = db.classes.find((c) => c.id === input.classId);
        if (!cls) throw notFound("Class");
        if (db.sections.some((s) => s.classId === input.classId && s.name === name)) throw invalid(`Section ${name} already exists`, { name: "Already exists" });
        const id = `sec_${cls.grade}${name.toLowerCase()}_${newId("").slice(1, 6)}`;
        db.sections.push({ id, classId: input.classId, name, room: input.room.trim() || "To be allotted", capacity: input.capacity || 40, classTeacherId: input.classTeacherId });
        if (input.classTeacherId) notifyClassTeacher(input.classTeacherId, `${cls.grade}-${name}`, id);
        return { id };
      });
    });
  },

  async updateSection(sectionId: ID, input: { room: string; capacity: number; classTeacherId: ID | null }) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      return writeDb((db) => {
        const s = db.sections.find((x) => x.id === sectionId);
        if (!s) throw notFound("Section");
        const changedTeacher = input.classTeacherId && input.classTeacherId !== s.classTeacherId;
        Object.assign(s, { room: input.room, capacity: input.capacity, classTeacherId: input.classTeacherId });
        if (changedTeacher) notifyClassTeacher(input.classTeacherId!, sectionInfo(db, s.id).label, s.id);
        return { id: sectionId };
      });
    });
  },

  async createSubject(input: { name: string; code: string; type: Subject["type"]; classIds: ID[] }) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      if (!input.name.trim()) throw invalid("Subject name is required", { name: "Required" });
      if (!/^[A-Z]{2,4}$/.test(input.code.trim().toUpperCase())) throw invalid("Code should be 2–4 letters", { code: "2–4 letters, e.g. EVS" });
      return writeDb((db) => {
        if (db.subjects.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) throw invalid("Subject already exists", { name: "Already exists" });
        const id = `sub_${input.code.trim().toLowerCase()}`;
        db.subjects.push({ id, name: input.name.trim(), code: input.code.trim().toUpperCase(), type: input.type });
        db.classes.filter((c) => input.classIds.includes(c.id)).forEach((c) => c.subjectIds.push(id));
        return { id };
      });
    });
  },

  async getSectionRoster(sectionId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      const db = readDb();
      return studentsInSection(db, sectionId).map((s) => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo, rollNo: currentEnrollment(db, s.id)?.rollNo ?? null }));
    });
  },

  /** Enroll (or move) students into a section for the current year. */
  async enrollStudents(sectionId: ID, studentIds: ID[]) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      if (!studentIds.length) throw invalid("Select at least one student");
      return writeDb((db) => {
        const section = db.sections.find((s) => s.id === sectionId);
        if (!section) throw notFound("Section");
        const cls = db.classes.find((c) => c.id === section.classId)!;
        const yearId = cls.academicYearId;
        let roll = db.enrollments.filter((e) => e.sectionId === sectionId && e.academicYearId === yearId).reduce((m, e) => Math.max(m, e.rollNo), 0);
        for (const sid of studentIds) {
          const existing = db.enrollments.find((e) => e.studentId === sid && e.academicYearId === yearId);
          roll += 1;
          if (existing) { existing.sectionId = sectionId; existing.rollNo = roll; existing.status = "active"; }
          else db.enrollments.push({ id: newId("enr"), studentId: sid, academicYearId: yearId, sectionId, rollNo: roll, status: "active" });
        }
        return { enrolled: studentIds.length };
      });
    });
  },

  /**
   * One teacher per subject per section. Assigning replaces the previous
   * teacher, and the new teacher is notified — their dashboard, class list,
   * attendance and marks entry update immediately.
   */
  async assignTeacher(input: { sectionId: ID; subjectId: ID; teacherId: ID }) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      return writeDb((db) => {
        const section = db.sections.find((s) => s.id === input.sectionId);
        const teacher = db.teachers.find((t) => t.id === input.teacherId);
        const subject = db.subjects.find((s) => s.id === input.subjectId);
        if (!section || !teacher || !subject) throw notFound("Section, subject or teacher");
        const yearId = db.classes.find((c) => c.id === section.classId)!.academicYearId;
        const existing = db.teacherAssignments.find((a) => a.sectionId === input.sectionId && a.subjectId === input.subjectId && a.academicYearId === yearId);
        if (existing?.teacherId === input.teacherId) throw new ServiceError("CONFLICT", `${teacherName(teacher)} already teaches ${subject.name} in this section.`);
        if (existing) {
          existing.teacherId = input.teacherId;
          // Keep the timetable consistent with the new assignment.
          db.timetable.filter((t) => t.sectionId === input.sectionId && t.subjectId === input.subjectId).forEach((t) => (t.teacherId = input.teacherId));
        } else {
          db.teacherAssignments.push({ id: newId("ta"), academicYearId: yearId, teacherId: input.teacherId, sectionId: input.sectionId, subjectId: input.subjectId });
        }
        const label = sectionInfo(db, section.id).label;
        notify(db, [`u_${teacher.id}`], { category: "general", title: `New class assigned: ${label}`, message: `You now teach ${subject.name} to Class ${label}.`, href: `/teacher/classes/${section.id}` });
        return { ok: true };
      });
    });
  },

  async removeAssignment(assignmentId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "academics:manage");
      return writeDb((db) => {
        const idx = db.teacherAssignments.findIndex((a) => a.id === assignmentId);
        if (idx < 0) throw notFound("Assignment");
        db.teacherAssignments.splice(idx, 1);
        return { ok: true };
      });
    });
  },
};

function notifyClassTeacher(teacherId: ID, label: string, sectionId: ID) {
  // called inside writeDb — read the live db
  const db = readDb();
  notify(db, [`u_${teacherId}`], { category: "general", title: `You are now class teacher of ${label}`, message: "You can mark daily attendance for this section.", href: `/teacher/classes/${sectionId}` });
}

export type AcademicsService = typeof mockAcademicsService;
export type AcademicsOverview = Awaited<ReturnType<AcademicsService["getOverview"]>>;
