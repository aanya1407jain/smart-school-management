/**
 * GENERATED composition root (frontend): the manifests of the modules shipped
 * in this build. This checked-in copy is the full build; scripts/distribute.ts
 * rewrites it for each product export. Navigation and route guards
 * (src/lib/permissions) are built from it; nothing else imports a manifest.
 */
import type { CoreContributions, ModuleManifest } from "../../convex/contracts/manifest";
import { core } from "./manifests/core";
import { students } from "./manifests/students";
import { attendance } from "./manifests/attendance";
import { academics } from "./manifests/academics";
import { fees } from "./manifests/fees";
import { examinations } from "./manifests/examinations";

export const CORE: CoreContributions = core;
export const MODULE_MANIFESTS: readonly ModuleManifest[] = [students, attendance, academics, fees, examinations];
