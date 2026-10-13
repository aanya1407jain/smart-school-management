/**
 * System-assigned roll numbers (convex/model/rollNumbers.ts): the WHOLE active
 * roster of a section is numbered 1..n alphabetically whenever it changes.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { compareRosterEntries, MAX_SECTION_ROSTER, nameSortKey } from "../../convex/model/rollNumbers";

const TODAY = "2026-07-01";
const row = (rowNumber: number, values: Record<string, string>) => ({ rowNumber, values });

/** Active roster of a section as "First Last" in roll-number order, plus the numbers themselves. */
async function roster(t: T, sectionId: Id<"sections">) {
  return await t.run(async (ctx) => {
    const enr = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).collect();
    const rows = [];
    for (const e of enr) {
      const s = (await ctx.db.get(e.studentId))!;
      rows.push({ roll: e.rollNo, name: `${s.firstName} ${s.lastName}`, studentId: s._id, enrollmentId: e._id });
    }
    return rows.sort((a, b) => (a.roll ?? 0) - (b.roll ?? 0));
  });
}
const names = (r: { name: string }[]) => r.map((x) => x.name);
const rolls = (r: { roll?: number }[]) => r.map((x) => x.roll);

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha"); // 8-A: Asha S (roll 1) · 8-B: Bala S (roll 1)
  const admin = await as(t, A.users.admin);
  const importRows = (rows: ReturnType<typeof row>[]) => admin.mutation(api.imports.commitStudentRows, { rows, createAccounts: false, today: TODAY });
  return { t, A, admin, importRows };
}

describe("roll-number ordering policy", () => {
  test("first name, then last name, case/accent/whitespace-insensitive, then stable ids", () => {
    const e = (firstName: string, lastName: string, studentId = "s1", enrollmentId = "e1") => ({ firstName, lastName, studentId, enrollmentId });
    const sorted = [e("dev", "Patel"), e("  Aarav ", "Sharma"), e("ISHA", "verma"), e("Ananya", "Jain"), e("Émile", "Zola"), e("Anil", "kumar"), e("Anil", "Kumar ")]
      .sort(compareRosterEntries).map((x) => `${x.firstName.trim()} ${x.lastName.trim()}`);
    expect(sorted).toEqual(["Aarav Sharma", "Ananya Jain", "Anil kumar", "Anil Kumar", "dev Patel", "Émile Zola", "ISHA verma"]);
    expect(nameSortKey("  Émile   Zola ")).toBe("emile zola");
    // Identical names: decided by student id, then enrollment id — never by input order.
    const twins = [e("Riya", "Shah", "s2"), e("Riya", "Shah", "s1")];
    expect([...twins].sort(compareRosterEntries).map((x) => x.studentId)).toEqual(["s1", "s2"]);
    expect([...twins].reverse().sort(compareRosterEntries).map((x) => x.studentId)).toEqual(["s1", "s2"]);
  });
});

describe("roll numbers after imports and enrollment changes", () => {
  test("existing and imported students are numbered together, 1..n, alphabetically; file roll numbers are ignored", async () => {
    const { t, A, importRows } = await setup();
    await importRows([
      row(2, { fullName: "Kabir Singh", className: "8", section: "A", rollNo: "1" }),
      row(3, { fullName: "Ananya Jain", className: "8", section: "A", rollNo: "99" }),
      row(4, { fullName: "Isha Verma", className: "8", section: "A" }),
      row(5, { fullName: "Dev Patel", className: "8", section: "A" }),
    ]);
    const r = await roster(t, A.sectionA);
    expect(names(r)).toEqual(["Ananya Jain", "Asha S", "Dev Patel", "Isha Verma", "Kabir Singh"]);
    expect(rolls(r)).toEqual([1, 2, 3, 4, 5]);
    // 8-B was not touched by this import.
    expect(rolls(await roster(t, A.sectionB))).toEqual([1]);
  });

  test("an alphabetically earlier admission renumbers the roster; a later one is appended in order", async () => {
    const { t, A, importRows } = await setup();
    await importRows([row(2, { fullName: "Meera Rao", className: "8", section: "A" })]);
    expect(names(await roster(t, A.sectionA))).toEqual(["Asha S", "Meera Rao"]);
    await importRows([row(2, { fullName: "Aarav Shah", className: "8", section: "A" })]); // earlier than Asha
    let r = await roster(t, A.sectionA);
    expect(names(r)).toEqual(["Aarav Shah", "Asha S", "Meera Rao"]);
    expect(rolls(r)).toEqual([1, 2, 3]);
    await importRows([row(2, { fullName: "Zara Ali", className: "8", section: "A" })]); // later
    r = await roster(t, A.sectionA);
    expect(names(r)).toEqual(["Aarav Shah", "Asha S", "Meera Rao", "Zara Ali"]);
    expect(rolls(r)).toEqual([1, 2, 3, 4]);
  });

  test("equal first names sort by last name; identical full names are deterministic", async () => {
    const { t, A, importRows } = await setup();
    await importRows([
      row(2, { fullName: "Riya Verma", className: "8", section: "B" }),
      row(3, { fullName: "riya  shah", className: "8", section: "B" }),
      row(4, { fullName: "Riya Shah", className: "8", section: "B" }),
      row(5, { fullName: "RIYA ARORA", className: "8", section: "B" }),
    ]);
    const r = await roster(t, A.sectionB);
    expect(names(r).map((n) => n.replace(/\s+/g, " ").toLowerCase())).toEqual(["bala s", "riya arora", "riya shah", "riya shah", "riya verma"]);
    expect(rolls(r)).toEqual([1, 2, 3, 4, 5]);
    const twins = r.filter((x) => /shah/i.test(x.name));
    expect(twins[0].studentId < twins[1].studentId).toBe(true); // tie broken by the stable student id
  });

  test("sections and academic years have independent sequences", async () => {
    const { t, A, importRows } = await setup();
    // A second academic year with its own 8-A section and an enrollment that must never be touched.
    const other = await t.run(async (ctx) => {
      const year = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });
      const sec = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: year, classId: A.classId, name: "A", displayName: "8-A" });
      const enr = await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: year, classId: A.classId, sectionId: sec, rollNo: 7, status: "active", startDate: "2027-04-01" });
      return { sec, enr };
    });
    await importRows([row(2, { fullName: "Aaron Abel", className: "8", section: "A" }), row(3, { fullName: "Aaron Abel", className: "8", section: "B" })]);
    expect(rolls(await roster(t, A.sectionA))).toEqual([1, 2]);
    expect(rolls(await roster(t, A.sectionB))).toEqual([1, 2]);
    expect((await t.run((ctx) => ctx.db.get(other.enr)))?.rollNo).toBe(7); // other year untouched
  });

  test("a transfer renumbers both the source and destination sections; history is kept", async () => {
    const { t, A, admin, importRows } = await setup();
    await importRows([row(2, { fullName: "Charu Das", className: "8", section: "A" }), row(3, { fullName: "Zubin Mehta", className: "8", section: "A" })]);
    expect(names(await roster(t, A.sectionA))).toEqual(["Asha S", "Charu Das", "Zubin Mehta"]);
    const charu = (await roster(t, A.sectionA))[1];
    await admin.mutation(api.academics.enrollStudent, { studentId: charu.studentId, sectionId: A.sectionB, startDate: TODAY });
    const a = await roster(t, A.sectionA), b = await roster(t, A.sectionB);
    expect([names(a), rolls(a)]).toEqual([["Asha S", "Zubin Mehta"], [1, 2]]);
    expect([names(b), rolls(b)]).toEqual([["Bala S", "Charu Das"], [1, 2]]);
    const old = await t.run((ctx) => ctx.db.get(charu.enrollmentId as Id<"enrollments">));
    expect(old).toMatchObject({ status: "transferred", rollNo: 2, sectionId: A.sectionA }); // historical record unchanged
  });

  test("ending an enrollment renumbers the remaining roster", async () => {
    const { t, A, admin, importRows } = await setup();
    await importRows([row(2, { fullName: "Aditi Rao", className: "8", section: "A" }), row(3, { fullName: "Mohan Lal", className: "8", section: "A" })]);
    const first = (await roster(t, A.sectionA))[0];
    expect(first.name).toBe("Aditi Rao");
    await admin.mutation(api.academics.endEnrollment, { enrollmentId: first.enrollmentId as Id<"enrollments">, status: "withdrawn", endDate: TODAY });
    const r = await roster(t, A.sectionA);
    expect([names(r), rolls(r)]).toEqual([["Asha S", "Mohan Lal"], [1, 2]]);
    expect(await errorCode(admin.mutation(api.academics.endEnrollment, { enrollmentId: first.enrollmentId as Id<"enrollments">, status: "withdrawn", endDate: TODAY }))).toBe("CONFLICT");
  });

  test("a failed or duplicate import leaves enrollments and roll numbers unchanged", async () => {
    const { t, A, importRows } = await setup();
    await importRows([row(2, { fullName: "Zed Last", className: "8", section: "A", admissionNo: "DUP-1" })]);
    const before = await roster(t, A.sectionA);
    // Earlier-sorting student + an invalid row → the whole commit is rejected, including the renumbering.
    expect(await errorCode(importRows([row(2, { fullName: "Aaa First", className: "8", section: "A" }), row(3, { fullName: "Bad", className: "8", section: "Z" })]))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(importRows([row(2, { fullName: "Aaa First", className: "8", section: "A", admissionNo: "DUP-1" })]))).toBe("INVALID_ARGUMENT");
    expect(await roster(t, A.sectionA)).toEqual(before);
  });

  test("teachers and students cannot change rosters; other schools' records are NOT_FOUND", async () => {
    const { t, A, importRows } = await setup();
    const B = await createSchool(t, "beta");
    await importRows([row(2, { fullName: "Pia Roy", className: "8", section: "A" })]);
    const before = await roster(t, A.sectionA);
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.mutation(api.imports.commitStudentRows, { rows: [row(2, { fullName: "Aa Bb", className: "8", section: "A" })], createAccounts: false, today: TODAY }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.mutation(api.academics.enrollStudent, { studentId: A.studentB, sectionId: A.sectionA, startDate: TODAY }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.mutation(api.academics.endEnrollment, { enrollmentId: before[0].enrollmentId as Id<"enrollments">, status: "withdrawn", endDate: TODAY }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.academics.enrollStudent, { studentId: A.studentB, sectionId: A.sectionA, startDate: TODAY }))).toBe("FORBIDDEN");
    const otherAdmin = await as(t, B.users.admin);
    expect(await errorCode(otherAdmin.mutation(api.academics.endEnrollment, { enrollmentId: before[0].enrollmentId as Id<"enrollments">, status: "withdrawn", endDate: TODAY }))).toBe("NOT_FOUND");
    expect(await errorCode(otherAdmin.mutation(api.academics.enrollStudent, { studentId: A.studentB, sectionId: A.sectionA, startDate: TODAY }))).toBe("NOT_FOUND");
    expect(await roster(t, A.sectionA)).toEqual(before);
  });

  test("concurrent imports into one section end with one consistent 1..n roster", async () => {
    const { t, A, importRows } = await setup();
    const batch = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => row(i + 2, { fullName: `${prefix}${String.fromCharCode(65 + i)} Kid`, className: "8", section: "A" }));
    await Promise.all([importRows(batch("Mo", 10)), importRows(batch("Ab", 10)), importRows(batch("Zo", 10))]);
    const r = await roster(t, A.sectionA);
    expect(r).toHaveLength(31);
    expect(rolls(r)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(names(r).map((n) => n.toLowerCase())).toEqual(names(r).map((n) => n.toLowerCase()).sort());
  });

  test("attendance and other records keep pointing at the same student/enrollment ids after renumbering", async () => {
    const { t, A, importRows } = await setup();
    const ids = await t.run(async (ctx) => {
      const session = await ctx.db.insert("attendanceSessions", { schoolId: A.schoolId, sectionId: A.sectionA, academicYearId: A.yearId, date: "2026-06-30", markedByUserId: A.users.classTeacher, markedByTeacherId: A.classTeacher, markedAt: Date.now(), presentCount: 1, absentCount: 0, lateCount: 0, excusedCount: 0 });
      const rec = await ctx.db.insert("attendanceRecords", { schoolId: A.schoolId, sessionId: session, sectionId: A.sectionA, studentId: A.studentA, date: "2026-06-30", status: "present" });
      const enr = (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", A.studentA)).first())!;
      return { rec, enr: enr._id };
    });
    await importRows([row(2, { fullName: "Aamir Khan", className: "8", section: "A" })]); // Asha moves from 1 to 2
    const after = await t.run(async (ctx) => ({ rec: await ctx.db.get(ids.rec), enr: await ctx.db.get(ids.enr) }));
    expect(after.rec).toMatchObject({ studentId: A.studentA, sectionId: A.sectionA });
    expect(after.enr).toMatchObject({ studentId: A.studentA, rollNo: 2, status: "active" });
  });

  test("scale: a 300-row import into a 700-student section renumbers all 1,000 in one transaction", async () => {
    const { t, A, importRows } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 699; i++) {
        const sid = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: `BULK-${i}`, firstName: `Name${String(i).padStart(4, "0")}`, lastName: "Existing", status: "active" });
        await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: sid, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionA, status: "active", startDate: "2026-04-01" });
      }
    });
    const started = Date.now();
    await importRows(Array.from({ length: 300 }, (_, i) => row(i + 2, { fullName: `New${String(i).padStart(3, "0")} Student`, className: "8", section: "A" })));
    const ms = Date.now() - started;
    const r = await roster(t, A.sectionA);
    expect(r).toHaveLength(1000);
    expect(rolls(r)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
    console.log(`[scale] 300-row import + 1,000-student renumber: ${ms} ms (convex-test)`);
    // One more would exceed the per-section limit: rejected before anything is written.
    expect(MAX_SECTION_ROSTER).toBe(1000);
    const preview = await (await as(t, A.users.admin)).query(api.imports.previewStudents, { rows: [row(2, { fullName: "One Too Many", className: "8", section: "A" })], createAccounts: false, today: TODAY });
    expect(preview.results[0].errors[0].message).toMatch(/more than 1000 students/);
  }, 120000);
});
