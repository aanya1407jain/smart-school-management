/**
 * Explicit reconciliation of EXISTING roll numbers (convex/rollNumberMaintenance.ts):
 * read-only dry run, deliberate apply, school + year scoping, staleness
 * protection, idempotent re-runs, and the shared alphabetical rule.
 */
import { describe, expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { createSchool, makeTest, type T } from "./fixtures";

const CONFIRM = "APPLY_ROLL_NUMBER_RECONCILIATION";
type School = Awaited<ReturnType<typeof createSchool>>;

/** Legacy-shaped rows written straight to the DB (as old seed/import/admission code left them). */
async function addLegacy(t: T, S: School, sectionId: Id<"sections">, rows: [first: string, last: string, rollNo?: number][], yearId = S.yearId) {
  return await t.run(async (ctx) => {
    const ids: Id<"students">[] = [];
    for (const [first, last, rollNo] of rows) {
      const id = await ctx.db.insert("students", { schoolId: S.schoolId, admissionNo: `L-${first}-${last}-${ids.length}-${Math.random().toString(36).slice(2, 6)}`, firstName: first, lastName: last, status: "active" });
      await ctx.db.insert("enrollments", { schoolId: S.schoolId, studentId: id, academicYearId: yearId, classId: S.classId, sectionId, status: "active", startDate: "2026-04-01", ...(rollNo !== undefined ? { rollNo } : {}) });
      ids.push(id);
    }
    return ids;
  });
}

/** The section's active roster as [name, rollNo] in stored roll-number order (unnumbered last). */
const stored = (t: T, sectionId: Id<"sections">) => t.run(async (ctx) => {
  const es = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).collect();
  const out: [string, number | null][] = [];
  for (const e of es) { const s = (await ctx.db.get(e.studentId))!; out.push([`${s.firstName} ${s.lastName}`, e.rollNo ?? null]); }
  return out.sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9) || a[0].localeCompare(b[0]));
});

const snapshot = (t: T) => t.run(async (ctx) => JSON.stringify({
  enrollments: (await ctx.db.query("enrollments").collect()).map((e) => [e._id, e.rollNo ?? null]),
  audit: (await ctx.db.query("auditLogs").collect()).length,
}));

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  // Section A of alpha already holds "Asha S" (roll 1). Legacy: seed order, a duplicate, a missing number.
  await addLegacy(t, A, A.sectionA, [["Zoya", "Khan", 2], ["bina", "Rao", 2], ["Aarav", "Mehta"]]);
  // Section B of alpha: "Bala S" roll 1 + one more correct → already reconciled.
  await addLegacy(t, A, A.sectionB, [["Chitra", "S", 2]]);
  // Same legacy shape in another school.
  await addLegacy(t, B, B.sectionA, [["Zoya", "Khan", 2], ["Aarav", "Mehta"]]);
  return { t, A, B };
}

describe("roll-number reconciliation — dry run", () => {
  test("reports current vs proposed per student, missing/duplicate numbers, totals, and writes NOTHING", async () => {
    const { t, A } = await setup();
    const before = await snapshot(t);
    const r = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    expect(await snapshot(t)).toBe(before);
    expect(r).toMatchObject({ mode: "dry_run", writes: 0, school: { slug: "alpha" }, academicYear: { name: "2026-27", isCurrent: true }, nextStartAt: null });
    const secA = r.sections.find((s) => s.sectionId === A.sectionA)!;
    expect(secA).toMatchObject({ section: "8-A", activeEnrollments: 4, missingRollNos: 1, duplicateRollNos: [2], wouldChange: 4 });
    expect(secA.students.map((s) => [s.name, s.currentRollNo, s.proposedRollNo, s.changed])).toEqual([
      ["Aarav Mehta", null, 1, true],
      ["Asha S", 1, 2, true],
      ["bina Rao", 2, 3, true],
      ["Zoya Khan", 2, 4, true],
    ]);
    expect(secA.students.every((s) => s.studentId && s.enrollmentId && s.admissionNo)).toBe(true);
    const secB = r.sections.find((s) => s.sectionId === A.sectionB)!;
    expect(secB).toMatchObject({ wouldChange: 0, missingRollNos: 0, duplicateRollNos: [] });
    expect(r.totals).toMatchObject({ sections: 2, sectionsNeedingChanges: 1, activeEnrollments: 6, wouldChange: 4, missingRollNos: 1, sectionsWithDuplicateRollNos: 1 });
    expect(r.applyArgs).toEqual({ schoolSlug: "alpha", academicYear: "2026-27", confirm: CONFIRM, sections: [{ sectionId: A.sectionA, fingerprint: secA.fingerprint }] });
    // changedOnly trims unchanged students but keeps the section summary.
    const c = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27", changedOnly: true });
    expect(c.sections.find((s) => s.sectionId === A.sectionB)!.students).toEqual([]);
    // startAt continues after the first section.
    const tail = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27", startAt: 1 });
    expect(tail.sections.map((s) => s.section)).toEqual(["8-B"]);
  });

  test("unknown school or year is an error, never a guess", async () => {
    const { t } = await setup();
    await expect(t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "nope", academicYear: "2026-27" })).rejects.toThrow(/No school/);
    await expect(t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2030-31" })).rejects.toThrow(/no academic year/);
  });
});

describe("roll-number reconciliation — apply", () => {
  test("applies only the selected school + year, atomically per section, with an audit row", async () => {
    const { t, A, B } = await setup();
    // Another year of the same school with legacy numbers must stay untouched.
    const other = await t.run(async (ctx) => {
      const y = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });
      const sec = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: y, classId: A.classId, name: "A", displayName: "8-A" });
      return { y, sec };
    });
    await addLegacy(t, A, other.sec, [["Zed", "Z", 1], ["Abe", "A", 2]], other.y);
    const betaBefore = await stored(t, B.sectionA);
    const otherBefore = await stored(t, other.sec);

    const dry = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    const res = await t.action(internal.rollNumberMaintenance.apply, dry.applyArgs!);
    expect(res).toMatchObject({ mode: "apply", changed: 4, applied: 1, stale: 0, failed: 0 });
    expect(await stored(t, A.sectionA)).toEqual([["Aarav Mehta", 1], ["Asha S", 2], ["bina Rao", 3], ["Zoya Khan", 4]]);
    expect(await stored(t, B.sectionA)).toEqual(betaBefore); // other school untouched
    expect(await stored(t, other.sec)).toEqual(otherBefore); // other year untouched
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === "enrollment.roll_numbers_reconciled"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ schoolId: A.schoolId, entity: { table: "sections", id: A.sectionA }, metadata: { changed: 4, size: 4 } });
  });

  test("re-running is idempotent: a fresh dry run proposes nothing; re-applying writes nothing", async () => {
    const { t } = await setup();
    const dry = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    await t.action(internal.rollNumberMaintenance.apply, dry.applyArgs!);
    const after = await snapshot(t);
    const again = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    expect(again.totals.wouldChange).toBe(0);
    expect(again.applyArgs).toBeNull();
    const re = await t.action(internal.rollNumberMaintenance.apply, dry.applyArgs!);
    expect(re).toMatchObject({ changed: 0, applied: 0, alreadyReconciled: 1 });
    expect(await snapshot(t)).toBe(after);
  });

  test("a roster changed after the dry run is reported stale and not written", async () => {
    const { t, A } = await setup();
    const dry = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    await addLegacy(t, A, A.sectionA, [["Mira", "Das", 9]]);
    const before = await snapshot(t);
    const res = await t.action(internal.rollNumberMaintenance.apply, dry.applyArgs!);
    expect(res).toMatchObject({ changed: 0, stale: 1, applied: 0 });
    expect(await snapshot(t)).toBe(before);
    // A renamed student also invalidates the reviewed plan.
    const dry2 = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    await t.run(async (ctx) => { const s = (await ctx.db.query("students").collect()).find((x) => x.firstName === "Zoya")!; await ctx.db.patch(s._id, { firstName: "Anaya" }); });
    expect((await t.action(internal.rollNumberMaintenance.apply, dry2.applyArgs!)).stale).toBe(1);
  });

  test("apply requires the explicit confirmation and re-validates school / year / section", async () => {
    const { t, A, B } = await setup();
    const dry = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    const before = await snapshot(t);
    await expect(t.action(internal.rollNumberMaintenance.apply, { ...dry.applyArgs!, confirm: "yes" })).rejects.toThrow(/confirm must be/);
    await expect(t.mutation(internal.rollNumberMaintenance.applySection, { schoolSlug: "alpha", academicYear: "2026-27", sectionId: A.sectionA, fingerprint: dry.applyArgs!.sections[0].fingerprint, confirm: "" })).rejects.toThrow(/confirm must be/);
    // Another school's section under alpha's name → failed, nothing written.
    const betaDry = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "beta", academicYear: "2026-27" });
    const cross = await t.action(internal.rollNumberMaintenance.apply, { schoolSlug: "alpha", academicYear: "2026-27", confirm: CONFIRM, sections: [{ sectionId: B.sectionA, fingerprint: betaDry.applyArgs!.sections[0].fingerprint }] });
    expect(cross).toMatchObject({ failed: 1, changed: 0 });
    expect(cross.results[0].message).toMatch(/not found in this school/);
    // A section of a different year than the one named → failed.
    const otherYear = await t.run(async (ctx) => {
      const y = await ctx.db.insert("academicYears", { schoolId: A.schoolId, name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" });
      return await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: y, classId: A.classId, name: "A", displayName: "8-A" });
    });
    const wrongYear = await t.action(internal.rollNumberMaintenance.apply, { schoolSlug: "alpha", academicYear: "2026-27", confirm: CONFIRM, sections: [{ sectionId: otherYear, fingerprint: "x" }] });
    expect(wrongYear.results[0]).toMatchObject({ status: "failed" });
    expect(wrongYear.results[0].message).toMatch(/does not belong to academic year/);
    expect(await snapshot(t)).toBe(before);
  });

  test("ordering rule: first then last name, case/accent/space-insensitive; identical names by student id", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const ids = await addLegacy(t, A, A.sectionB, [["Aarav", "Mehta", 5], ["  aarav ", "mehta", 4], ["Élan", "Roy", 3], ["elan", "Bose", 2], ["Zara", "Ali", 1]]);
    const dry = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    const names = dry.sections.find((s) => s.sectionId === A.sectionB)!.students.map((s) => s.studentId);
    const [aarav1, aarav2] = [ids[0], ids[1]].sort();
    const bala = A.studentB; // "Bala S"
    expect(names).toEqual([aarav1, aarav2, bala, ids[3], ids[2], ids[4]]);
    // Deterministic: same answer on every run.
    const dry2 = await t.query(internal.rollNumberMaintenance.dryRun, { schoolSlug: "alpha", academicYear: "2026-27" });
    expect(dry2.sections.find((s) => s.sectionId === A.sectionB)!.students.map((s) => s.studentId)).toEqual(names);
  });
});
