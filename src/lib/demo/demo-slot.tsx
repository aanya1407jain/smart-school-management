"use client";
import type { ReactNode } from "react";
import { demoRuntime } from "./runtime";

/**
 * Mounts a demo-only screen by id (see DemoRuntime.slots). Shipped code never
 * imports demo screens; in builds without the demo layer the fallback renders
 * (no session is ever "demo" there, so this is only a safety net).
 */
export function DemoSlot({ id, props = {}, fallback = null }: { id: string; props?: Record<string, unknown>; fallback?: ReactNode }) {
  const Screen = demoRuntime()?.slots[id];
  return Screen ? <Screen {...props} /> : <>{fallback}</>;
}
