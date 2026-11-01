/**
 * GENERATED composition — scheduled jobs contributed by the modules selected
 * for this build (module manifests, `backend.crons`). Written by
 * scripts/distribute.ts for each customer export; this checked-in copy is the
 * internal full build.
 *
 * Fees: fee-due reminders run once a day (02:30 UTC = 08:00 IST); see
 * convex/feeReminders.ts for the rules, dedupe keys and settings check.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("fee-due reminders", { hourUTC: 2, minuteUTC: 30 }, internal.feeReminders.runDaily, {});
export default crons;
