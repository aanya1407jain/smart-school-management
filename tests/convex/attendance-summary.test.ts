/**
 * The demo "My Attendance" arithmetic (src/features/attendance/attendance-summary.ts)
 * follows the backend rules of attendance.studentHistory: excused days are not
 * counted, late counts only when the school setting says so, no data → null.
 */
import { describe, expect, test } from "vitest";
import { latestRecordDate, monthlyAttendance, summarizeAttendance, type AttendanceRecord } from "../../src/features/attendance/attendance-summary";

const R = (date: string, status: AttendanceRecord["status"]): AttendanceRecord => ({ date, status });
const records = [R("2026-09-02", "present"), R("2026-09-03", "late"), R("2026-09-04", "absent"), R("2026-09-05", "excused"), R("2026-10-01", "present"), R("2026-10-02", "excused")];

describe("summarizeAttendance", () => {
  test("late counts as present only when the setting is on; excused days are excluded", () => {
    expect(summarizeAttendance(records, { lateCountsAsPresent: true })).toEqual({ present: 2, late: 1, absent: 1, excused: 2, recorded: 6, counted: 4, attended: 3, percentage: 75 });
    expect(summarizeAttendance(records, { lateCountsAsPresent: false })).toMatchObject({ counted: 4, attended: 2, percentage: 50 });
  });

  test("only excused days or no records → null, never a made-up percentage", () => {
    expect(summarizeAttendance([R("2026-10-02", "excused")], { lateCountsAsPresent: true }).percentage).toBeNull();
    expect(summarizeAttendance([], { lateCountsAsPresent: true })).toMatchObject({ recorded: 0, percentage: null });
  });

  test("rounds to one decimal like the backend", () => {
    expect(summarizeAttendance([R("a", "present"), R("b", "present"), R("c", "absent")], { lateCountsAsPresent: true }).percentage).toBe(66.7);
  });
});

describe("monthlyAttendance / latestRecordDate", () => {
  test("months oldest first, excused-only months omitted, independent of input order", () => {
    const shuffled = [...records].reverse();
    expect(monthlyAttendance(shuffled, { lateCountsAsPresent: false })).toEqual([{ month: "2026-09", percentage: 33.3 }, { month: "2026-10", percentage: 100 }]);
    expect(monthlyAttendance([R("2026-11-01", "excused")], { lateCountsAsPresent: true })).toEqual([]);
  });

  test("the calendar opens on the latest record's month whether records are oldest- or newest-first", () => {
    expect(latestRecordDate(records)).toBe("2026-10-02");
    expect(latestRecordDate([...records].reverse())).toBe("2026-10-02");
    expect(latestRecordDate([])).toBeNull();
  });
});
