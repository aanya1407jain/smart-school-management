/**
 * Module boundaries (docs/modularization/01-audit-and-target-design.md, step 0).
 *
 * A ratchet, not a snapshot: every file and table must have a target owner,
 * the module dependency graph must be acyclic, and no NEW cross-module
 * dependency may appear. Known violations live in
 * docs/modularization/boundary-baseline.json; when a change removes one, the
 * test asks for the baseline to be shrunk (npx tsx scripts/modularity/boundaries.ts --baseline),
 * so fixed violations cannot quietly come back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BASELINE_PATH, bypassesPublicEntry, scan, schemaReferences, schemaTables, stripCommentLines, violationKey } from "../../scripts/modularity/boundaries";
import { REQUIRES, TABLE_OWNER, findRequiresCycle, mayDepend } from "../../scripts/modularity/ownership";

const ROOT = join(__dirname, "../..");
const report = scan(ROOT);
const baseline = new Set<string>(JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), "utf8")).violations);

describe("module ownership", () => {
  test("every source file has a target owner", () => {
    expect(report.unowned).toEqual([]);
  });

  test("every schema table has exactly one owner, and every accessed table is declared", () => {
    expect(schemaTables(ROOT).filter((t) => !TABLE_OWNER[t])).toEqual([]);
    expect(report.unownedTables).toEqual([]);
  });

  test("the required-module graph is acyclic and only names known modules", () => {
    expect(findRequiresCycle()).toBeNull();
    for (const deps of Object.values(REQUIRES)) for (const d of deps) expect(Object.keys(REQUIRES).concat("core")).toContain(d);
  });
});

describe("dependency rules", () => {
  test("core depends on no business module except the base module; modules only on core and their required modules", () => {
    expect(mayDepend("students", "core")).toBe(true);
    expect(mayDepend("core", "students")).toBe(true); // Students is the base module (every product contains it)
    for (const m of ["attendance", "academics", "fees", "examinations"] as const) expect(mayDepend("core", m), m).toBe(false);
    expect(mayDepend("attendance", "students")).toBe(true);
    expect(mayDepend("attendance", "academics")).toBe(false); // optional integration ⇒ contract, never import
    expect(mayDepend("examinations", "academics")).toBe(true);
    expect(mayDepend("fees", "examinations")).toBe(false);
    expect(mayDepend("students", "fees")).toBe(false);
    expect(mayDepend("fees", "transitional")).toBe(false);
  });

  test("Academics requires Students (R1); Students + Attendance needs no Academics", () => {
    expect(REQUIRES.academics).toEqual(["students"]);
    expect(REQUIRES.students).toEqual([]);
    expect(REQUIRES.attendance).toEqual(["students"]);
  });

  test("cycle detection catches a cycle", () => {
    expect(findRequiresCycle({ a: ["b"], b: ["c"], c: ["a"] })).toEqual(["a", "b", "c", "a"]);
    expect(findRequiresCycle({ a: ["b"], b: [] })).toBeNull();
  });
});

describe("boundary ratchet", () => {
  const current = report.violations.map(violationKey);

  test("no new cross-module dependency", () => {
    const added = current.filter((k) => !baseline.has(k));
    expect(added, "New module-boundary violations. Depend on core/contracts or a required module's public entry instead.").toEqual([]);
  });

  test("fixed violations are removed from the baseline", () => {
    const now = new Set(current);
    const fixed = [...baseline].filter((k) => !now.has(k));
    expect(fixed, `These violations are gone — shrink the baseline: npx tsx scripts/modularity/boundaries.ts --baseline`).toEqual([]);
  });
});

describe("scanner rules", () => {
  test("lines that are comments are not dependencies; code is never hidden", () => {
    const src = [
      "/**",
      " *   const x = useSchoolQuery(api.attendance.getByDate, {});",
      " */",
      "// import { y } from \"@/features/fees/fee-tables\";",
      "const url = \"https://example.com//path\"; import { z } from \"./z\";",
      "const re = /\\/\\*/; api.fees.list;",
    ].join("\n");
    const kept = stripCommentLines(src);
    expect(kept).not.toContain("api.attendance");
    expect(kept).not.toContain("fee-tables");
    expect(kept).toContain("import { z }"); // a URL with // does not swallow the line
    expect(kept).toContain("api.fees.list"); // a regex containing /* is not treated as a comment
  });

  test("public-entry rule (V9): deep imports into a module with declared entries are flagged", () => {
    const entries = { students: ["src/modules/students/index.ts"] } as const;
    expect(bypassesPublicEntry("fees", "src/modules/students/ui/private.tsx", "students", entries)).toBe(true);
    expect(bypassesPublicEntry("fees", "src/modules/students/index.ts", "students", entries)).toBe(false);
    expect(bypassesPublicEntry("students", "src/modules/students/ui/private.tsx", "students", entries)).toBe(false); // own files
    expect(bypassesPublicEntry("fees", "src/lib/utils/cn.ts", "core", entries)).toBe(false); // core is open
    expect(bypassesPublicEntry("fees", "src/features/attendance/x.tsx", "attendance", entries)).toBe(false); // dormant: no entries yet
  });

  test("schema references are scanned per table, and known cross-owner references are in the baseline", () => {
    const refs = Object.fromEntries(schemaReferences(ROOT).map((t) => [t.table, t.refs]));
    expect(refs.enrollments).toEqual(expect.arrayContaining(["students", "sections", "academicYears", "classes"]));
    // teachers -> subjects was fixed in step 2 (specialisations are plain ids validated through academics.subjects).
    // schoolMemberships -> students is allowed since step 3: Students is the base module (ownership.ts BASE_MODULE).
    expect(refs.schoolMemberships).toEqual(expect.arrayContaining(["students"]));
    expect(baseline.has("schema convex/schema.ts#schoolMemberships -> students")).toBe(false);
    expect(baseline.has("schema convex/schema.ts#teachers -> subjects")).toBe(false);
  });
});
