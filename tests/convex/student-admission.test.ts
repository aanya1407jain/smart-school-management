/**
 * academics.createStudentWithEnrollment (the admin "Add student" form):
 * validated class ↔ section ↔ current year (no silent fallback), atomic
 * admission numbers, parent-contact re-use, whole-section alphabetical roll numbers,
 * no credentials, and the account path staying separate.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;

function form(A: School, over: Partial<{ firstName: string; lastName: string; sectionId: Id<"sections">; classId: Id<"classes">; contactPhone: string; contactName: string; admissionDate: string }> = {}) {
  return {
    firstName: over.firstName ?? "Kabir",
    lastName: over.lastName ?? "Rao",
    gender: "male" as const,
    dateOfBirth: "2013-05-04",
    admissionDate: over.admissionDate ?? "2026-06-10",
    address: "12 Lake Road, Pune",
    classId: over.classId ?? A.classId,
    sectionId: over.sectionId ?? A.sectionA,
    parentContact: { name: over.contactName ?? "Meena Rao", relation: "Mother", phone: over.contactPhone ?? "98450 12345" },
  };
}

const roster = (t: T, sectionId: Id<"sections">) => t.run(async (ctx) => {
  const rows = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).collect();
  const out = [];
  for (const e of rows) { const s = (await ctx.db.get(e.studentId))!; out.push({ name: `${s.firstName} ${s.lastName}`, rollNo: e.rollNo, studentId: s._id }); }
  return out.sort((a, b) => (a.rollNo ?? 0) - (b.rollNo ?? 0));
});
const count = (t: T, table: "students" | "enrollments" | "guardians" | "guardianLinks" | "schoolMemberships") => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  const admin = await as(t, A.users.admin);
  return { t, A, B, admin };
}

describe("createStudentWithEnrollment", () => {
  test("enrolls in the chosen section of the current year; whole roster renumbered alphabetically; no credentials returned", async () => {
    const { t, A, admin } = await setup();
    // Section A already has Asha S (roll 1). Aarav sorts before her, Zoya after.
    const z = await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "Zoya", lastName: "Khan" }));
    const a = await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "Aarav", lastName: "Mehta", contactPhone: "98450 22222" }));
    expect(await roster(t, A.sectionA)).toEqual([
      { name: "Aarav Mehta", rollNo: 1, studentId: a.studentId },
      { name: "Asha S", rollNo: 2, studentId: A.studentA },
      { name: "Zoya Khan", rollNo: 3, studentId: z.studentId },
    ]);
    expect(a).toMatchObject({ section: "8-A", rollNo: 1, classTeacher: "Class T" });
    expect(Object.keys(a).sort()).toEqual(["admissionNo", "classTeacher", "rollNo", "scholarNo", "section", "studentId", "warnings"]);
    expect(a.scholarNo).toBeNull(); // this school has no automatic scholar numbering
    expect(JSON.stringify(a)).not.toMatch(/password/i);
    const enr = await t.run(async (ctx) => ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", a.studentId).eq("academicYearId", A.yearId)).unique());
    expect(enr).toMatchObject({ sectionId: A.sectionA, classId: A.classId, status: "active", startDate: "2026-06-10" });
    // No sign-in account is created by the form.
    expect((await t.run(async (ctx) => ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", a.studentId)).collect())).length).toBe(0);
  });

  test("admission numbers come from the atomic counter and are unique", async () => {
    const { admin, A } = await setup();
    const r1 = await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "One", contactPhone: "98450 00001" }));
    const r2 = await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "Two", contactPhone: "98450 00002" }));
    expect(r1.admissionNo).toMatch(/^AL-2026-\d+$/);
    expect(r2.admissionNo).not.toBe(r1.admissionNo);
  });

  test("a section of another class, another year or another school is rejected — nothing is written, no fallback", async () => {
    const { t, A, B, admin } = await setup();
    const other = await t.run(async (ctx) => {
      const classId = await ctx.db.insert("classes", { schoolId: A.schoolId, name: "Grade 9", level: 9, active: true });
      const sectionId = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: A.yearId, classId, name: "A", displayName: "9-A" });
      const oldYear = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" });
      const oldSection = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: oldYear, classId: A.classId, name: "A", displayName: "8-A" });
      return { classId, sectionId, oldSection };
    });
    const before = await Promise.all((["students", "enrollments", "guardians", "guardianLinks"] as const).map((x) => count(t, x)));
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, form(A, { sectionId: other.sectionId })))).toBe("INVALID_RELATIONSHIP");
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, form(A, { sectionId: other.oldSection })))).toBe("INVALID_RELATIONSHIP");
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, form(A, { sectionId: B.sectionA })))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, form(A, { classId: B.classId })))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.students.createStudentWithEnrollment, form(A, { contactPhone: "call me" })))).toBe("INVALID_ARGUMENT");
    expect(await Promise.all((["students", "enrollments", "guardians", "guardianLinks"] as const).map((x) => count(t, x)))).toEqual(before);
  });

  test("teachers and students cannot admit students", async () => {
    const { t, A } = await setup();
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.students.createStudentWithEnrollment, form(A)))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.students.createStudentWithEnrollment, form(A)))).toBe("FORBIDDEN");
  });

  test("a parent contact with the same phone is re-used (siblings); a missing class teacher is reported, not invented", async () => {
    const { t, A, admin } = await setup();
    await t.run((ctx) => ctx.db.patch(A.sectionB, { classTeacherId: undefined }));
    const first = await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "Ira", sectionId: A.sectionB, contactPhone: "98450 55555" }));
    const second = await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "Ivan", sectionId: A.sectionB, contactPhone: "98450 55555", contactName: "Someone Else" }));
    const contactOf = (id: Id<"students">) => t.run(async (ctx) => (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", id)).unique())!.guardianId);
    expect(await contactOf(first.studentId)).toBe(await contactOf(second.studentId));
    expect(second.warnings.some((w) => /already belongs to parent contact Meena Rao/.test(w))).toBe(true);
    expect(first.classTeacher).toBeNull();
    expect(first.warnings.some((w) => /no class teacher/.test(w))).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.get(A.sectionB))!.classTeacherId ?? null)).toBeNull();
  });

  test("form admissions and spreadsheet imports share one alphabetical roster; other years are untouched", async () => {
    const { t, A, admin } = await setup();
    const old = await t.run(async (ctx) => {
      const y = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" });
      const sec = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: y, classId: A.classId, name: "A", displayName: "8-A" });
      const e = await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: y, classId: A.classId, sectionId: sec, rollNo: 7, status: "completed", startDate: "2025-04-01" });
      return { e };
    });
    await admin.mutation(api.imports.commitStudentRows, { rows: [{ rowNumber: 2, values: { fullName: "Mira Das", className: "Grade 8", section: "A", rollNo: "1" } }], createAccounts: false, today: "2026-07-01" });
    await admin.mutation(api.students.createStudentWithEnrollment, form(A, { firstName: "Asha", lastName: "Bose", contactPhone: "98450 77777" }));
    expect((await roster(t, A.sectionA)).map((r) => [r.name, r.rollNo])).toEqual([["Asha Bose", 1], ["Asha S", 2], ["Mira Das", 3]]);
    expect(await t.run(async (ctx) => (await ctx.db.get(old.e))!.rollNo)).toBe(7);
  });

  test("an admitted student later gets an account through the existing account path — linked to the same record, no duplicates", async () => {
    const { t, A, admin } = await setup();
    const r = await admin.mutation(api.students.createStudentWithEnrollment, { ...form(A, { firstName: "Neel" }), scholarNo: "SR 501" });
    const students = await count(t, "students");
    const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: r.studentId } });
    const m = await t.run((ctx) => ctx.db.get(acc.membershipId));
    expect(m).toMatchObject({ role: "student", studentId: r.studentId, loginId: "SR501" }); // Login ID = scholar number
    const me = await as(t, m!.userId!);
    await me.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: "Neel#2026x" });
    const p = await me.query(api.studentPortal.myProfile, {});
    expect(p.state === "ok" && p.student.studentId === r.studentId && p.enrollment?.sectionDisplayName === "8-A").toBe(true);
    expect(await count(t, "students")).toBe(students);
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "student", studentId: r.studentId } }))).toBe("CONFLICT");
  });
});
