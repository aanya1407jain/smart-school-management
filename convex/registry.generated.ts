/**
 * GENERATED composition root — modules selected for this build.
 *
 * Written by scripts/distribute.ts for each customer export; this checked-in
 * copy is the internal full build (all five modules). Only Core reads it, via
 * convex/core/registry.ts. Do not import it from a module.
 */
import type { ModuleId } from "./contracts/manifest";
import type { ProviderRegistry } from "./contracts/providers";
import { studentsProviders } from "./model/studentProviders";
import { attendanceOverviewProviders, attendanceProviders } from "./model/attendanceRecords";
import { academicsProviders } from "./model/academicsRecords";
import { feesOverviewProviders, feesProviders } from "./model/feeRecords";
import { examinationsOverviewProviders, examinationsProviders } from "./model/examRecords";

export const SELECTED_MODULES: readonly ModuleId[] = ["students", "attendance", "academics", "fees", "examinations"];

/**
 * Built on first use, not at import: provider files import Core, which imports
 * this file, so at import time a provider set may not be initialised yet.
 */
let built: ProviderRegistry | null = null;
export function providers(): ProviderRegistry {
  return (built ??= {
    ...studentsProviders,
    ...attendanceProviders,
    ...attendanceOverviewProviders,
    ...academicsProviders,
    ...feesProviders,
    ...feesOverviewProviders,
    ...examinationsProviders,
    ...examinationsOverviewProviders,
  });
}
