/**
 * Students providers (contracts/providers.ts): display rosters for other
 * modules. Callers authorize section access first.
 */
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { ProviderContracts, StudentRosterProvider } from "../contracts/providers";
import { activeRoster, fullName } from "./academics";
import { activeStudentRecordIds, enrolledStudents } from "./studentCounts";

const roster: StudentRosterProvider = {
  async activeRoster(ctx: QueryCtx, sectionId: Id<"sections">) {
    return (await activeRoster(ctx, sectionId)).map(({ student, enrollment }) => ({ studentId: student._id, name: fullName(student), rollNo: enrollment.rollNo ?? null }));
  },
  async enrolledCount(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">) {
    // Same rule as the Students page (model/studentCounts.ts): distinct students enrolled this year.
    return (await enrolledStudents(ctx, schoolId, yearId)).size;
  },
  async enrollmentHealth(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">) {
    const active = await activeStudentRecordIds(ctx, schoolId);
    const enrolled = await enrolledStudents(ctx, schoolId, yearId, active);
    let notEnrolled = 0;
    for (const id of active) if (!enrolled.has(id)) notEnrolled++;
    return { enrolled: enrolled.size, activeRecords: active.size, notEnrolled };
  },
};

export const studentsProviders = { "students.roster": roster } satisfies Pick<ProviderContracts, "students.roster">;
