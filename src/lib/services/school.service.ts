import type { School, SchoolSettings } from "@/types/domain";
import { readDb, resetDb, writeDb } from "@/lib/store/db";
import { forbidden, handle, invalid, requireActor, requirePermission } from "./core";
import { currentEnrollment, fullName, primaryGuardian, schoolEmailDomain, sectionInfo, teacherName } from "./derive";

export type SchoolInfoInput = Pick<School, "name" | "tagline" | "address" | "phone" | "email" | "website" | "affiliation" | "principalName">;

export const mockSchoolService = {
  /**
   * The tenant's public identity (shown on splash, login and the app chrome).
   * Intentionally unauthenticated — in Stage 2 this is resolved from the
   * school's domain/subdomain before anyone signs in.
   */
  async getPublicProfile() {
    return handle(() => {
      const { school } = readDb();
      return { name: school.name, shortName: school.shortName, tagline: school.tagline, emailDomain: schoolEmailDomain(school) };
    });
  },

  async updateInfo(input: SchoolInfoInput) {
    return handle(() => {
      requirePermission(requireActor(), "settings:manage");
      const e: Record<string, string> = {};
      if (!input.name.trim()) e.name = "School name is required";
      if (!/^\S+@\S+\.\S+$/.test(input.email)) e.email = "Enter a valid email";
      if (Object.keys(e).length) throw invalid("Please fix the highlighted fields.", e);
      return writeDb((db) => {
        Object.assign(db.school, input);
        return { ok: true };
      });
    });
  },

  async updateSettings(settings: SchoolSettings) {
    return handle(() => {
      requirePermission(requireActor(), "settings:manage");
      if (settings.lowAttendanceThreshold < 50 || settings.lowAttendanceThreshold > 100) throw invalid("Threshold must be between 50 and 100", { lowAttendanceThreshold: "50–100" });
      return writeDb((db) => {
        db.school.settings = settings;
        return { ok: true };
      });
    });
  },

  async resetDemoData() {
    requirePermission(requireActor(), "settings:manage");
    resetDb();
  },

  /** The signed-in user's own profile (role-specific details). */
  async getMyProfile(studentId?: string) {
    return handle(() => {
      const actor = requireActor();
      const db = readDb();
      const base = { id: actor.id, displayName: actor.displayName, email: actor.email, phone: actor.phone, role: actor.role, title: actor.title ?? null };
      if (actor.role === "teacher") {
        const t = db.teachers.find((x) => x.id === actor.teacherId)!;
        return { ...base, kind: "teacher" as const, teacherId: t.id, name: teacherName(t) };
      }
      if (actor.role === "student") {
        const sid = studentId ?? actor.studentIds?.[0];
        if (!sid || !actor.studentIds?.includes(sid)) throw forbidden();
        const s = db.students.find((x) => x.id === sid)!;
        const enr = currentEnrollment(db, sid);
        return {
          ...base, kind: "student" as const, student: s, name: fullName(s), classLabel: sectionInfo(db, enr?.sectionId).longLabel, rollNo: enr?.rollNo ?? null,
          guardian: primaryGuardian(db, sid),
        };
      }
      return { ...base, kind: "admin" as const };
    });
  },

  async updateMyContact(input: { displayName: string; phone: string }) {
    return handle(() => {
      const actor = requireActor();
      if (!input.displayName.trim()) throw invalid("Name is required", { displayName: "Required" });
      if (!/^[+\d\s-]{8,}$/.test(input.phone)) throw invalid("Enter a valid phone number", { phone: "Invalid phone" });
      return writeDb((db) => {
        const u = db.users.find((x) => x.id === actor.id)!;
        u.phone = input.phone.trim();
        if (actor.role === "admin") u.displayName = input.displayName.trim();
        if (actor.teacherId) {
          const t = db.teachers.find((x) => x.id === actor.teacherId);
          if (t) t.phone = input.phone.trim();
        }
        return { ok: true };
      });
    });
  },

  // Password changes are handled by Convex Auth (convex/account.ts → changePassword).
};

export type SchoolService = typeof mockSchoolService;
