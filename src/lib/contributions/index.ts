/** Read the UI contributions of the modules shipped in this build (see types.ts). */
import { UI_CONTRIBUTIONS } from "@/modules/ui.generated";
import type { ModuleKey } from "@convex/core/modules";
import type { ModuleUiContributions } from "./types";

export * from "./types";

/** Contributions to one slot, in order, limited to modules the school has enabled. */
export function contributionsTo<K extends keyof ModuleUiContributions>(slot: K, hasModule: (m: ModuleKey) => boolean): NonNullable<ModuleUiContributions[K]>[] {
  return UI_CONTRIBUTIONS
    .map((c) => c[slot])
    .filter((x): x is NonNullable<ModuleUiContributions[K]> => { const m = (x as { module?: ModuleKey } | undefined)?.module; return !!x && (m === undefined || hasModule(m)); })
    .sort((a, b) => (a as { order: number }).order - (b as { order: number }).order);
}
