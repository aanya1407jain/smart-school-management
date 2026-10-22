// @vitest-environment node
/**
 * Regression: importing tests/fixtures/student_import_test_data.xlsx (a real
 * workbook: "Read Me" sheet first, data on "Students Import" with camelCase
 * headings such as admissionNo / sectionName / guardianRelationship).
 *
 * The browser used to read only the FIRST worksheet ("Read Me"), so almost
 * every field showed "Not in file". This test runs the same parsing and
 * column matching the browser uses, then the real server preview/commit in an
 * isolated convex-test database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { STUDENT_IMPORT, bestSheetIndex, matchColumns, missingRequiredFields } from "../../convex/model/importSpecs";
import { sheetFromMatrix, type ParsedSheet } from "../../src/features/imports/spreadsheet";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

const WORKBOOK = new URL("../fixtures/student_import_test_data.xlsx", import.meta.url);
const TODAY = "2026-07-01";

async function loadWorkbook() {
  const raw = (await readXlsxFile(readFileSync(WORKBOOK))) as unknown as { sheet: string; data: unknown[][] }[];
  const sheets = raw.map((s) => sheetFromMatrix(s.sheet, s.data)).filter((s): s is ParsedSheet => s !== null);
  const index = bestSheetIndex(sheets.map((s) => ({ headings: s.headings, rowCount: s.rows.length })), STUDENT_IMPORT);
  const sheet = sheets[index];
  const { mapping, columns } = matchColumns(sheet.headings, STUDENT_IMPORT);
  return { sheets, sheet, mapping, columns };
}

/** Exactly what the import wizard sends: mapped, trimmed, non-empty values per spreadsheet row. */
function rowsFor(sheet: ParsedSheet, mapping: Record<string, number | null>) {
  return sheet.rows.map((r) => {
    const values: Record<string, string> = {};
    for (const f of STUDENT_IMPORT.fields) {
      const i = mapping[f.key];
      if (i !== null && i !== undefined && (r.cells[i] ?? "").trim()) values[f.key] = r.cells[i].trim();
    }
    return { rowNumber: r.rowNumber, values };
  });
}

/** The fixture school (Grade 8: 8-A/8-B) plus Grade 10: 10-A/10-B, as the workbook expects. */
async function school(t: T) {
  const A = await createSchool(t, "alpha");
  const sections = await t.run(async (ctx) => {
    const grade10 = await ctx.db.insert("classes", { schoolId: A.schoolId, name: "Grade 10", level: 10, active: true });
    const a = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: A.yearId, classId: grade10, name: "A", displayName: "10-A" });
    const b = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: A.yearId, classId: grade10, name: "B", displayName: "10-B" });
    return { grade10, "10-A": a, "10-B": b, "8-A": A.sectionA, "8-B": A.sectionB };
  });
  return { A, sections };
}

describe("student workbook import (student_import_test_data.xlsx)", () => {
  test("picks the data sheet, maps every supported column automatically and explains the rest", async () => {
    const { sheets, sheet, mapping, columns } = await loadWorkbook();
    expect(sheets.map((s) => s.name)).toEqual(["Read Me", "Students Import", "Field Guide"]);
    expect(sheet.name).toBe("Students Import");
    expect(sheet.rows).toHaveLength(25);
    expect(sheet.rows[0].rowNumber).toBe(2);
    const at = (h: string) => sheet.headings.indexOf(h);
    expect(mapping).toMatchObject({
      admissionNo: at("admissionNo"), firstName: at("firstName"), lastName: at("lastName"), gender: at("gender"),
      dateOfBirth: at("dateOfBirth"), admissionDate: at("admissionDate"), email: at("email"), phone: at("phone"), address: at("address"),
      className: at("className"), section: at("sectionName"), academicYear: at("academicYear"),
      parentName: at("guardianName"), parentPhone: at("guardianPhone"), parentEmail: at("guardianEmail"), parentRelation: at("guardianRelationship"), // the fixture workbook still uses "guardian…" headings
    });
    expect(mapping.fullName).toBeNull();
    expect(missingRequiredFields(mapping, STUDENT_IMPORT)).toEqual([]);
    const notImported = columns.filter((c) => c.status === "not_imported").map((c) => c.heading);
    expect(notImported).toEqual(["status", "bloodGroup", "rollNo", "guardianOccupation", "guardianAddress"]);
    expect(mapping).not.toHaveProperty("rollNo"); // roll numbers are system-assigned
    expect(columns.filter((c) => c.status === "unrecognized" || c.status === "ambiguous" || c.status === "duplicate")).toEqual([]);
    // Excel date cells arrive as ISO dates.
    expect(rowsFor(sheet, mapping)[0].values).toMatchObject({ admissionNo: "TEST-2026-0001", dateOfBirth: "2010-01-04", admissionDate: "2026-04-01", section: "8-A", className: "Grade 8" });
  });

  test("all 25 rows validate and import as students, enrollments and parent contacts — no accounts unless asked", async () => {
    const t = makeTest();
    const { A, sections } = await school(t);
    const { sheet, mapping } = await loadWorkbook();
    const rows = rowsFor(sheet, mapping);
    const admin = await as(t, A.users.admin);

    // The fixture already has students in 8-A / 8-B with roll no. 1: the file's rollNo column is ignored,
    // so there is no conflict and the whole section is renumbered after the import.
    const preview = await admin.query(api.imports.previewStudents, { rows, createAccounts: false, today: TODAY });
    expect(preview.summary).toMatchObject({ total: 25, invalid: 0 });

    const before = await t.run(async (ctx) => ({ users: (await ctx.db.query("users").collect()).length, memberships: (await ctx.db.query("schoolMemberships").collect()).length }));
    const result = await admin.mutation(api.imports.commitStudentRows, { rows, createAccounts: false, today: TODAY });
    expect(result.created).toHaveLength(25);
    expect(result.created.every((c) => !c.membershipId && !c.loginId)).toBe(true);

    const db = await t.run(async (ctx) => {
      const allStudents = await ctx.db.query("students").collect();
      const students = allStudents.filter((s) => s.admissionNo.startsWith("TEST-2026-"));
      const enrollments = await ctx.db.query("enrollments").collect();
      const links = await ctx.db.query("guardianLinks").collect();
      const guardians = await ctx.db.query("guardians").collect();
      return {
        students, allStudents, enrollments, links, guardians,
        users: (await ctx.db.query("users").collect()).length, memberships: (await ctx.db.query("schoolMemberships").collect()).length,
      };
    });
    expect(db.students).toHaveLength(25);
    expect(db.users).toBe(before.users);
    expect(db.memberships).toBe(before.memberships); // no accounts were requested

    const first = db.students.find((s) => s.admissionNo === "TEST-2026-0001")!;
    expect(first).toMatchObject({ firstName: "Aarav", lastName: "Sharma", gender: "male", dateOfBirth: "2010-01-04", admissionDate: "2026-04-01", status: "active", email: "aarav.sharma.test01@example.com", phone: "+91 90000 10000" });

    // Every imported student: one active enrollment in the section named in the file, with its roll number.
    for (const r of rows) {
      const s = db.students.find((x) => x.admissionNo === r.values.admissionNo)!;
      const enr = db.enrollments.filter((e) => e.studentId === s._id);
      expect(enr).toHaveLength(1);
      expect(enr[0]).toMatchObject({ sectionId: sections[r.values.section as keyof typeof sections], academicYearId: A.yearId, status: "active" });
      expect(enr[0].classId).toBe(r.values.className === "Grade 10" ? sections.grade10 : A.classId);
      const link = db.links.filter((l) => l.studentId === s._id);
      expect(link).toHaveLength(1);
      const g = db.guardians.find((x) => x._id === link[0].guardianId)!;
      expect(g).toMatchObject({ name: r.values.parentName, phone: r.values.parentPhone, email: r.values.parentEmail, schoolId: A.schoolId });
      expect(link[0]).toMatchObject({ relationship: r.values.parentRelation, isPrimary: true, schoolId: A.schoolId });
    }

    // Each section's complete roster (fixture students + imported) is numbered 1..n alphabetically.
    for (const [label, sectionId] of Object.entries(sections)) {
      if (label === "grade10") continue;
      const roster = db.enrollments.filter((e) => e.sectionId === sectionId && e.status === "active")
        .map((e) => ({ roll: e.rollNo, s: (db.allStudents.find((x) => x._id === e.studentId))! }))
        .sort((a, b) => (a.roll ?? 0) - (b.roll ?? 0));
      expect(roster.map((x) => x.roll)).toEqual(roster.map((_, i) => i + 1));
      const names = roster.map((x) => `${x.s.firstName} ${x.s.lastName}`.toLowerCase());
      expect(names).toEqual([...names].sort());
    }

    // Importing the same file again: every admission number is now a duplicate and nothing is written.
    const again = await admin.query(api.imports.previewStudents, { rows, createAccounts: false, today: TODAY });
    expect(again.summary.invalid).toBe(25);
    expect(again.results.every((r) => r.errors.some((e) => /already belongs to/.test(e.message)))).toBe(true);
    expect(await errorCode(admin.mutation(api.imports.commitStudentRows, { rows, createAccounts: false, today: TODAY }))).toBe("INVALID_ARGUMENT");
    expect((await t.run((ctx) => ctx.db.query("students").collect())).length).toBe(db.students.length + 2);
  });

  test("accounts are created only when requested (pending until credentials are issued)", async () => {
    const t = makeTest();
    const { A } = await school(t);
    const { sheet, mapping } = await loadWorkbook();
    const admin = await as(t, A.users.admin);
    const result = await admin.mutation(api.imports.commitStudentRows, { rows: rowsFor(sheet, mapping), createAccounts: true, today: TODAY });
    expect(result.created).toHaveLength(25);
    expect(result.created.every((c) => /^STU-2026-\d{5}$/.test(c.loginId ?? ""))).toBe(true);
    const pending = await t.run(async (ctx) => (await ctx.db.query("schoolMemberships").collect()).filter((m) => m.loginId?.startsWith("STU-2026-")));
    expect(pending).toHaveLength(25);
    expect(pending.every((m) => m.status === "invited" && !m.userId && m.role === "student")).toBe(true);
    // Credentials are issued explicitly; only then does a sign-in identity exist.
    const issued = await admin.action(api.accounts.issuePendingCredentials, { targetMembershipIds: [result.created[0].membershipId as Id<"schoolMemberships">] });
    expect(issued[0].ok).toBe(true);
    const users = await t.run(async (ctx) => (await ctx.db.query("users").collect()).filter((u) => u.loginId?.startsWith("STU-2026-")));
    expect(users).toHaveLength(1);
  });

  test("invalid class / section / academic year and duplicate admission numbers are reported per row", async () => {
    const t = makeTest();
    const { A } = await school(t);
    const { sheet, mapping } = await loadWorkbook();
    const rows = rowsFor(sheet, mapping);
    rows[0].values.className = "Grade 11";
    rows[1].values.section = "8-Z";
    rows[2].values.academicYear = "2025-26";
    rows[3].values.admissionNo = rows[4].values.admissionNo;
    const admin = await as(t, A.users.admin);
    const p = await admin.query(api.imports.previewStudents, { rows, createAccounts: false, today: TODAY });
    const msg = (rowNumber: number) => p.results.find((r) => r.rowNumber === rowNumber)!.errors.map((e) => e.message).join(" | ");
    expect(msg(2)).toMatch(/Class "Grade 11" does not exist/);
    expect(msg(3)).toMatch(/Section "8-Z" does not exist in Grade 8/);
    expect(msg(4)).toMatch(/Academic year "2025-26" is not the current academic year \(2026-27\)/);
    expect(msg(6)).toMatch(/Admission number TEST-2026-0005 is repeated \(first used on row 5\)/);
    expect(p.summary.invalid).toBe(4);
    expect(await errorCode(admin.mutation(api.imports.commitStudentRows, { rows, createAccounts: false, today: TODAY }))).toBe("INVALID_ARGUMENT");
    expect((await t.run((ctx) => ctx.db.query("students").collect())).length).toBe(2); // nothing imported
  });

  test("teachers and other schools' admins cannot import into this school", async () => {
    const t = makeTest();
    const { A } = await school(t);
    const B = await createSchool(t, "beta");
    const { sheet, mapping } = await loadWorkbook();
    const rows = rowsFor(sheet, mapping).slice(0, 2);
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.imports.commitStudentRows, { rows, createAccounts: false, today: TODAY }))).toBe("FORBIDDEN");
    // Another school's admin imports into THEIR school (derived server-side), never into this one.
    await (await as(t, B.users.admin)).mutation(api.imports.commitStudentRows, { rows, createAccounts: false, today: TODAY });
    const imported = await t.run(async (ctx) => (await ctx.db.query("students").collect()).filter((s) => s.admissionNo.startsWith("TEST-2026-")));
    expect(imported).toHaveLength(2);
    expect(imported.every((s) => s.schoolId === B.schoolId)).toBe(true);
    expect(A.schoolId).not.toBe(B.schoolId);
  });
});
