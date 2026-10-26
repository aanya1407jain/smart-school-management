/**
 * The signed-in STAFF member's own profile (admin and teacher portals).
 * Students use the student-portal profile (studentPortal.ts).
 *
 *  - mine:       account (Login ID, role, accountant-only flag) and, for a
 *                teacher, their own teacher record and current-year duties.
 *  - updateMine: an administrator may change their display name; a teacher may
 *                change the phone number on their own teacher record. Names,
 *                employee IDs and contact emails of teachers are managed by
 *                the school office (staff.updateTeacher). Audited.
 * Password changes go through account.changePassword (Convex Auth).
 */
import { v } from "convex/values";
import { schoolMutation, schoolQuery } from "./core/functions";
import { forbidden, invalid } from "./core/errors";
import { requirePermission } from "./core/authorization";
import { assertNonEmpty } from "./core/validators";
import { isAccountantOnly } from "./core/permissions";
import { teacherDisplayName } from "./model/academics";
import { writeAudit } from "./model/audit";

export const mine = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "profile:read:own");
    if (ctx.actor.role === "student") throw forbidden("Use the student portal profile.");
    const m = (await ctx.db.get(ctx.actor.membershipId))!;
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const t = ctx.actor.teacherId ? await ctx.db.get(ctx.actor.teacherId) : null;
    const teacher = t && t.schoolId === ctx.actor.schoolId ? t : null;
    let duties: { classTeacherOf: string[]; subjects: string[] } | null = null;
    if (teacher) {
      const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", ctx.actor.schoolId)).unique();
      const yearId = settings?.currentAcademicYearId;
      const classTeacherOf: string[] = [];
      const subjects: string[] = [];
      if (yearId) {
        for (const s of await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacher._id).eq("academicYearId", yearId)).collect()) {
          if (s.schoolId === ctx.actor.schoolId) classTeacherOf.push(s.displayName);
        }
        for (const a of await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacher._id).eq("academicYearId", yearId)).collect()) {
          if (a.schoolId !== ctx.actor.schoolId) continue;
          const [sec, sub] = [await ctx.db.get(a.sectionId), await ctx.db.get(a.subjectId)];
          subjects.push(`${sub?.name ?? "Subject"} · ${sec?.displayName ?? ""}`);
        }
      }
      duties = { classTeacherOf: classTeacherOf.sort(), subjects: subjects.sort() };
    }
    return {
      displayName: m.displayName,
      loginId: m.loginId ?? null,
      email: m.email ?? null,
      role: m.role,
      accountantOnly: isAccountantOnly(m.role, m.permissionSets),
      school: school.name,
      canRename: m.role === "admin",
      canEditPhone: !!teacher,
      teacher: teacher ? {
        name: teacherDisplayName(teacher), employeeId: teacher.employeeId, designation: teacher.designation ?? null, qualification: teacher.qualification ?? null,
        phone: teacher.phone ?? null, email: teacher.email ?? null, joiningDate: teacher.joiningDate ?? null, status: teacher.status,
      } : null,
      duties,
    };
  },
});

export const updateMine = schoolMutation({
  args: { displayName: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "profile:read:own");
    if (ctx.actor.role === "student") throw forbidden("Use the student portal profile.");
    const m = (await ctx.db.get(ctx.actor.membershipId))!;
    const changed: string[] = [];
    if (a.displayName !== undefined) {
      if (m.role !== "admin") throw forbidden("Your name is managed by the school office.");
      const name = assertNonEmpty(a.displayName, "displayName", 120);
      if (name !== m.displayName) { await ctx.db.patch(m._id, { displayName: name }); changed.push("displayName"); }
    }
    if (a.phone !== undefined) {
      if (!ctx.actor.teacherId) throw forbidden("There is no staff record with a phone number for this account.");
      const t = (await ctx.db.get(ctx.actor.teacherId))!;
      const phone = a.phone.trim();
      if (phone && !/^[+\d][\d\s()-]{5,29}$/.test(phone)) throw invalid("Enter a valid phone number.", { phone: "Invalid" });
      if ((t.phone ?? "") !== phone) { await ctx.db.patch(t._id, { phone: phone || undefined }); changed.push("phone"); }
    }
    if (changed.length) {
      await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "profile.updated", entity: { table: "schoolMemberships", id: m._id }, summary: `${m.displayName} updated their profile`, metadata: { fields: changed } });
    }
    return { ok: true, changed };
  },
});
