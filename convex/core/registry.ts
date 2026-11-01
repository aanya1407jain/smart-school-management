/**
 * Core access to the modules shipped in this build (convex/registry.generated.ts).
 *
 * `provider(id)` returns `{ installed: false }` when the owning module is not
 * in the build — callers must handle it explicitly (never as zero/empty
 * data). `moduleShipped(id)` answers "is this module's code here at all"; it
 * is NOT entitlement: a shipped module can still be disabled for a school
 * (model/modules.ts), and both checks apply.
 */
import type { ModuleId } from "../contracts/manifest";
import { lookup, type ProviderContracts, type ProviderId, type Provided } from "../contracts/providers";
import { SELECTED_MODULES, providers } from "../registry.generated";

export function provider<K extends ProviderId>(id: K): Provided<ProviderContracts[K]> {
  return lookup(providers(), id);
}

/** The provider, or null when its module is not shipped. */
export function maybeProvider<K extends ProviderId>(id: K): ProviderContracts[K] | null {
  const p = provider(id);
  return p.installed ? p.provider : null;
}

export function moduleShipped(id: ModuleId): boolean {
  return SELECTED_MODULES.includes(id);
}
