/**
 * GENERATED composition root: the internal DEMO runtime (D4). This checked-in
 * copy is the internal full build; scripts/distribute.ts writes
 * `export const DEMO = null` for every customer export, so no demo code ships.
 * Only Core reads it, through src/lib/demo/runtime.ts.
 */
import type { DemoRuntime } from "@/lib/demo/runtime";
import { demoRuntime } from "@/lib/services/runtime";

export const DEMO: DemoRuntime | null = demoRuntime;
