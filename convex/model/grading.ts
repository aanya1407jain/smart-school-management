/**
 * Grading schemes. Selected per school via schoolSettings.grading.scheme.
 * Add new schemes here (e.g. "percentage_only", "ib_7_point"); never hard-code
 * a scheme in module code.
 */
type Band = { grade: string; min: number; point: number; remark: string };

const SCHEMES: Record<string, Band[]> = {
  cbse_8_point: [
    { grade: "A1", min: 91, point: 10, remark: "Outstanding" },
    { grade: "A2", min: 81, point: 9, remark: "Excellent" },
    { grade: "B1", min: 71, point: 8, remark: "Very good" },
    { grade: "B2", min: 61, point: 7, remark: "Good" },
    { grade: "C1", min: 51, point: 6, remark: "Above average" },
    { grade: "C2", min: 41, point: 5, remark: "Average" },
    { grade: "D", min: 33, point: 4, remark: "Pass" },
    { grade: "E", min: 0, point: 0, remark: "Needs improvement" },
  ],
};

export function gradeFor(scheme: string, percent: number): string | undefined {
  const bands = SCHEMES[scheme];
  return bands?.find((b) => percent >= b.min)?.grade;
}
