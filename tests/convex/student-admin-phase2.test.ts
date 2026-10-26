/**
 * Phase 2 student administration additions:
 *  - spreadsheet import: scholar numbers (unique in file + school) and blocked duplicate children;
 *  - roll-number history (every in-year renumbering is kept) and persistence across years;
 *  - Students → Export grant (students:export) backing the admission register download;
 *  - admission register (CSR): derived standard columns + pluggable school-defined columns;
 *  - tenant isolation and module entitlement on all of the above;
 *  - automatic scholar numbers (<prefix>0001 …) and the operator backfill;
 *  - changing the current academic year leaves every earlier record untouched.
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { grantProblems, permissionsFromGrants } from "../../convex/core/grants";
import { resolvePermissions } from "../../convex/core/permissions";
import { as, createSchool, errorCode, makeTest, type SchoolFixture, type T } from "./fixtures";

const TODAY = "2026-07-01";
const row = (rowNumber: number, values: Record<string, string>) => ({ rowNumber, values });
const studentRow = (n: number, over: Record<string, string> = {}) =>
  row(n, { fullName: `Kiran Das${n}`, className: "Grade 8", section: "A", dateOfBirth: "2014-01-0" + ((n % 9) + 1), ...over });

async function officeLogin(t: T, A: SchoolFixture, grants: { module: string; actions: string[] }[]) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: `office${Math.random()}@alpha.test` });
    const membershipId = await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, displayName: "Office", role: "admin", status: "active", permissionSets: [] });
    return { userId, membershipId };
  });
  await (await as(t, A.users.admin)).mutation(api.memberships.setPermissions, { targetMembershipId: ids.membershipId, grants: grants as never });
  return await as(t, ids.userId);
}

async function studentsNamed(t: T, schoolId: Id<"schools">, lastName: string) {
  return await t.run(async (ctx) => (await ctx.db.query("students").collect()).filter((s) => s.schoolId === schoolId && s.lastName === lastName));
}

// ---------------------------------------------------------------- import
describe("import: scholar numbers and duplicate children", () => {
  test("scholar numbers are unique within the file and the school, and stored on commit", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, scholarNo: "SR 1" });

    const { results } = await admin.query(api.imports.previewStudents, {
      rows: [studentRow(2, { scholarNo: "sr 2" }), studentRow(3, { scholarNo: "SR2" }), studentRow(4, { scholarNo: "sr1" }), studentRow(5, { scholarNo: "#bad" })],
      createAccounts: false, today: TODAY,
    });
    const errs = (n: number) => results.find((r) => r.rowNumber === n)!.errors.map((e) => e.message).join(" ");
    expect(results.find((r) => r.rowNumber === 2)!.status).not.toBe("invalid");
    expect(errs(3)).toMatch(/repeated \(first used on row 2\)/);
    expect(errs(4)).toMatch(/already belongs to Asha/);
    expect(errs(5)).toMatch(/letters, digits/);

    // The whole file is refused while any row is invalid; nothing is written.
    expect(await errorCode(admin.mutation(api.imports.commitStudentRows, { rows: [studentRow(2, { scholarNo: "SR 2" }), studentRow(3, { scholarNo: "SR2" })], createAccounts: false, today: TODAY }))).toBe("INVALID_ARGUMENT");
    expect(await studentsNamed(t, A.schoolId, "Das2")).toHaveLength(0);

    const res = await admin.mutation(api.imports.commitStudentRows, { rows: [studentRow(2, { scholarNo: "SR 2" })], createAccounts: false, today: TODAY });
    const [created] = await studentsNamed(t, A.schoolId, "Das2");
    expect(created._id).toBe(res.created[0].studentId);
    expect(created).toMatchObject({ scholarNo: "SR 2", scholarNoKey: "SR2" });

    // Another school may use the same number.
    const bAdmin = await as(t, B.users.admin);
    expect(await errorCode(bAdmin.mutation(api.imports.commitStudentRows, { rows: [studentRow(2, { scholarNo: "SR 2" })], createAccounts: false, today: TODAY }))).toBe("NO_ERROR");
  });

  test("the same child (name + date of birth) is blocked in the file and against existing students of any status", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const existing = await t.run((ctx) => ctx.db.get(A.studentA));
    // A student who already left the school still counts (re-enrol them instead).
    await t.run((ctx) => ctx.db.patch(A.studentA, { status: "alumni", dateOfBirth: "2013-03-03" }));

    const { results } = await admin.query(api.imports.previewStudents, {
      rows: [
        row(2, { fullName: `${existing!.firstName} ${existing!.lastName}`, className: "Grade 8", section: "A", dateOfBirth: "2013-03-03" }),
        row(3, { fullName: "Tara Sen", className: "Grade 8", section: "A", dateOfBirth: "2014-02-02" }),
        row(4, { fullName: "tara  sen", className: "Grade 8", section: "B", dateOfBirth: "2014-02-02" }),
        row(5, { fullName: "Tara Sen", className: "Grade 8", section: "A", dateOfBirth: "2014-02-03" }), // different birthday: allowed
      ],
      createAccounts: false, today: TODAY,
    });
    const status = (n: number) => results.find((r) => r.rowNumber === n)!.status;
    expect(results.find((r) => r.rowNumber === 2)!.errors[0].message).toMatch(/already exists \(scholar no\. ALPHAASHA\)/);
    expect(status(2)).toBe("invalid");
    expect(status(3)).not.toBe("invalid");
    expect(results.find((r) => r.rowNumber === 4)!.errors[0].message).toMatch(/repeated \(first on row 3\)/);
    expect(status(5)).not.toBe("invalid");
  });
});

// ---------------------------------------------------------------- roll numbers
describe("roll numbers: history within the year and persistence across years", () => {
  test("renumbering keeps every earlier number; the old year's numbers survive promotion", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const asha = await t.run((ctx) => ctx.db.get(A.studentA));
    expect(asha!.firstName).toBe("Asha");

    // "Aarav" sorts before "Asha": Asha moves from roll no. 1 to 2.
    const aarav = await admin.mutation(api.academics.createStudentWithEnrollment, {
      firstName: "Aarav", lastName: "Iyer", dateOfBirth: "2014-04-04", admissionDate: "2026-06-01", address: "2 Lane",
      classId: A.classId, sectionId: A.sectionA, parentContact: { name: "P Iyer", relation: "Father", phone: "+91 90000 11111" },
    });
    expect(aarav.rollNo).toBe(1);
    const ashaHistory = await admin.query(api.academics.rollNumberHistory, { studentId: A.studentA });
    expect(ashaHistory).toHaveLength(1);
    expect(ashaHistory[0]).toMatchObject({ section: "8-A", academicYear: "2026-27", fromRollNo: 1, toRollNo: 2, reason: "roster_change" });
    expect((await admin.query(api.academics.rollNumberHistory, { studentId: aarav.studentId }))[0]).toMatchObject({ fromRollNo: null, toRollNo: 1 });
    const stored = await t.run((ctx) => ctx.db.query("rollNumberHistory").withIndex("by_school_student", (q) => q.eq("schoolId", A.schoolId).eq("studentId", A.studentA)).collect());
    expect(stored[0].changedByUserId).toBe(A.users.admin);

    // Next academic year: Asha is promoted. The 2026-27 enrollment keeps roll no. 2;
    // the new enrollment is numbered within its own section and year.
    const next = await t.run(async (ctx) => {
      const yearId = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });
      const class9 = await ctx.db.insert("classes", { schoolId: A.schoolId, name: "Grade 9", level: 9, active: true });
      const nineA = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: yearId, classId: class9, name: "A", displayName: "9-A" });
      return { yearId, nineA };
    });
    await admin.mutation(api.studentLifecycle.promote, { fromSectionId: A.sectionA, toSectionId: next.nineA, studentIds: [A.studentA] });
    const years = await admin.query(api.academics.enrollmentHistory, { studentId: A.studentA });
    expect(years.map((y) => [y.academicYear, y.section, y.status, y.rollNo])).toEqual([["2027-28", "9-A", "active", 1], ["2026-27", "8-A", "promoted", 2]]);
    const all = await admin.query(api.academics.rollNumberHistory, { studentId: A.studentA });
    expect(all.map((h) => [h.academicYear, h.fromRollNo, h.toRollNo])).toEqual(expect.arrayContaining([["2026-27", 1, 2], ["2027-28", null, 1]]));
    // Aarav, left alone in 8-A, is renumbered 1 → 1 (no change, no history row) — the roster stays 1..n.
    expect(await admin.query(api.academics.rollNumberHistory, { studentId: aarav.studentId })).toHaveLength(1);
  });

  test("history is tenant-isolated and follows the student-record access rule", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    expect(await errorCode((await as(t, B.users.admin)).query(api.academics.rollNumberHistory, { studentId: A.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.student)).query(api.academics.rollNumberHistory, { studentId: A.studentA }))).toBe("NO_ERROR"); // own record
    expect(await errorCode((await as(t, A.users.student)).query(api.academics.rollNumberHistory, { studentId: A.studentB }))).not.toBe("NO_ERROR");
  });
});

// ---------------------------------------------------------------- export grant
describe("Students → Export (students:export)", () => {
  test("grant rules: needs View; malformed stored data grants nothing; the Principal has it", () => {
    expect(grantProblems("admin", [{ module: "students", actions: ["export"] }], false).join(" ")).toMatch(/Export needs View/);
    expect(grantProblems("admin", [{ module: "students", actions: ["view", "export"] }], false)).toEqual([]);
    expect(permissionsFromGrants([{ module: "students", actions: ["export"] }], false).has("students:export")).toBe(false);
    expect(permissionsFromGrants([{ module: "students", actions: ["view", "export"] }], false).has("students:export")).toBe(true);
    expect(resolvePermissions("admin").has("students:export")).toBe(true);
    expect(resolvePermissions("teacher").has("students:export")).toBe(false);
    expect(resolvePermissions("student").has("students:export")).toBe(false);
    // Other modules' Export cells still have no server control.
    expect(grantProblems("admin", [{ module: "finance", actions: ["view", "create", "edit", "delete", "export"] }], false).join(" ")).toMatch(/cannot be granted/);
  });

  test("the server enforces it: view-only office logins can read the register but not download it", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const opts = { paginationOpts: { numItems: 10, cursor: null } };
    const viewer = await officeLogin(t, A, [{ module: "students", actions: ["view"] }]);
    expect(await errorCode(viewer.query(api.admissionRegister.page, opts))).toBe("NO_ERROR");
    expect(await errorCode(viewer.query(api.admissionRegister.exportPage, opts))).toBe("FORBIDDEN");
    const exporter = await officeLogin(t, A, [{ module: "students", actions: ["view", "export"] }]);
    expect(await errorCode(exporter.query(api.admissionRegister.exportPage, opts))).toBe("NO_ERROR");
    expect(await errorCode((await as(t, A.users.admin)).query(api.admissionRegister.exportPage, opts))).toBe("NO_ERROR");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.admissionRegister.page, opts))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).query(api.admissionRegister.exportPage, opts))).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------- admission register
describe("admission register (CSR)", () => {
  test("derived standard columns + Principal-defined columns; values validated and audited", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.academics.updateStudentProfile, { studentId: A.studentA, scholarNo: "SR 7" });

    // No extra columns by default (pending each school's confirmation).
    expect(await admin.query(api.admissionRegister.fields, {})).toEqual([]);
    await admin.mutation(api.admissionRegister.defineField, { key: "religion", label: "Religion", type: "text", required: true });
    await admin.mutation(api.admissionRegister.defineField, { key: "category", label: "Category", type: "select", options: ["General", "OBC", "SC", "ST"] });
    expect(await errorCode(admin.mutation(api.admissionRegister.defineField, { key: "category", label: "Category", type: "text" }))).toBe("CONFLICT"); // type is fixed
    expect(await errorCode(admin.mutation(api.admissionRegister.defineField, { key: "Bad Key", label: "x", type: "text" }))).toBe("INVALID_ARGUMENT");

    // Value validation; nothing is written on error.
    expect(await errorCode(admin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { nope: "x" } }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { religion: "X", category: "Other" } }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { category: "OBC" } }))).toBe("INVALID_ARGUMENT"); // required religion missing
    expect((await admin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { religion: " Hindu ", category: "OBC" } })).changed.sort()).toEqual(["category", "religion"]);

    const entry = await admin.query(api.admissionRegister.studentEntry, { studentId: A.studentA });
    expect(entry).toMatchObject({
      scholarNo: "SR 7", status: "active", admittedTo: { className: "Grade 8", section: "8-A", academicYear: "2026-27" },
      current: { section: "8-A", rollNo: 1 }, leaving: null, custom: { religion: "Hindu", category: "OBC" }, missingRequired: [],
    });
    expect(entry.parent?.relation).toBe("Mother");
    const page = await admin.query(api.admissionRegister.page, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.columns.map((c) => c.key)).toEqual(["religion", "category"]);
    expect(page.page.find((r) => r.studentId === A.studentB)?.missingRequired).toEqual(["religion"]);

    // Deactivating a column hides it but keeps the values; reactivating brings them back.
    await admin.mutation(api.admissionRegister.defineField, { key: "category", label: "Category", type: "select", options: ["General", "OBC", "SC", "ST"], active: false });
    expect((await admin.query(api.admissionRegister.studentEntry, { studentId: A.studentA })).custom).toEqual({ religion: "Hindu" });
    await admin.mutation(api.admissionRegister.defineField, { key: "category", label: "Category", type: "select", options: ["General", "OBC", "SC", "ST"], active: true });
    expect((await admin.query(api.admissionRegister.studentEntry, { studentId: A.studentA })).custom.category).toBe("OBC");

    const audit = await t.run((ctx) => ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", A.schoolId).eq("action", "admission_register.values_updated")).collect());
    expect(Object.keys(audit[0].metadata as object)).toEqual(["columns"]); // column keys only, never the values
    expect([...(audit[0].metadata as { columns: string[] }).columns].sort()).toEqual(["category", "religion"]);
  });

  test("a transfer certificate fills the leaving columns; the student stays in the register", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.studentLifecycle.issueTransferCertificate, { studentId: A.studentA, leavingDate: "2026-07-01", reason: "Family relocation" });
    const entry = await admin.query(api.admissionRegister.studentEntry, { studentId: A.studentA });
    expect(entry.status).toBe("transferred");
    expect(entry.current).toBeNull();
    expect(entry.leaving).toMatchObject({ leavingDate: "2026-07-01", reason: "Family relocation" });
    expect(entry.admittedTo?.section).toBe("8-A");
  });

  test("authorization: only the Principal defines columns; office staff with Students create/edit fill them", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await (await as(t, A.users.admin)).mutation(api.admissionRegister.defineField, { key: "house", label: "House", type: "text" });
    const clerk = await officeLogin(t, A, [{ module: "students", actions: ["view", "create", "edit"] }]);
    expect(await errorCode(clerk.mutation(api.admissionRegister.defineField, { key: "caste", label: "Caste", type: "text" }))).toBe("FORBIDDEN");
    expect(await errorCode(clerk.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { house: "Red" } }))).toBe("NO_ERROR");
    const viewer = await officeLogin(t, A, [{ module: "students", actions: ["view"] }]);
    expect(await errorCode(viewer.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { house: "Blue" } }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { house: "Blue" } }))).toBe("FORBIDDEN");
  });

  test("tenant isolation: another school sees none of this school's columns, values or students", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const aAdmin = await as(t, A.users.admin);
    const bAdmin = await as(t, B.users.admin);
    await aAdmin.mutation(api.admissionRegister.defineField, { key: "house", label: "House", type: "text" });
    await aAdmin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { house: "Red" } });
    expect(await bAdmin.query(api.admissionRegister.fields, {})).toEqual([]);
    expect(await errorCode(bAdmin.query(api.admissionRegister.studentEntry, { studentId: A.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(bAdmin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: {} }))).toBe("NOT_FOUND");
    const bPage = await bAdmin.query(api.admissionRegister.page, { paginationOpts: { numItems: 50, cursor: null } });
    expect(bPage.page.some((r) => r.studentId === A.studentA)).toBe(false);
    // School B can define its own "house" column independently.
    expect(await errorCode(bAdmin.mutation(api.admissionRegister.defineField, { key: "house", label: "House", type: "select", options: ["Blue"] }))).toBe("NO_ERROR");
  });

  test("Student Management off → MODULE_DISABLED; turning it back on restores the same register", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.admissionRegister.defineField, { key: "house", label: "House", type: "text" });
    await admin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { house: "Red" } });
    const opts = { paginationOpts: { numItems: 10, cursor: null } };
    await t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ["administration"], updatedBy: "test", reason: "P2 test" });
    expect(await errorCode(admin.query(api.admissionRegister.page, opts))).toBe("MODULE_DISABLED");
    expect(await errorCode(admin.mutation(api.admissionRegister.setStudentValues, { studentId: A.studentA, values: { house: "Blue" } }))).toBe("MODULE_DISABLED");
    expect(await errorCode(admin.query(api.academics.rollNumberHistory, { studentId: A.studentA }))).toBe("MODULE_DISABLED");
    await t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ["students", "academics", "attendance", "finance", "administration"], updatedBy: "test", reason: "P2 test" });
    expect((await admin.query(api.admissionRegister.studentEntry, { studentId: A.studentA })).custom).toEqual({ house: "Red" });
  });
});

// ---------------------------------------------------------------- automatic scholar numbers
const admitArgs = (A: SchoolFixture, firstName: string, over: Record<string, unknown> = {}) => ({
  firstName, lastName: "Nair", dateOfBirth: "2014-03-03", admissionDate: "2026-06-01", address: "3 Lane",
  classId: A.classId, sectionId: A.sectionA, parentContact: { name: `P ${firstName}`, relation: "Mother", phone: "+91 98765 00001" }, ...over,
});

describe("automatic scholar numbers (<prefix>NNNN)", () => {
  test("new admissions get the next number; typed numbers are respected and move the sequence on", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    expect(await t.mutation(internal.scholarNumberMaintenance.configure, { schoolSlug: "alpha", prefix: "0246cbse" })).toMatchObject({ prefix: "0246CBSE", next: "0246CBSE0001" });

    expect((await admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Anu"))).scholarNo).toBe("0246CBSE0001");
    expect((await admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Bina"))).scholarNo).toBe("0246CBSE0002");
    // A typed number in the school's format: kept, and automatic numbers continue after it.
    expect((await admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Chitra", { scholarNo: "0246CBSE0010" }))).scholarNo).toBe("0246CBSE0010");
    expect((await admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Devi"))).scholarNo).toBe("0246CBSE0011");
    // A number already taken outside the sequence is skipped, never duplicated.
    await t.run((ctx) => ctx.db.patch(A.studentB, { scholarNo: "0246CBSE0012", scholarNoKey: "0246CBSE0012" }));
    expect((await admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Esha"))).scholarNo).toBe("0246CBSE0013");
    // Typing a taken number is still refused.
    expect(await errorCode(admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Farah", { scholarNo: "0246cbse 0013" })))).toBe("CONFLICT");
    // Another school without a prefix: no automatic numbers.
    expect((await (await as(t, B.users.admin)).mutation(api.academics.createStudentWithEnrollment, admitArgs(B, "Anu"))).scholarNo).toBeNull();
  });

  test("imports: rows without a number get one; a typed number later in the file is never taken by an earlier row", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    await t.mutation(internal.scholarNumberMaintenance.configure, { schoolSlug: "alpha", prefix: "0246CBSE" });
    const res = await admin.mutation(api.imports.commitStudentRows, {
      rows: [studentRow(2), studentRow(3, { scholarNo: "0246CBSE0002" }), studentRow(4)], createAccounts: false, today: TODAY,
    });
    const numbers = await t.run(async (ctx) => Promise.all(res.created.map(async (c) => (await ctx.db.get(c.studentId))!.scholarNo)));
    expect(numbers).toEqual(["0246CBSE0003", "0246CBSE0002", "0246CBSE0004"]);
  });

  test("backfill: dry run writes nothing; apply numbers existing students in admission order once; validation", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    expect(await errorCode(t.mutation(internal.scholarNumberMaintenance.backfill, { schoolSlug: "alpha" }))).toBe("CONFLICT"); // no prefix yet
    expect(await errorCode(t.mutation(internal.scholarNumberMaintenance.configure, { schoolSlug: "alpha", prefix: "02-46" }))).toBe("INVALID_ARGUMENT");
    await t.mutation(internal.scholarNumberMaintenance.configure, { schoolSlug: "alpha", prefix: "0246CBSE" });
    // Existing students without scholar numbers (the fixture gives them one).
    const students = await t.run(async (ctx) => {
      const rows = await ctx.db.query("students").withIndex("by_school_admission", (q) => q.eq("schoolId", A.schoolId)).collect();
      for (const s of rows) await ctx.db.patch(s._id, { scholarNo: undefined, scholarNoKey: undefined });
      return rows;
    });

    const dry = await t.mutation(internal.scholarNumberMaintenance.backfill, { schoolSlug: "alpha", dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, count: students.length, first: "0246CBSE0001", remaining: 0 });
    expect(dry.sample.map((s) => s.admissionNo)).toEqual(students.map((s) => s.admissionNo));
    expect((await t.run((ctx) => ctx.db.get(students[0]._id)))?.scholarNo).toBeUndefined();

    const applied = await t.mutation(internal.scholarNumberMaintenance.backfill, { schoolSlug: "alpha" });
    expect(applied.sample).toEqual(dry.sample);
    const after = await t.run(async (ctx) => Promise.all(students.map(async (s) => (await ctx.db.get(s._id))!.scholarNo)));
    expect(after).toEqual(students.map((_, i) => `0246CBSE${String(i + 1).padStart(4, "0")}`));
    // Re-running changes nothing; the next admission continues the sequence.
    expect(await t.mutation(internal.scholarNumberMaintenance.backfill, { schoolSlug: "alpha" })).toMatchObject({ count: 0 });
    const next = await (await as(t, A.users.admin)).mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Gita"));
    expect(next.scholarNo).toBe(`0246CBSE${String(students.length + 1).padStart(4, "0")}`);
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").withIndex("by_school_action", (q) => q.eq("schoolId", A.schoolId).eq("action", "student.scholar_numbers_assigned")).collect());
    expect(audit).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- academic year switch invariant
describe("changing the current academic year", () => {
  test("leaves every record of earlier years untouched (only the setting and the new year's status change)", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    // Records from several modules in the current (2026-27) year.
    const { structureId } = await admin.mutation(api.fees.createStructure, { name: "Tuition", classIds: [A.classId], components: [{ label: "Tuition", amountMinor: 1000 }], installments: [{ label: "T1", dueDate: "2026-06-01", amountMinor: 1000 }], activate: true });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    await admin.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 500, method: "cash", paidOn: "2026-06-01", clientRequestId: "year-switch-0001" });
    await admin.mutation(api.academics.createStudentWithEnrollment, admitArgs(A, "Hema"));
    const next = await admin.mutation(api.academics.createAcademicYear, { name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });

    const IGNORED = new Set(["academicYears", "schoolSettings", "auditLogs"]);
    const snapshot = () => t.run(async (ctx) => {
      const out: Record<string, unknown[]> = {};
      for (const table of Object.keys(schema.tables).filter((x) => !IGNORED.has(x))) out[table] = await ctx.db.query(table as never).collect();
      return out;
    });
    const before = await snapshot();
    const oldYear = await t.run((ctx) => ctx.db.get(A.yearId));
    const history = await admin.query(api.academics.enrollmentHistory, { studentId: A.studentA });

    await admin.mutation(api.academics.setCurrentAcademicYear, { academicYearId: next });
    expect(await snapshot()).toEqual(before);
    expect(await t.run((ctx) => ctx.db.get(A.yearId))).toEqual(oldYear); // the previous year itself is unchanged too
    expect(await t.run((ctx) => ctx.db.get(next))).toMatchObject({ status: "active" });
    expect(await admin.query(api.academics.enrollmentHistory, { studentId: A.studentA })).toEqual(history);

    // Switching back is just as harmless.
    await admin.mutation(api.academics.setCurrentAcademicYear, { academicYearId: A.yearId });
    expect(await snapshot()).toEqual(before);
  });
});
