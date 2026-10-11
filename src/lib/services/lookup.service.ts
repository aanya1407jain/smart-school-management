import { readDb } from "@/lib/store/db";
import { handle, requireActor, scopeFor } from "./core";
import { sectionInfo, teacherName } from "./derive";

/**
 * Reference data used by forms and filters (years, classes, sections,
 * subjects, teachers). Sections are scoped: teachers only receive their own.
 */
export const mockLookupService = {
  async getSchool() {
    return handle(() => {
      requireActor();
      const db = readDb();
      const year = db.academicYears.find((y) => y.id === db.school.currentAcademicYearId)!;
      return { school: db.school, currentYear: year };
    });
  },

  async getAcademicOptions() {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const scope = scopeFor(actor, db);
      const yearClassIds = new Set(db.classes.filter((c) => c.academicYearId === db.school.currentAcademicYearId).map((c) => c.id));
      const sections = db.sections
        .filter((s) => yearClassIds.has(s.classId) && (scope.all || scope.sectionIds.has(s.id)))
        .map((s) => {
          const info = sectionInfo(db, s.id);
          return { id: s.id, classId: s.classId, name: s.name, label: info.label, grade: info.cls?.grade ?? 0, room: s.room };
        })
        .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name));
      const classIds = new Set(sections.map((s) => s.classId));
      return {
        years: db.academicYears,
        currentYearId: db.school.currentAcademicYearId,
        classes: db.classes.filter((c) => classIds.has(c.id)).sort((a, b) => a.grade - b.grade),
        sections,
        subjects: db.subjects,
        periods: db.periods,
        teachers: actor.role === "admin"
          ? db.teachers.filter((t) => t.status !== "inactive").map((t) => ({ id: t.id, name: teacherName(t), specializationIds: t.specializationIds }))
          : [],
      };
    });
  },
};

export type LookupService = typeof mockLookupService;
export type AcademicOptions = Awaited<ReturnType<LookupService["getAcademicOptions"]>>;
