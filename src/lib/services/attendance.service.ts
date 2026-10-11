import type { AttendanceStatus, ID, Section, UserAccount } from "@/types/domain";
import { attendanceReadOnlyReason, canEditAttendance, canMarkAttendance, isClassTeacherOf } from "@/lib/permissions";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { todayISO, isSchoolDay, formatDate } from "@/lib/utils/dates";
import {
  assertSectionInScope, assertStudentInScope, forbidden, handle, invalid, notFound, requireActor, requireAny, scopeFor,
} from "./core";
import { accountsForStudent, attendanceStats, currentEnrollment, fullName, sectionInfo, sessionPercentage, studentsInSection, teacherName } from "./derive";
import { notify } from "./notify";

/** Who may VIEW registers. Marking/editing is decided by class-teacher ownership (lib/permissions/attendance.ts). */
const READ_PERMS = ["attendance:read:all", "attendance:read:assigned"] as const;

/** Reject any attendance write that isn't from the section's class teacher. */
function assertCanWriteAttendance(actor: UserAccount, section: Section | undefined, isCorrection: boolean) {
  if (!section) throw notFound("Section");
  const allowed = isCorrection ? canEditAttendance(actor, section) : canMarkAttendance(actor, section);
  if (!allowed) {
    const db = readDb();
    const ct = db.teachers.find((t) => t.id === section.classTeacherId);
    throw forbidden(attendanceReadOnlyReason(actor, ct ? teacherName(ct) : null, sectionInfo(db, section.id).label));
  }
}

export const mockAttendanceService = {
  /**
   * The register for one section on one date. Viewable by admins (any section)
   * and by teachers of the section; `canMark` / `canEdit` are true only for
   * the section's class teacher.
   */
  async getRegister(sectionId: ID, date: string) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, [...READ_PERMS]);
      assertSectionInScope(actor, sectionId);
      const db = readDb();
      const section = db.sections.find((s) => s.id === sectionId);
      const session = db.attendance.find((a) => a.sectionId === sectionId && a.date === date);
      const info = sectionInfo(db, sectionId);
      const markedBy = session ? db.users.find((u) => u.id === session.markedById)?.displayName ?? "Staff" : null;
      const ct = db.teachers.find((t) => t.id === section?.classTeacherId);
      const canMark = !session && canMarkAttendance(actor, section);
      const canEdit = !!session && canEditAttendance(actor, section);
      return {
        sectionId,
        sectionLabel: info.label,
        date,
        isSchoolDay: isSchoolDay(date),
        isFuture: date > todayISO(),
        classTeacherName: ct ? teacherName(ct) : null,
        isClassTeacher: isClassTeacherOf(actor, section),
        canMark,
        canEdit,
        readOnlyReason: canMark || canEdit || isClassTeacherOf(actor, section) ? null : attendanceReadOnlyReason(actor, ct ? teacherName(ct) : null, info.label),
        students: studentsInSection(db, sectionId).map((s) => ({
          id: s.id, name: fullName(s), admissionNo: s.admissionNo, gender: s.gender, rollNo: currentEnrollment(db, s.id)?.rollNo ?? 0,
          attendancePct: attendanceStats(db, s.id).percentage,
        })),
        entries: session?.entries ?? null,
        markedBy,
        markedAt: session?.markedAt ?? null,
      };
    });
  },

  /**
   * Mark (no register yet) or edit/correct (register exists) a section's
   * attendance. Only the section's CLASS TEACHER may do either — enforced here,
   * against the live store, regardless of what the UI shows.
   */
  async saveRegister(sectionId: ID, date: string, entries: Record<ID, AttendanceStatus>) {
    return handle(() => {
      const actor = requireActor();
      if (date > todayISO()) throw invalid("Attendance cannot be marked for a future date.");
      if (!isSchoolDay(date)) throw invalid("Attendance can only be marked on school days.");
      return writeDb((db) => {
        const section = db.sections.find((s) => s.id === sectionId);
        const existing = db.attendance.find((a) => a.sectionId === sectionId && a.date === date);
        assertCanWriteAttendance(actor, section, !!existing);
        const roster = studentsInSection(db, sectionId);
        const missing = roster.filter((s) => !entries[s.id]);
        if (missing.length) throw invalid(`Mark attendance for all students (${missing.length} remaining).`);
        const clean: Record<ID, AttendanceStatus> = {};
        roster.forEach((s) => (clean[s.id] = entries[s.id]));
        const prev = existing?.entries ?? {};
        if (existing) Object.assign(existing, { entries: clean, markedById: actor.id, markedAt: new Date().toISOString() });
        else db.attendance.push({ id: newId("att"), sectionId, date, entries: clean, markedById: actor.id, markedAt: new Date().toISOString() });

        // Notify students/guardians whose status is absent or late (only when it changed).
        for (const s of roster) {
          const st = clean[s.id];
          if (st === "present" || prev[s.id] === st) continue;
          notify(db, accountsForStudent(db, s.id).map((u) => u.id), {
            category: "attendance",
            title: st === "absent" ? `${s.firstName} was marked absent` : `${s.firstName} was marked late`,
            message: `${formatDate(date)} · Class ${sectionInfo(db, sectionId).label}`,
            href: "/student/attendance",
          });
        }
        const counts = { present: 0, late: 0, absent: 0 };
        Object.values(clean).forEach((v) => (counts[v] += 1));
        return { ...counts, percentage: sessionPercentage(db, clean), updated: !!existing };
      });
    });
  },

  /** Section-by-section status for a date (admin: all sections, teacher: own). */
  async getDailyOverview(date: string) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, [...READ_PERMS, "reports:read"]);
      const db = readDb();
      const scope = scopeFor(actor, db);
      const yearClassIds = new Set(db.classes.filter((c) => c.academicYearId === db.school.currentAcademicYearId).map((c) => c.id));
      const rows = db.sections
        .filter((s) => yearClassIds.has(s.classId) && (scope.all || scope.sectionIds.has(s.id)))
        .map((s) => {
          const info = sectionInfo(db, s.id);
          const session = db.attendance.find((a) => a.sectionId === s.id && a.date === date);
          const counts = { present: 0, late: 0, absent: 0 };
          if (session) Object.values(session.entries).forEach((v) => (counts[v] += 1));
          return {
            sectionId: s.id, label: info.label, grade: info.cls?.grade ?? 0, students: studentsInSection(db, s.id).length,
            marked: !!session, ...counts, percentage: session ? sessionPercentage(db, session.entries) : null,
            isClassTeacher: s.classTeacherId === scope.teacherId,
            canMark: canMarkAttendance(actor, s),
          };
        })
        .sort((a, b) => a.grade - b.grade || a.label.localeCompare(b.label));
      const marked = rows.filter((r) => r.marked);
      const totals = marked.reduce((acc, r) => ({ present: acc.present + r.present, late: acc.late + r.late, absent: acc.absent + r.absent }), { present: 0, late: 0, absent: 0 });
      const total = totals.present + totals.late + totals.absent;
      const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
      return {
        date,
        rows,
        markedSections: marked.length,
        totalSections: rows.length,
        totals,
        percentage: total ? ((totals.present + (lateCounts ? totals.late : 0)) / total) * 100 : null,
      };
    });
  },

  /** Daily school-wide (or section) attendance % for the last N school days. */
  async getTrend(opts: { days?: number; sectionId?: ID } = {}) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, [...READ_PERMS, "reports:read"]);
      if (opts.sectionId) assertSectionInScope(actor, opts.sectionId);
      const db = readDb();
      const scope = scopeFor(actor, db);
      const byDate: Record<string, { ok: number; total: number }> = {};
      const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
      for (const s of db.attendance) {
        if (opts.sectionId ? s.sectionId !== opts.sectionId : !(scope.all || scope.sectionIds.has(s.sectionId))) continue;
        byDate[s.date] ??= { ok: 0, total: 0 };
        for (const v of Object.values(s.entries)) {
          byDate[s.date].total += 1;
          if (v === "present" || (lateCounts && v === "late")) byDate[s.date].ok += 1;
        }
      }
      return Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-(opts.days ?? 20))
        .map(([date, v]) => ({ date, percentage: v.total ? (v.ok / v.total) * 100 : 0, present: v.ok, total: v.total }));
    });
  },

  /** Past registers for a section (admin/teacher). */
  async getSectionHistory(sectionId: ID, limit = 15) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, [...READ_PERMS]);
      assertSectionInScope(actor, sectionId);
      const db = readDb();
      return db.attendance
        .filter((a) => a.sectionId === sectionId)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map((a) => {
          const counts = { present: 0, late: 0, absent: 0 };
          Object.values(a.entries).forEach((v) => (counts[v] += 1));
          const absentees = Object.entries(a.entries).filter(([, v]) => v === "absent").map(([id]) => {
            const s = db.students.find((x) => x.id === id);
            return s ? fullName(s) : id;
          });
          return { date: a.date, ...counts, percentage: sessionPercentage(db, a.entries), absentees, markedBy: db.users.find((u) => u.id === a.markedById)?.displayName ?? "Staff" };
        });
    });
  },

  /** A student's own attendance — students only for linked students. */
  async getStudentAttendance(studentId: ID) {
    return handle(() => {
      const actor = requireActor();
      if (actor.role === "student") {
        if (!actor.studentIds?.includes(studentId)) throw forbidden("You can only view your own attendance.");
      } else {
        requireAny(actor, [...READ_PERMS]);
        assertStudentInScope(actor, studentId);
      }
      const db = readDb();
      const enr = currentEnrollment(db, studentId);
      const records = db.attendance
        .filter((a) => a.sectionId === enr?.sectionId && a.entries[studentId])
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((a) => ({ date: a.date, status: a.entries[studentId] }));
      const monthly: Record<string, { month: string; present: number; late: number; absent: number; percentage: number }> = {};
      const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
      records.forEach((r) => {
        const k = r.date.slice(0, 7);
        monthly[k] ??= { month: k, present: 0, late: 0, absent: 0, percentage: 0 };
        monthly[k][r.status] += 1;
      });
      Object.values(monthly).forEach((m) => {
        const t = m.present + m.late + m.absent;
        m.percentage = t ? ((m.present + (lateCounts ? m.late : 0)) / t) * 100 : 0;
      });
      return {
        stats: attendanceStats(db, studentId),
        records,
        monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
        threshold: db.school.settings.lowAttendanceThreshold,
        lateCountsAsPresent: lateCounts,
      };
    });
  },

  async getLowAttendance(limit = 8) {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, [...READ_PERMS, "reports:read"]);
      const db = readDb();
      const scope = scopeFor(actor, db);
      const threshold = db.school.settings.lowAttendanceThreshold;
      return db.students
        .filter((s) => s.status === "active" && (scope.all || scope.studentIds.has(s.id)))
        .map((s) => ({ id: s.id, name: fullName(s), classLabel: sectionInfo(db, currentEnrollment(db, s.id)?.sectionId).label, percentage: attendanceStats(db, s.id).percentage }))
        .filter((s) => s.percentage !== null && s.percentage < threshold)
        .sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0))
        .slice(0, limit);
    });
  },
};

export type AttendanceService = typeof mockAttendanceService;
