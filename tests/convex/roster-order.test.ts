/**
 * Roster READS follow the documented alphabetical rule regardless of stored
 * (possibly legacy) roll numbers, and the Accounts & Import people list is
 * sorted before pagination with complete, duplicate-free pages.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;

async function addStudents(t: T, S: School, sectionId: Id<"sections">, rows: [first: string, last: string, rollNo?: number, status?: "active" | "inactive"][]) {
  return await t.run(async (ctx) => {
    const ids: Id<"students">[] = [];
    for (const [first, last, rollNo, status] of rows) {
      const id = await ctx.db.insert("students", { schoolId: S.schoolId, admissionNo: `R-${first}-${last}-${ids.length}`, firstName: first, lastName: last, status: status ?? "active" });
      await ctx.db.insert("enrollments", { schoolId: S.schoolId, studentId: id, academicYearId: S.yearId, classId: S.classId, sectionId, status: "active", startDate: "2026-04-01", ...(rollNo !== undefined ? { rollNo } : {}) });
      ids.push(id);
    }
    return ids;
  });
}

type Page = { page: { personId: string; name: string; rollNo: number | null }[]; isDone: boolean; continueCursor: string; splitCursor?: string | null; pageStatus?: string | null };

describe("attendance register and section roster order", () => {
  test("alphabetical by first then last name even with legacy roll numbers; stored numbers are displayed unchanged", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await addStudents(t, A, A.sectionA, [["Zoya", "Khan", 2], ["bina", "Rao", 3], ["Aarav", "Mehta"], ["Aarav", "Ahuja", 9]]);
    const teacher = await as(t, A.users.classTeacher);
    const reg = await teacher.query(api.attendance.getByDate, { sectionId: A.sectionA, date: "2026-07-01", today: "2026-07-01" });
    expect(reg.students.map((s) => [s.name, s.rollNo])).toEqual([["Aarav Ahuja", 9], ["Aarav Mehta", null], ["Asha S", 1], ["bina Rao", 3], ["Zoya Khan", 2]]);
    const roster = await teacher.query(api.academics.sectionRoster, { sectionId: A.sectionA });
    expect(roster.students.map((s) => s.name)).toEqual(reg.students.map((s) => s.name));
    // Nothing was renumbered by reading.
    expect(await t.run(async (ctx) => (await ctx.db.query("enrollments").collect()).filter((e) => e.rollNo === undefined).length)).toBe(1);
  });

  test("identical names are ordered by student id, deterministically", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const ids = await addStudents(t, A, A.sectionA, [["Kabir", "Rao", 1], ["kabir", "rao", 2], ["Kabir", "  Rao", 3]]);
    const admin = await as(t, A.users.admin);
    const reg = await admin.query(api.attendance.getByDate, { sectionId: A.sectionA, date: "2026-07-01", today: "2026-07-01" });
    expect(reg.students.filter((s) => /kabir/i.test(s.name)).map((s) => s.studentId)).toEqual([...ids].sort());
  });

  test("permissions and isolation are unchanged", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const student = await as(t, A.users.student);
    expect(await errorCode(student.query(api.attendance.getByDate, { sectionId: A.sectionB, date: "2026-07-01", today: "2026-07-01" }))).toBe("FORBIDDEN");
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.query(api.attendance.getByDate, { sectionId: B.sectionA, date: "2026-07-01", today: "2026-07-01" }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.query(api.academics.sectionRoster, { sectionId: B.sectionA }))).toBe("NOT_FOUND");
    // Only the class teacher marks.
    const subject = await as(t, A.users.subjectTeacher);
    expect(await errorCode(subject.mutation(api.attendance.mark, { sectionId: A.sectionA, date: "2026-07-01", entries: [{ studentId: A.studentA, status: "present" }] }))).toBe("FORBIDDEN");
  });
});

describe("accounts.listPeople ordering and pagination", () => {
  async function setup() {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    await addStudents(t, A, A.sectionA, [
      ["Zoya", "Khan", 2], ["Mira", "Das", 3], ["aarav", "Mehta"], ["Ishaan", "Bose", 4],
      ["Gone", "Away", 5, "inactive"], ["Farah", "Ali", 6], ["Élan", "Roy", 7], ["Chitra", "Zed"],
    ]);
    await addStudents(t, B, B.sectionA, [["Aaron", "Other"]]);
    return { t, A, B, admin: await as(t, A.users.admin) };
  }

  /** Load every page the way usePaginatedQuery does (follow continueCursor). */
  async function allPages(load: (cursor: string | null) => Promise<Page>) {
    const pages: Page[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const p = await load(cursor);
      pages.push(p);
      if (p.isDone) break;
      cursor = p.continueCursor;
    }
    return pages;
  }

  const EXPECTED_SECTION = ["aarav Mehta", "Asha S", "Chitra Zed", "Élan Roy", "Farah Ali", "Ishaan Bose", "Mira Das", "Zoya Khan"];

  test("section filter: alphabetical BEFORE pagination, inactive filtered first, no gaps or duplicates", async () => {
    const { admin, A } = await setup();
    for (const n of [1, 2, 3, 7, 50]) {
      const pages = await allPages((cursor) => admin.query(api.accounts.listPeople, { kind: "student", sectionId: A.sectionA, paginationOpts: { numItems: n, cursor } }) as Promise<Page>);
      const names = pages.flatMap((p) => p.page.map((x) => x.name));
      expect(names, `page size ${n}`).toEqual(EXPECTED_SECTION);
      expect(pages.slice(0, -1).every((p) => p.page.length === n)).toBe(true); // full pages (filtering never shortens them)
    }
  });

  test("all students: first-name-then-last-name rule (not surname), own school only", async () => {
    const { admin } = await setup();
    const pages = await allPages((cursor) => admin.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 3, cursor } }) as Promise<Page>);
    expect(pages.flatMap((p) => p.page.map((x) => x.name))).toEqual(["aarav Mehta", "Asha S", "Bala S", "Chitra Zed", "Élan Roy", "Farah Ali", "Ishaan Bose", "Mira Das", "Zoya Khan"]);
  });

  test("pinned page ranges stay complete and duplicate-free while students are added or removed", async () => {
    const { t, A, admin } = await setup();
    const q = (opts: { numItems: number; cursor: string | null; endCursor?: string }) =>
      admin.query(api.accounts.listPeople, { kind: "student", sectionId: A.sectionA, paginationOpts: opts }) as Promise<Page>;
    const first = await q({ numItems: 3, cursor: null });
    expect(first).toMatchObject({ isDone: false, pageStatus: "SplitRecommended" });
    expect(first.splitCursor).toBeTruthy();
    const second = await q({ numItems: 3, cursor: first.continueCursor });
    // The client pins page 1 as (null, split] + (split, continueCursor]; page 2 starts after continueCursor.
    const pinned = async () => [
      ...(await q({ numItems: 3, cursor: null, endCursor: first.splitCursor! })).page,
      ...(await q({ numItems: 3, cursor: first.splitCursor!, endCursor: first.continueCursor })).page,
      ...(await q({ numItems: 3, cursor: first.continueCursor, endCursor: second.continueCursor })).page,
      ...(await q({ numItems: 3, cursor: second.continueCursor })).page, // last page is open-ended
    ].map((x) => x.name);
    expect(await pinned()).toEqual(EXPECTED_SECTION);
    // A student added inside page 1's range, one removed from it, one renamed across pages.
    await addStudents(t, A, A.sectionA, [["Bhavna", "K", 99]]);
    await t.run(async (ctx) => {
      const all = await ctx.db.query("students").collect();
      await ctx.db.patch(all.find((s) => s.firstName === "Chitra")!._id, { status: "inactive" });
      await ctx.db.patch(all.find((s) => s.firstName === "Zoya")!._id, { firstName: "Anika" });
    });
    expect(await pinned()).toEqual(["aarav Mehta", "Anika Khan", "Asha S", "Bhavna K", "Élan Roy", "Farah Ali", "Ishaan Bose", "Mira Das"]);
  });

  test("a malformed or legacy cursor asks the client to restart; permissions and isolation hold", async () => {
    const { t, A, B, admin } = await setup();
    await expect(admin.query(api.accounts.listPeople, { kind: "student", sectionId: A.sectionA, paginationOpts: { numItems: 3, cursor: "not-a-cursor" } })).rejects.toThrow(/InvalidCursor/);
    expect(await errorCode(admin.query(api.accounts.listPeople, { kind: "student", sectionId: B.sectionA, paginationOpts: { numItems: 3, cursor: null } }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.accounts.listPeople, { kind: "student", sectionId: A.sectionA, paginationOpts: { numItems: 3, cursor: null } }))).toBe("FORBIDDEN");
  });
});
