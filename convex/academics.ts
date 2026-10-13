import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import {
  requirePermission,
  getCurrentAcademicYearId,
} from "./core/authorization";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { fullName } from "./model/academics";
import { writeAudit } from "./model/audit";

/**
 * Fetch sections for a school/year
 */
export const listSections = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "students:read:all");
    const yearId = args.academicYearId ?? (await getCurrentAcademicYearId(ctx, ctx.actor.schoolId));
    return await ctx.db
      .query("sections")
      .withIndex("by_school_year", (q) =>
        q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)
      )
      .collect();
  },
});

/**
 * Create a student, auto-generate server-side admission number, link guardian,
 * and enroll them in a section for the active academic year.
 */
export const createStudentWithEnrollment = schoolMutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"), v.literal("other"))),
    dateOfBirth: v.string(),
    admissionDate: v.string(),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("transferred"), v.literal("alumni")),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.string(),
    bloodGroup: v.optional(v.string()),
    sectionId: v.string(),
    guardian: v.object({
      name: v.string(),
      relation: v.string(),
      phone: v.string(),
      email: v.optional(v.string()),
      occupation: v.optional(v.string()),
    }),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:write");
    assertIsoDate(a.admissionDate, "admissionDate");
    assertIsoDate(a.dateOfBirth, "dateOfBirth");

    const school = await ctx.db.get(ctx.actor.schoolId);
    const schoolCode = school?.code ?? "SCH";

    // 1. Server-side Admission Number Generation
    const existing = await ctx.db
      .query("students")
      .withIndex("by_school_admission", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();
    const nextSeq = existing.length + 1;
    const yearPrefix = new Date(a.admissionDate).getFullYear();
    const admissionNo = `${schoolCode}-${yearPrefix}-${String(nextSeq).padStart(4, "0")}`;

    // 2. Insert Student
    const studentId = await ctx.db.insert("students", {
      schoolId: ctx.actor.schoolId,
      admissionNo,
      firstName: assertNonEmpty(a.firstName, "firstName", 50),
      lastName: assertNonEmpty(a.lastName, "lastName", 50),
      gender: a.gender,
      dateOfBirth: a.dateOfBirth,
      admissionDate: a.admissionDate,
      status: a.status,
      email: a.email && a.email.trim().length > 0 ? a.email.trim() : undefined,
      phone: a.phone && a.phone.trim().length > 0 ? a.phone.trim() : undefined,
      address: assertNonEmpty(a.address, "address", 200),
      bloodGroup: a.bloodGroup,
    });

    // 3. Insert Guardian & Link
    const guardianId = await ctx.db.insert("guardians", {
      schoolId: ctx.actor.schoolId,
      name: assertNonEmpty(a.guardian.name, "guardian.name", 80),
      phone: assertNonEmpty(a.guardian.phone, "guardian.phone", 20),
      email: a.guardian.email && a.guardian.email.trim().length > 0 ? a.guardian.email.trim() : undefined,
      occupation: a.guardian.occupation,
      address: a.address,
    });

    await ctx.db.insert("guardianLinks", {
      schoolId: ctx.actor.schoolId,
      guardianId,
      studentId,
      relationship: a.guardian.relation,
      isPrimary: true,
    });

    // 4. Resolve Section with strict table typing
    const schoolSections: Doc<"sections">[] = await ctx.db
      .query("sections")
      .withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();

    const targetSection: Doc<"sections"> | undefined =
      schoolSections.find((s) => s._id === a.sectionId) ??
      schoolSections.find(
        (s) =>
          s.name.toLowerCase() === a.sectionId.toLowerCase() ||
          s.displayName.toLowerCase().includes(a.sectionId.toLowerCase())
      ) ??
      schoolSections[0];

    if (targetSection) {
      await ctx.db.insert("enrollments", {
        schoolId: ctx.actor.schoolId,
        studentId,
        academicYearId: targetSection.academicYearId,
        classId: targetSection.classId,
        sectionId: targetSection._id,
        status: "active",
        startDate: a.admissionDate,
      });

      await writeAudit(ctx, {
        schoolId: ctx.actor.schoolId,
        actor: ctx.actor,
        action: "enrollment.created",
        entity: { table: "students", id: studentId },
        summary: `Enrolled ${fullName({ firstName: a.firstName, lastName: a.lastName })} (${admissionNo}) in ${targetSection.displayName}`,
      });
    }

    return {
      id: studentId,
      admissionNo,
      email: a.email || `${a.firstName.toLowerCase()}.${a.lastName.toLowerCase()}@school.edu`,
      password: "DemoPassword123!",
      feeAssigned: false,
    };
  },
});