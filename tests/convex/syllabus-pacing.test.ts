/** Syllabus pacing rule (src/features/academics/pacing.ts). */
import { describe, expect, test } from "vitest";
import { expectedPct, pacingOf } from "../../src/features/academics/pacing";

const plan = { startDate: "2026-04-01", targetDate: "2027-02-15" };

describe("syllabus pacing", () => {
  test("expected progress is a straight line from start to target, clamped to 0–100", () => {
    expect(expectedPct(plan, "2026-04-01")).toBe(0);
    expect(expectedPct(plan, "2027-02-15")).toBe(100);
    expect(expectedPct(plan, "2027-06-01")).toBe(100);
    expect(expectedPct(plan, "2026-01-01")).toBe(0);
    expect(Math.round(expectedPct(plan, "2026-10-27"))).toBe(65);
  });

  test("behind only when more than 10 points under the line; completed wins", () => {
    const at = (done: number, total: number) => pacingOf({ ...plan, completedChapters: done, totalChapters: total }, "2026-10-27").status;
    expect(at(9, 15)).toBe("on_schedule"); // 60% vs 65% expected
    expect(at(6, 16)).toBe("behind"); // 38%
    expect(at(7, 18)).toBe("behind"); // 39%
    expect(at(11, 14)).toBe("on_schedule"); // ahead
    expect(at(14, 14)).toBe("completed");
  });
});
