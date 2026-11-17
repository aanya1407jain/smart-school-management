import { cn } from "@/lib/utils/cn";
import { PALETTE } from "@/lib/constants/theme";
import { PRODUCT } from "@/lib/constants/product";

/**
 * The Atrium mark: a courtyard seen from above. Four rooms (every part of the
 * school) gather around one open centre, lit by a marigold sun. Also stands in
 * as the crest for schools that have not uploaded their own logo.
 */
export function LogoMark({ className, size = 40, label = PRODUCT.name, tone = "ink" }: { className?: string; size?: number; label?: string; tone?: "ink" | "light" }) {
  const tile = tone === "ink" ? "#115948" : "#FFFFFF";
  const room = tone === "ink" ? "#FFFFFF" : "#115948";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={cn("shrink-0", className)} role="img" aria-label={label}>
      <rect width="48" height="48" rx="13" fill={tile} />
      <rect x="10" y="10" width="13" height="13" rx="3.6" fill={room} />
      <rect x="25" y="10" width="13" height="13" rx="3.6" fill={room} />
      <rect x="10" y="25" width="13" height="13" rx="3.6" fill={room} />
      <rect x="25" y="25" width="13" height="13" rx="3.6" fill={room} />
      <circle cx="24" cy="24" r="7.6" fill={tile} />
      <circle cx="24" cy="24" r="4.4" fill={PALETTE.marigold} />
    </svg>
  );
}

/** Mark + wordmark lockup. Pass the school name for tenant branding; defaults to the product name. */
export function Logo({ className, compact, light, name = PRODUCT.shortName }: { className?: string; compact?: boolean; light?: boolean; name?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={compact ? 28 : 32} tone={light ? "light" : "ink"} />
      <span className={cn("text-[17px] font-semibold tracking-[-0.03em]", light ? "text-white" : "text-ink")}>{name}</span>
    </div>
  );
}
