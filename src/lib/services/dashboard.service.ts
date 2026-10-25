import type { Database, ID, Weekday } from "@/types/domain";
import { readDb } from "@/lib/store/db";
import { canMarkAttendance } from "@/lib/permissions";
import { todayISO, previousSchoolDay, nextSchoolDay, dayOfWeek, isSchoolDay, addDays } from "@/lib/utils/dates";
import { forbidden, handle, requireActor, requireAny, requirePermission, scopeFor } from "./core";
import {
  attendanceStats, currentEnrollment, examResultFor, feeLedger, fullName, homeworkStatusFor, noticeVisibleTo, sectionInfo,
  sessionPercentage, studentsInSection, teacherName, audienceLabel,
} from "./derive";

function latestMarkedDate(db: Database, sectionIds?: Set<ID>): string | null {
  let latest: string | null = null;
  for (const a of db.attendance) {
    if (sectionIds && !sectionIds.has(a.sectionId)) continue;
    if (!latest || a.date > latest) latest = a.date;
  }
  return latest;
}

function attendanceForDate(db: Database, date: string, sectionIds?: Set<ID>) {
  const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
  let ok = 0, total = 0, marked = 0, absent = 0;
  for (const a of db.attendance) {
    if (a.date !== date || (sectionIds && !sectionIds.has(a.sectionId))) continue;
    marked += 1;
    for (const v of Object.values(a.entries)) {
      total += 1;
      if (v === "present" || (lateCounts && v === "late")) ok += 1;
      if (v === "absent") absent += 1;
    }
  }
  return { percentage: total ? (ok / total) * 100 : null, marked, absent, total };
}

function trend(db: Database, days: number, sectionIds?: Set<ID>) {
  const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
  const byDate: Record<string, { ok: number; total: number }> = {};
  for (const a of db.attendance) {
    if (sectionIds && !sectionIds.has(a.sectionId)) continue;
    byDate[a.date] ??= { ok: 0, total: 0 };
    for (const v of Object.values(a.entries)) {
      byDate[a.date].total += 1;
      if (v === "present" || (lateCounts && v === "late")) byDate[a.date].ok += 1;
    }
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).slice(-days).map(([date, v]) => ({ date, percentage: v.total ? (v.ok / v.total) * 100 : 0 }));
}

function scheduleDay(today: string): { date: string; weekday: Weekday; isToday: boolean } {
  const date = isSchoolDay(today) ? today : nextSchoolDay(today);
  return { date, weekday: dayOfWeek(date) as Weekday, isToday: date === today };
}

export const mockDashboardService = {
  async getAdminDashboard() {
    return handle(() => {
      const actor = requireActor();
      requireAny(actor, ["reports:read", "fees:manage"]);
      const db = readDb();
      const today = todayISO();
      const yearId = db.school.currentAcademicYearId;
      const activeStudents = db.students.filter((s) => s.status === "active" && db.enrollments.some((e) => e.studentId === s.id && e.academicYearId === yearId));
      const yearClassIds = new Set(db.classes.filter((c) => c.academicYearId === yearId).map((c) => c.id));
      const yearSections = db.sections.filter((s) => yearClassIds.has(s.classId));

      // Attendance — today if anything has been marked, otherwise the last school day.
      const todayAtt = attendanceForDate(db, today);
      const attDate = todayAtt.marked > 0 ? today : latestMarkedDate(db) ?? previousSchoolDay(today);
      const att = todayAtt.marked > 0 ? todayAtt : attendanceForDate(db, attDate);
      const prevDate = latestMarkedDate(db, undefined) && attDate ? previousSchoolDay(addDays(attDate, -1)) : null;
      const prevAtt = prevDate ? attendanceForDate(db, prevDate) : null;

      // Fees
      let outstanding = 0, overdue = 0, overdueStudents = 0, collected = 0, net = 0;
      for (const s of activeStudents) {
        const l = feeLedger(db, s.id, today);
        outstanding += l.totals.outstanding; overdue += l.totals.overdue; collected += l.totals.paid; net += l.totals.net;
        if (l.totals.overdue > 0) overdueStudents += 1;
      }
      const feeByClass = db.classes.filter((c) => yearClassIds.has(c.id)).sort((a, b) => a.grade - b.grade).map((c) => {
        let paid = 0, due = 0;
        activeStudents.filter((s) => sectionInfo(db, currentEnrollment(db, s.id)?.sectionId).cls?.id === c.id).forEach((s) => {
          const l = feeLedger(db, s.id, today);
          paid += l.totals.paid; due += l.totals.outstanding;
        });
        return { name: `Class ${c.grade}`, collected: paid, outstanding: due };
      });

      // Academic performance — class averages for the latest published exam.
      const lastPublished = db.exams.filter((e) => e.status === "published" && e.academicYearId === yearId).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
      const performance = lastPublished
        ? db.classes.filter((c) => lastPublished.classIds.includes(c.id)).sort((a, b) => a.grade - b.grade).map((c) => {
            const studs = activeStudents.filter((s) => sectionInfo(db, currentEnrollment(db, s.id)?.sectionId).cls?.id === c.id);
            const pcts = studs.map((s) => examResultFor(db, s.id, lastPublished)?.percentage).filter((p): p is number => p !== null && p !== undefined);
            return { name: `Class ${c.grade}`, average: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0 };
          })
        : [];

      const upcomingExams = db.exams
        .filter((e) => e.academicYearId === yearId && e.status !== "published" && e.endDate >= addDays(today, -30))
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map((e) => {
          const papers = db.examPapers.filter((p) => p.examId === e.id);
          let slots = 0, done = 0;
          if (e.status === "marks_entry" || e.status === "in_progress") {
            for (const p of papers) for (const s of yearSections.filter((x) => x.classId === p.classId)) {
              slots += 1;
              const roster = studentsInSection(db, s.id);
              if (roster.length && roster.every((st) => db.marks.some((m) => m.paperId === p.id && m.studentId === st.id))) done += 1;
            }
          }
          return { id: e.id, name: e.name, status: e.status, startDate: e.startDate, endDate: e.endDate, classCount: e.classIds.length, paperCount: papers.length, marksProgress: slots ? (done / slots) * 100 : null };
        });

      const notices = db.notices.filter((n) => n.status === "published" && n.publishDate <= today).sort((a, b) => b.publishDate.localeCompare(a.publishDate)).slice(0, 4)
        .map((n) => ({ ...n, audienceLabel: audienceLabel(db, n) }));

      const unmarkedToday = isSchoolDay(today) ? yearSections.filter((s) => !db.attendance.some((a) => a.sectionId === s.id && a.date === today)).length : 0;
      const pendingLeave = db.leaveRequests.filter((l) => l.status === "pending").length;

      const registered = db.students.length;
      const activeCount = db.students.filter((s) => s.status === "active").length;
      const tcIssued = db.students.filter((s) => s.status === "transferred").length;
      const alumni = db.students.filter((s) => s.status === "alumni").length;
      const inactive = db.students.filter((s) => s.status === "inactive").length;

      const admissionsByMonth: Record<string, number> = {};
      for (const s of db.students) {
        if (s.admissionDate) {
          const m = s.admissionDate.slice(0, 7);
          admissionsByMonth[m] = (admissionsByMonth[m] ?? 0) + 1;
        }
      }
      const admissionsOverTime = Object.entries(admissionsByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, count]) => ({ month, count }));

      const classSectionTotals = db.classes
        .filter((c) => yearClassIds.has(c.id))
        .sort((a, b) => a.grade - b.grade)
        .map((cls) => {
          const clsSecs = yearSections.filter((s) => s.classId === cls.id);
          const secStats = clsSecs.map((sec) => {
            const studs = studentsInSection(db, sec.id);
            return {
              sectionId: sec.id,
              name: sec.name,
              studentCount: studs.length,
              capacity: sec.capacity ?? 40,
            };
          });
          return {
            classId: cls.id,
            className: cls.name,
            level: cls.grade,
            studentCount: secStats.reduce((sum, s) => sum + s.studentCount, 0),
            capacity: secStats.reduce((sum, s) => sum + s.capacity, 0),
            sections: secStats,
          };
        });

      const performanceAverage = performance.length
        ? Math.round((performance.reduce((sum, p) => sum + p.average, 0) / performance.length) * 10) / 10
        : null;

      return {
        school: db.school,
        stats: {
          students: activeStudents.length,
          sections: yearSections.length,
          teachers: db.teachers.filter((t) => t.status !== "inactive").length,
          teachersOnLeave: db.teachers.filter((t) => t.status === "on_leave").length,
          attendance: { date: attDate, isToday: attDate === today, percentage: att.percentage, absent: att.absent, marked: att.marked, totalSections: yearSections.length, delta: att.percentage !== null && prevAtt?.percentage != null ? att.percentage - prevAtt.percentage : null },
          fees: { outstanding, overdue, overdueStudents, collected, collectionRate: net ? (collected / net) * 100 : 0 },
        },
        studentBreakdown: {
          registered,
          active: activeCount,
          tcIssued,
          alumni,
          inactive,
        },
        admissionsOverTime,
        classSectionTotals,
        academicPerformanceAverage: performanceAverage,
        attendanceTrend: trend(db, 15),
        feeByClass,
        performance: { examName: lastPublished?.name ?? null, rows: performance },
        upcomingExams,
        notices,
        tasks: { unmarkedToday, pendingLeave, isSchoolDay: isSchoolDay(today) },
      };
    });
  },

  async getTeacherDashboard() {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "area:teacher");
      const db = readDb();
      const scope = scopeFor(actor, db);
      const t = db.teachers.find((x) => x.id === actor.teacherId);
      if (!t) throw forbidden();
      const today = todayISO();
      const day = scheduleDay(today);
      const yearId = db.school.currentAcademicYearId;

      const classes = db.timetable
        .filter((e) => e.teacherId === t.id && e.day === day.weekday)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((e) => ({ ...e, subject: db.subjects.find((s) => s.id === e.subjectId)!.name, sectionLabel: sectionInfo(db, e.sectionId).label }));

      const assignments = db.teacherAssignments
        .filter((a) => a.teacherId === t.id && a.academicYearId === yearId)
        .map((a) => ({ id: a.id, sectionId: a.sectionId, subjectId: a.subjectId, subject: db.subjects.find((s) => s.id === a.subjectId)!.name, sectionLabel: sectionInfo(db, a.sectionId).label, grade: sectionInfo(db, a.sectionId).cls?.grade ?? 0, students: studentsInSection(db, a.sectionId).length }))
        .sort((a, b) => a.grade - b.grade || a.sectionLabel.localeCompare(b.sectionLabel));

      // Attendance tasks: only sections this teacher OWNS as class teacher.
      const attendanceTasks = Array.from(scope.sectionIds).filter((sid) => canMarkAttendance(actor, db.sections.find((s) => s.id === sid))).map((sid) => {
        const sec = db.sections.find((s) => s.id === sid)!;
        const session = db.attendance.find((a) => a.sectionId === sid && a.date === today);
        return { sectionId: sid, label: sectionInfo(db, sid).label, grade: sectionInfo(db, sid).cls?.grade ?? 0, isClassTeacher: sec.classTeacherId === t.id, marked: !!session, percentage: session ? sessionPercentage(db, session.entries) : null, students: studentsInSection(db, sid).length };
      }).sort((a, b) => Number(b.isClassTeacher) - Number(a.isClassTeacher) || a.grade - b.grade || a.label.localeCompare(b.label));

      const homework = db.homework
        .filter((h) => h.teacherId === t.id && h.status === "active")
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map((h) => {
          const subs = db.submissions.filter((s) => s.homeworkId === h.id);
          return { id: h.id, title: h.title, dueDate: h.dueDate, subject: db.subjects.find((s) => s.id === h.subjectId)!.name, sectionLabel: sectionInfo(db, h.sectionId).label, submitted: subs.length, toReview: subs.filter((s) => s.status !== "reviewed").length, total: studentsInSection(db, h.sectionId).length };
        });

      const notices = db.notices.filter((n) => n.publishDate <= today && noticeVisibleTo(db, n, actor)).sort((a, b) => b.publishDate.localeCompare(a.publishDate)).slice(0, 4)
        .map((n) => ({ ...n, audienceLabel: audienceLabel(db, n) }));

      return {
        teacher: { id: t.id, name: teacherName(t), firstName: t.firstName, title: t.title, designation: t.designation },
        day,
        isSchoolDay: isSchoolDay(today),
        classes,
        assignments,
        attendanceTasks,
        homework,
        notices,
        studentCount: scope.studentIds.size,
      };
    });
  },

  async getStudentDashboard(studentId: ID) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "area:student");
      if (!actor.studentIds?.includes(studentId)) throw forbidden("You can only view your own dashboard.");
      const db = readDb();
      const s = db.students.find((x) => x.id === studentId);
      if (!s) throw forbidden();
      const today = todayISO();
      const enr = currentEnrollment(db, studentId);
      const info = sectionInfo(db, enr?.sectionId);
      const day = scheduleDay(today);
      const ct = db.teachers.find((x) => x.id === info.section?.classTeacherId);

      const timetable = db.timetable
        .filter((e) => e.sectionId === enr?.sectionId && e.day === day.weekday)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((e) => ({ ...e, subject: db.subjects.find((x) => x.id === e.subjectId)!.name, teacher: teacherName(db.teachers.find((x) => x.id === e.teacherId)!) }));
      const nowHHMM = new Date().toTimeString().slice(0, 5);
      const upcomingClass = day.isToday ? timetable.find((e) => e.endTime > nowHHMM) ?? null : timetable[0] ?? null;

      const homework = db.homework
        .filter((h) => h.sectionId === enr?.sectionId && h.status === "active")
        .map((h) => ({ id: h.id, title: h.title, dueDate: h.dueDate, subject: db.subjects.find((x) => x.id === h.subjectId)!.name, status: homeworkStatusFor(h, db.submissions.find((x) => x.homeworkId === h.id && x.studentId === studentId), today) }))
        .filter((h) => h.status === "pending" || h.status === "overdue")
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      const nextPaper = db.examPapers
        .filter((p) => p.classId === info.cls?.id && p.date >= today && db.exams.find((e) => e.id === p.examId)?.status !== "draft")
        .sort((a, b) => a.date.localeCompare(b.date))[0];

      const latestExam = db.exams.filter((e) => e.status === "published" && e.academicYearId === db.school.currentAcademicYearId).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0];
      const latestResult = latestExam ? examResultFor(db, studentId, latestExam) : null;

      const ledger = feeLedger(db, studentId, today);
      const notices = db.notices.filter((n) => n.publishDate <= today && noticeVisibleTo(db, n, actor)).sort((a, b) => b.publishDate.localeCompare(a.publishDate)).slice(0, 3)
        .map((n) => ({ ...n, audienceLabel: audienceLabel(db, n) }));

      return {
        student: { id: s.id, name: fullName(s), firstName: s.firstName, admissionNo: s.admissionNo, classLabel: info.label, grade: info.cls?.grade ?? null, section: info.section?.name ?? null, rollNo: enr?.rollNo ?? null, classTeacher: ct ? teacherName(ct) : null, room: info.section?.room ?? null },
        isGuardian: !!actor.guardianId,
        attendance: { ...attendanceStats(db, studentId), threshold: db.school.settings.lowAttendanceThreshold },
        day,
        timetable,
        upcomingClass,
        homework,
        nextExam: nextPaper ? { examName: db.exams.find((e) => e.id === nextPaper.examId)!.name, subject: db.subjects.find((x) => x.id === nextPaper.subjectId)!.name, date: nextPaper.date, startTime: nextPaper.startTime, maxMarks: nextPaper.maxMarks } : null,
        latestResult,
        fees: { ...ledger.totals, standing: ledger.standing, nextDue: ledger.nextDue },
        notices,
      };
    });
  },

  /** Teacher: every section they teach or are class teacher of. */
  async getTeacherClasses() {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "students:read:assigned");
      const db = readDb();
      const scope = scopeFor(actor, db);
      const today = todayISO();
      return Array.from(scope.sectionIds).map((sid) => {
        const info = sectionInfo(db, sid);
        const subjects = db.teacherAssignments.filter((a) => a.sectionId === sid && a.teacherId === scope.teacherId).map((a) => db.subjects.find((s) => s.id === a.subjectId)!.name);
        const roster = studentsInSection(db, sid);
        const session = db.attendance.find((a) => a.sectionId === sid && a.date === today);
        const pcts = roster.map((s) => attendanceStats(db, s.id).percentage).filter((p): p is number => p !== null);
        return {
          sectionId: sid, label: info.label, grade: info.cls?.grade ?? 0, room: info.section?.room ?? "", isClassTeacher: info.section?.classTeacherId === scope.teacherId,
          subjects, students: roster.length, avgAttendance: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
          markedToday: !!session, activeHomework: db.homework.filter((h) => h.sectionId === sid && h.teacherId === scope.teacherId && h.status === "active").length,
        };
      }).sort((a, b) => Number(b.isClassTeacher) - Number(a.isClassTeacher) || a.grade - b.grade || a.label.localeCompare(b.label));
    });
  },

  /** Teacher: one of their sections in detail. Other sections → FORBIDDEN. */
  async getTeacherClass(sectionId: ID) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "students:read:assigned");
      const db = readDb();
      const scope = scopeFor(actor, db);
      if (!scope.sectionIds.has(sectionId)) throw forbidden("This class is not assigned to you, so its details aren't available.");
      const info = sectionInfo(db, sectionId);
      const ct = db.teachers.find((t) => t.id === info.section?.classTeacherId);
      const roster = studentsInSection(db, sectionId).map((s) => {
        const enr = currentEnrollment(db, s.id);
        const g = db.guardianLinks.find((l) => l.studentId === s.id && l.isPrimary);
        const guardian = g ? db.guardians.find((x) => x.id === g.guardianId) : undefined;
        const hwPending = db.homework.filter((h) => h.sectionId === sectionId && h.teacherId === scope.teacherId && h.status === "active" && !db.submissions.some((x) => x.homeworkId === h.id && x.studentId === s.id)).length;
        return { id: s.id, name: fullName(s), admissionNo: s.admissionNo, gender: s.gender, rollNo: enr?.rollNo ?? 0, attendance: attendanceStats(db, s.id).percentage, guardianName: guardian?.name ?? null, guardianPhone: guardian?.phone ?? null, homeworkPending: hwPending };
      });
      const subjects = db.teacherAssignments.filter((a) => a.sectionId === sectionId).map((a) => {
        const t = db.teachers.find((x) => x.id === a.teacherId)!;
        return { subject: db.subjects.find((s) => s.id === a.subjectId)!.name, subjectId: a.subjectId, teacher: teacherName(t), mine: a.teacherId === scope.teacherId };
      }).sort((a, b) => Number(b.mine) - Number(a.mine) || a.subject.localeCompare(b.subject));
      return {
        sectionId, label: info.label, longLabel: info.longLabel, room: info.section?.room ?? "", classTeacher: ct ? teacherName(ct) : null,
        isClassTeacher: ct?.id === scope.teacherId, roster, subjects,
        homework: db.homework.filter((h) => h.sectionId === sectionId && h.teacherId === scope.teacherId).sort((a, b) => b.assignedOn.localeCompare(a.assignedOn)).slice(0, 5)
          .map((h) => ({ id: h.id, title: h.title, dueDate: h.dueDate, subject: db.subjects.find((s) => s.id === h.subjectId)!.name, submitted: db.submissions.filter((x) => x.homeworkId === h.id).length, total: roster.length })),
        markedToday: db.attendance.some((a) => a.sectionId === sectionId && a.date === todayISO()),
      };
    });
  },

  /** For guardian accounts: the students linked to this login. */
  async getLinkedStudents() {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      return (actor.studentIds ?? []).map((id) => {
        const s = db.students.find((x) => x.id === id)!;
        return { id, name: fullName(s), firstName: s.firstName, classLabel: sectionInfo(db, currentEnrollment(db, id)?.sectionId).label };
      });
    });
  },
};

export type DashboardService = typeof mockDashboardService;
export type AdminDashboard = Awaited<ReturnType<DashboardService["getAdminDashboard"]>>;
export type TeacherDashboard = Awaited<ReturnType<DashboardService["getTeacherDashboard"]>>;
export type StudentDashboard = Awaited<ReturnType<DashboardService["getStudentDashboard"]>>;
