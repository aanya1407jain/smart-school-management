/**
 * Fee reports (Fees): billed / concession / collected / outstanding per class. Moved from convex/reports.ts.
 */
import { v } from "convex/values";
import { moduleQuery } from "./core/functions";
import { requireModule } from "./model/modules";
import { getCurrentAcademicYearId, getInSchool, requireAnyPermission } from "./core/authorization";
import { todayIn } from "./model/calendar";
import { feeByClass } from "./model/feeRecords";

const administrationQuery = moduleQuery("administration");

/** Fee position for the year, per class. Reads each enrolled student's ledger once (≤ 5000 students). */
export const feeSummary = administrationQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    await requireModule(ctx, ctx.actor.schoolId, "finance"); // data comes from that module (administration checked by the wrapper)
    requireAnyPermission(ctx.actor, ["reports:finance", "fees:manage"]);
    const yearId = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const year = (await ctx.db.get(yearId))!;
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    return { academicYear: year.name, ...(await feeByClass(ctx, ctx.actor.schoolId, yearId, today)) };
  },
});
