import type { ID } from "@/types/domain";
import { readDb } from "@/lib/store/db";
import { GRADE_SCALE, gradeFor, percentOf } from "@/lib/utils/grades";
import { handle, requireActor, requireAny } from "./core";
import { attendanceStats, currentEnrollment, examResultFor, fullName, sectionInfo, studentsInSection } from "./derive";

/** All report figures are computed from live mock data — no static numbers. */
export const mockReportService = {
  async getStudentStatistics() {
    return handle(() => {
      requireAny(requireActor(), ["reports:read"]);
      const db = readDb();
      const yearId = db.school.currentAcademicYearId;
      const enrolled = db.students.filter((s) => db.enrollments.some((e) => e.studentId === s.id && e.academicYearId === yearId));
      const byClass = db.classes.filter((c) => c.academicYearId === yearId).sort((a, b) => a.grade - b.grade).map((c) => {
        const studs = enrolled.filter((s) => sectionInfo(db, currentEnrollment(db, s.id)?.sectionId).cls?.id === c.id && s.status === "active");
        return { name: `Class ${c.grade}`, male: studs.filter((s) => s.gender === "male").length, female: studs.filter((s) => s.gender === "female").length, total: studs.length };
      });
      const status = { active: 0, inactive: 0, transferred: 0, alumni: 0 } as Record<string, number>;
      enrolled.forEach((s) => (status[s.status] += 1));
      const bySection = db.sections.filter((s) => db.classes.find((c) => c.id === s.classId)?.academicYearId === yearId).map((s) => ({
        label: sectionInfo(db, s.id).label, students: studentsInSection(db, s.id).length, capacity: s.capacity,
      }));
      return { total: enrolled.length, byClass, status, bySection, parentContacts: new Set(db.guardianLinks.filter((l) => enrolled.some((s) => s.id === l.studentId)).map((l) => l.guardianId)).size };
    });
  },

  async getAttendanceReport() {
    return handle(() => {
      requireAny(requireActor(), ["reports:read"]);
      const db = readDb();
      const lateCounts = db.school.settings.attendanceLateCountsAsPresent;
      const monthly: Record<string, { ok: number; total: number; late: number; absent: number }> = {};
      const bySection: Record<string, { ok: number; total: number }> = {};
      for (const a of db.attendance) {
        const m = a.date.slice(0, 7);
        monthly[m] ??= { ok: 0, total: 0, late: 0, absent: 0 };
        bySection[a.sectionId] ??= { ok: 0, total: 0 };
        for (const v of Object.values(a.entries)) {
          monthly[m].total += 1; bySection[a.sectionId].total += 1;
          if (v === "present" || (lateCounts && v === "late")) { monthly[m].ok += 1; bySection[a.sectionId].ok += 1; }
          if (v === "late") monthly[m].late += 1;
          if (v === "absent") monthly[m].absent += 1;
        }
      }
      const threshold = db.school.settings.lowAttendanceThreshold;
      const students = db.students.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: fullName(s), classLabel: sectionInfo(db, currentEnrollment(db, s.id)?.sectionId).label, ...attendanceStats(db, s.id) }));
      const bands = [
        { band: "95–100%", min: 95, max: 101 }, { band: "90–95%", min: 90, max: 95 }, { band: "85–90%", min: 85, max: 90 },
        { band: "75–85%", min: 75, max: 85 }, { band: "Below 75%", min: 0, max: 75 },
      ].map((b) => ({ band: b.band, students: students.filter((s) => s.percentage !== null && s.percentage >= b.min && s.percentage < b.max).length }));
      return {
        monthly: Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
          month: new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }), percentage: v.total ? (v.ok / v.total) * 100 : 0, late: v.late, absent: v.absent,
        })),
        bySection: Object.entries(bySection).map(([id, v]) => ({ label: sectionInfo(db, id).label, grade: sectionInfo(db, id).cls?.grade ?? 0, percentage: v.total ? (v.ok / v.total) * 100 : 0 }))
          .sort((a, b) => a.grade - b.grade || a.label.localeCompare(b.label)),
        bands,
        lowAttendance: students.filter((s) => s.percentage !== null && s.percentage < threshold).sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0)),
        threshold,
      };
    });
  },

  async getExamPerformance(examId?: ID) {
    return handle(() => {
      requireAny(requireActor(), ["reports:read"]);
      const db = readDb();
      const exams = db.exams.filter((e) => e.academicYearId === db.school.currentAcademicYearId && e.status !== "scheduled" && e.status !== "draft").sort((a, b) => b.startDate.localeCompare(a.startDate));
      const exam = exams.find((e) => e.id === examId) ?? exams.find((e) => e.status === "published") ?? exams[0];
      if (!exam) return { exams: [], exam: null, byClass: [], bySubject: [], gradeDistribution: [], toppers: [], passRate: null };
      const students = db.students.filter((s) => s.status === "active");
      const results = students.map((s) => ({ s, r: examResultFor(db, s.id, exam) })).filter((x) => x.r && x.r.percentage !== null) as { s: (typeof students)[number]; r: NonNullable<ReturnType<typeof examResultFor>> }[];
      const byClass = db.classes.filter((c) => exam.classIds.includes(c.id)).sort((a, b) => a.grade - b.grade).map((c) => {
        const rs = results.filter((x) => sectionInfo(db, currentEnrollment(db, x.s.id)?.sectionId).cls?.id === c.id);
        const avg = rs.length ? rs.reduce((a, x) => a + (x.r.percentage ?? 0), 0) / rs.length : 0;
        return { name: `Class ${c.grade}`, average: avg, highest: rs.length ? Math.max(...rs.map((x) => x.r.percentage ?? 0)) : 0 };
      });
      const bySubject = db.subjects.map((sub) => {
        const vals: number[] = [];
        results.forEach((x) => x.r.rows.forEach((row) => { if (row.subjectId === sub.id && row.marks !== null) vals.push(percentOf(row.marks, row.maxMarks)); }));
        return { subject: sub.name, average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, count: vals.length };
      }).filter((x) => x.count > 0);
      const gradeDistribution = GRADE_SCALE.map((g) => ({ grade: g.grade, students: results.filter((x) => gradeFor(x.r.percentage ?? 0).grade === g.grade).length }));
      const toppers = [...results].sort((a, b) => (b.r.percentage ?? 0) - (a.r.percentage ?? 0)).slice(0, 5).map((x) => ({ id: x.s.id, name: fullName(x.s), classLabel: sectionInfo(db, currentEnrollment(db, x.s.id)?.sectionId).label, percentage: x.r.percentage, grade: x.r.grade }));
      const complete = results.filter((x) => x.r.passed !== null);
      return {
        exams: exams.map((e) => ({ id: e.id, name: e.name, status: e.status })),
        exam,
        byClass,
        bySubject,
        gradeDistribution,
        toppers,
        passRate: complete.length ? (complete.filter((x) => x.r.passed).length / complete.length) * 100 : null,
      };
    });
  },

  /** Exam-over-exam average per subject (academic performance trend). */
  async getAcademicTrend() {
    return handle(() => {
      requireAny(requireActor(), ["reports:read"]);
      const db = readDb();
      const exams = db.exams.filter((e) => e.academicYearId === db.school.currentAcademicYearId && e.status !== "scheduled" && e.status !== "draft").sort((a, b) => a.startDate.localeCompare(b.startDate));
      return exams.map((e) => {
        const row: Record<string, string | number> = { exam: e.name };
        for (const sub of db.subjects) {
          const vals: number[] = [];
          const papers = db.examPapers.filter((p) => p.examId === e.id && p.subjectId === sub.id);
          for (const p of papers) db.marks.filter((m) => m.paperId === p.id && m.marks !== null).forEach((m) => vals.push(percentOf(m.marks!, p.maxMarks)));
          row[sub.name] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
        }
        return row;
      });
    });
  },
};

export type ReportService = typeof mockReportService;
