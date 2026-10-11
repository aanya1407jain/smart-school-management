import type { Database, ID, TimetableEntry, Weekday } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { WEEKDAY_NAMES } from "@/lib/utils/dates";
import { forbidden, handle, invalid, notFound, requireActor, requirePermission, scopeFor } from "./core";
import { sectionInfo, teacherName } from "./derive";
import { notify } from "./notify";

export type TimetableCell = TimetableEntry & { subject: string; subjectCode: string; teacher: string; sectionLabel: string };

function decorate(db: Database, e: TimetableEntry): TimetableCell {
  const sub = db.subjects.find((s) => s.id === e.subjectId)!;
  const t = db.teachers.find((x) => x.id === e.teacherId);
  return { ...e, subject: sub.name, subjectCode: sub.code, teacher: t ? teacherName(t) : "Unassigned", sectionLabel: sectionInfo(db, e.sectionId).label };
}

export interface TimetableEntryInput {
  sectionId: ID;
  day: Weekday;
  period: number;
  subjectId: ID;
  teacherId: ID;
  room: string;
}

export const mockTimetableService = {
  async getSectionTimetable(sectionId: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const scope = scopeFor(actor, db);
      if (!scope.all && !scope.sectionIds.has(sectionId)) throw forbidden("You can only view timetables for your own classes.");
      return {
        sectionLabel: sectionInfo(db, sectionId).label,
        periods: db.periods,
        entries: db.timetable.filter((e) => e.sectionId === sectionId).map((e) => decorate(db, e)),
      };
    });
  },

  async getTeacherTimetable(teacherId?: ID) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const id = teacherId ?? actor.teacherId;
      if (!id) throw forbidden();
      if (actor.role === "teacher" && actor.teacherId !== id) throw forbidden("You can only view your own timetable.");
      if (actor.role === "student") throw forbidden();
      const t = db.teachers.find((x) => x.id === id);
      if (!t) throw notFound("Teacher");
      return { teacherName: teacherName(t), periods: db.periods, entries: db.timetable.filter((e) => e.teacherId === id).map((e) => decorate(db, e)) };
    });
  },

  /** Student portal: the timetable of the student's own section. */
  async getStudentTimetable(studentId: ID) {
    return handle(() => {
      const actor = requireActor();
      if (actor.role !== "student" || !actor.studentIds?.includes(studentId)) throw forbidden("You can only view your own timetable.");
      const db = readDb();
      const enr = db.enrollments.find((e) => e.studentId === studentId && e.academicYearId === db.school.currentAcademicYearId);
      if (!enr) throw notFound("Enrollment");
      const info = sectionInfo(db, enr.sectionId);
      return { sectionLabel: info.label, room: info.section?.room ?? null, periods: db.periods, entries: db.timetable.filter((e) => e.sectionId === enr.sectionId).map((e) => decorate(db, e)) };
    });
  },

  /** Create or replace the entry in a section's day/period slot. */
  async upsertEntry(input: TimetableEntryInput) {
    return handle(() => {
      requirePermission(requireActor(), "timetable:manage");
      return writeDb((db) => {
        const period = db.periods.find((p) => p.index === input.period && !p.isBreak);
        if (!period) throw invalid("Choose a teaching period.");
        const clash = db.timetable.find((e) => e.teacherId === input.teacherId && e.day === input.day && e.period === input.period && e.sectionId !== input.sectionId);
        if (clash) {
          const t = db.teachers.find((x) => x.id === input.teacherId)!;
          throw invalid(`${teacherName(t)} already teaches Class ${sectionInfo(db, clash.sectionId).label} in this period on ${WEEKDAY_NAMES[input.day]}.`, { teacherId: "Teacher has a clash" });
        }
        const roomClash = input.room.trim() && db.timetable.find((e) => e.room === input.room.trim() && e.day === input.day && e.period === input.period && e.sectionId !== input.sectionId && !e.room.startsWith("Room"));
        if (roomClash) throw invalid(`${input.room} is already booked by Class ${sectionInfo(db, roomClash.sectionId).label}.`, { room: "Room is booked" });

        // Keep teacher assignments consistent with the timetable.
        const yearId = db.school.currentAcademicYearId;
        const asg = db.teacherAssignments.find((a) => a.sectionId === input.sectionId && a.subjectId === input.subjectId && a.academicYearId === yearId);
        if (!asg) {
          db.teacherAssignments.push({ id: newId("ta"), academicYearId: yearId, teacherId: input.teacherId, sectionId: input.sectionId, subjectId: input.subjectId });
        } else if (asg.teacherId !== input.teacherId) {
          throw invalid(`${teacherName(db.teachers.find((x) => x.id === asg.teacherId)!)} is assigned to teach this subject in this section. Change the assignment in Academics first.`, { teacherId: "Not the assigned teacher" });
        }

        const existing = db.timetable.find((e) => e.sectionId === input.sectionId && e.day === input.day && e.period === input.period);
        const record = { subjectId: input.subjectId, teacherId: input.teacherId, room: input.room.trim() || db.sections.find((s) => s.id === input.sectionId)!.room, startTime: period.startTime, endTime: period.endTime };
        if (existing) Object.assign(existing, record);
        else db.timetable.push({ id: newId("tt"), academicYearId: yearId, sectionId: input.sectionId, day: input.day, period: input.period, ...record });
        const sub = db.subjects.find((s) => s.id === input.subjectId)!;
        notify(db, [`u_${input.teacherId}`], { category: "general", title: "Timetable updated", message: `${sub.name} · Class ${sectionInfo(db, input.sectionId).label} · ${WEEKDAY_NAMES[input.day]} ${period.label}`, href: "/teacher/timetable" });
        return { ok: true };
      });
    });
  },

  async deleteEntry(entryId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "timetable:manage");
      return writeDb((db) => {
        const idx = db.timetable.findIndex((e) => e.id === entryId);
        if (idx < 0) throw notFound("Timetable entry");
        db.timetable.splice(idx, 1);
        return { ok: true };
      });
    });
  },
};

export type TimetableService = typeof mockTimetableService;
