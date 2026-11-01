/**
 * GENERATED composition root (frontend UI contributions): the contributions of
 * the modules shipped in this build. This checked-in copy is the full build;
 * scripts/distribute.ts rewrites it per product export. Only Core reads it
 * (src/lib/contributions).
 */
import type { ModuleUiContributions } from "@/lib/contributions/types";
import { studentsUi } from "./students/contributions";
import { attendanceUi } from "./attendance/contributions";
import { academicsUi } from "./academics/contributions";
import { feesUi } from "./fees/contributions";
import { examinationsUi } from "./examinations/contributions";

export const UI_CONTRIBUTIONS: readonly ModuleUiContributions[] = [studentsUi, attendanceUi, academicsUi, feesUi, examinationsUi];
