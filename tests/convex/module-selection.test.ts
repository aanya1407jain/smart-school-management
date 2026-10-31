/**
 * Module selection (docs/modularization/02-step1-contracts-and-registries.md §8).
 *
 * Product closure is validated, never auto-completed. For the Students +
 * Attendance product the inclusion plan must contain no Academics, Fees or
 * Examinations files, and the files it would ship that still depend on those
 * modules are a ratchet (sa-blockers-baseline.json) that must reach zero before
 * the export step. This proves the PLAN, not yet the built export.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SA_BLOCKERS_PATH, inclusionPlan, resolveClosure } from "../../scripts/modularity/select";
import { BASE_MODULE, REQUIRES, ownerOf } from "../../scripts/modularity/ownership";
import { violationKey } from "../../scripts/modularity/boundaries";

const ROOT = join(__dirname, "../..");
const codes = (sel: string[]) => resolveClosure(sel).problems.map((p) => p.code);

describe("product closure", () => {
  test("valid products", () => {
    for (const p of [["students"], ["students", "attendance"], ["students", "fees"], ["students", "attendance", "fees"], ["students", "academics"], ["students", "academics", "examinations"], ["students", "attendance", "academics", "fees", "examinations"]]) {
      expect(codes(p), p.join("+")).toEqual([]);
    }
  });

  test("missing required modules are reported, never added", () => {
    expect(codes(["attendance"])).toEqual(["MISSING_REQUIRED"]);
    expect(resolveClosure(["attendance"]).modules).toEqual(["attendance"]); // students NOT added
    expect(codes(["fees"])).toEqual(["MISSING_REQUIRED"]);
    expect(codes(["academics"])).toEqual(["MISSING_REQUIRED"]); // R1
    expect(resolveClosure(["students", "examinations"]).problems.map((p) => p.detail).join(" ")).toMatch(/examinations requires academics/);
  });

  test("unknown, duplicate and empty selections are rejected", () => {
    expect(codes(["students", "library"])).toContain("UNKNOWN_MODULE");
    expect(codes(["students", "students"])).toContain("DUPLICATE");
    expect(codes([])).toContain("EMPTY");
    expect(codes(["core"])).toContain("UNKNOWN_MODULE"); // core is not selectable; it always ships
  });
});

describe("Students + Attendance without Academics", () => {
  const plan = inclusionPlan(ROOT, ["students", "attendance"]);

  test("the plan ships no Academics, Fees or Examinations file", () => {
    expect(plan.excludedModules).toEqual(["academics", "fees", "examinations"]);
    const leaked = plan.included.filter((f) => ["academics", "fees", "examinations"].includes(ownerOf(f) ?? ""));
    expect(leaked).toEqual([]);
    // Every excluded module really owns files today (so exclusion is meaningful).
    for (const m of ["academics", "fees", "examinations"]) expect(plan.excluded.some((f) => ownerOf(f) === m), m).toBe(true);
  });

  test("blockers only shrink (ratchet to zero before the export step)", () => {
    const baseline = new Set<string>(JSON.parse(readFileSync(join(ROOT, SA_BLOCKERS_PATH), "utf8")).blockers);
    const now = plan.blockers.map(violationKey);
    expect(now.filter((k) => !baseline.has(k)), "New dependency from a Students/Attendance/Core file on Academics, Fees or Examinations").toEqual([]);
    expect([...baseline].filter((k) => !now.includes(k)), "Blockers fixed — shrink the baseline: npx tsx scripts/modularity/select.ts students attendance --write-sa-baseline").toEqual([]);
  });

  test("no transitional (mixed-owner) file is left to ship", () => {
    // Step 2 split every mixed file; a new one would have to be split before an export.
    expect(plan.transitional).toEqual([]);
  });
});

describe("base module", () => {
  test("every valid product contains the base module (Core may reference it)", () => {
    const ids = ["students", "attendance", "academics", "fees", "examinations"] as const;
    // Every non-empty subset that resolves without problems includes Students.
    for (let mask = 1; mask < 1 << ids.length; mask++) {
      const product = ids.filter((_, i) => mask & (1 << i));
      const { problems } = resolveClosure([...product]);
      if (problems.length === 0) expect(product, product.join("+")).toContain(BASE_MODULE);
    }
    for (const m of ids.filter((x) => x !== BASE_MODULE)) expect(REQUIRES[m], m).toContain(BASE_MODULE);
  });
});
