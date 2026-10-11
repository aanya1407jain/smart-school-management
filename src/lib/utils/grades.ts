/** CBSE-style 8-point grading scale. */
export const GRADE_SCALE = [
  { grade: "A1", min: 91, point: 10, remark: "Outstanding" },
  { grade: "A2", min: 81, point: 9, remark: "Excellent" },
  { grade: "B1", min: 71, point: 8, remark: "Very good" },
  { grade: "B2", min: 61, point: 7, remark: "Good" },
  { grade: "C1", min: 51, point: 6, remark: "Above average" },
  { grade: "C2", min: 41, point: 5, remark: "Average" },
  { grade: "D", min: 33, point: 4, remark: "Pass" },
  { grade: "E", min: 0, point: 0, remark: "Needs improvement" },
] as const;

export type Grade = (typeof GRADE_SCALE)[number]["grade"];

export function gradeFor(percent: number) {
  return GRADE_SCALE.find((g) => percent >= g.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1];
}

export function percentOf(obtained: number, max: number) {
  return max === 0 ? 0 : (obtained / max) * 100;
}
