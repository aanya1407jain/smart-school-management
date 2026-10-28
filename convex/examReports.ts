/**
 * Examination reports (Examinations): performance of a published exam. Moved from convex/reports.ts.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { moduleQuery } from "./core/functions";
import { requireModule } from "./model/modules";
import { getInSchool, requirePermission } from "./core/authorization";
import { conflict } from "./core/errors";

const administrationQuery = moduleQuery("administration");

export const examPerformance = administrationQuery({
  args: { examId: v.id("exams") },
  handler: async (ctx, { examId }) => {
    await requireModule(ctx, ctx.actor.schoolId, "academics"); // data comes from that module (administration checked by the wrapper)
    requirePermission(ctx.actor, "reports:read");
    const exam = await getInSchool(ctx, "exams", examId, "Exam");
    if (exam.status !== "published") throw conflict("Performance reports use published results only.");
    const sections = new Map<Id<"sections">, { results: Doc<"results">[] }>();
    for (const classId of exam.classIds) {
      const secs = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", classId).eq("academicYearId", exam.academicYearId)).collect();
      for (const s of secs.filter((x) => x.schoolId === ctx.actor.schoolId)) {
        sections.set(s._id, { results: await ctx.db.query("results").withIndex("by_exam_section", (q) => q.eq("examId", exam._id).eq("sectionId", s._id)).collect() });
      }
    }
    const all = [...sections.values()].flatMap((s) => s.results);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
    const subjectStats = new Map<Id<"subjects">, { pct: number[]; passed: number; sat: number }>();
    for (const r of all) {
      for (const s of r.subjects) {
        const st = subjectStats.get(s.subjectId) ?? { pct: [], passed: 0, sat: 0 };
        st.sat++;
        if (s.passed) st.passed++;
        st.pct.push(s.isAbsent ? 0 : ((s.marks ?? 0) / s.maxMarks) * 100);
        subjectStats.set(s.subjectId, st);
      }
    }
    const subjects = [];
    for (const [subjectId, st] of subjectStats) {
      const subj = await ctx.db.get(subjectId);
      subjects.push({ subjectId, subject: subj?.name ?? "", averagePercentage: avg(st.pct), passRate: st.sat ? Math.round((st.passed / st.sat) * 1000) / 10 : null, students: st.sat });
    }
    const sectionRows = [];
    for (const [sectionId, { results }] of sections) {
      const s = await ctx.db.get(sectionId);
      sectionRows.push({ sectionId, section: s?.displayName ?? "", students: results.length, averagePercentage: avg(results.map((r) => r.percentage)), passRate: results.length ? Math.round((results.filter((r) => r.subjects.every((x) => x.passed)).length / results.length) * 1000) / 10 : null });
    }
    return {
      examId: exam._id, name: exam.name, students: all.length, averagePercentage: avg(all.map((r) => r.percentage)),
      passRate: all.length ? Math.round((all.filter((r) => r.subjects.every((x) => x.passed)).length / all.length) * 1000) / 10 : null,
      subjects: subjects.sort((a, b) => a.subject.localeCompare(b.subject)),
      sections: sectionRows.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true })),
    };
  },
});
