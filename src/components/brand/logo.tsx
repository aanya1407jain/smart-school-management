import { cn } from "@/lib/utils/cn";
import { PALETTE } from "@/lib/constants/theme";
import { PRODUCT } from "@/lib/constants/product";

/**
 * The Atrium mark: an arch (the doorway into the school's central hall) under
 * a marigold skylight. Also stands in as the crest for schools that have not
 * uploaded their own logo.
 */
export function LogoMark({ className, size = 40, label = PRODUCT.name, tone = "ink" }: { className?: string; size?: number; label?: string; tone?: "ink" | "light" }) {
  const tile = tone === "ink" ? "#115948" : "#FFFFFF";
  const arch = tone === "ink" ? "#FFFFFF" : "#115948";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={cn("shrink-0", className)} role="img" aria-label={label}>
      <rect width="48" height="48" rx="13" fill={tile} />
      <path d="M13 37V25.5a11 11 0 0 1 22 0V37h-6.2V25.8a4.8 4.8 0 0 0-9.6 0V37Z" fill={arch} />
      <circle cx="24" cy="10.6" r="3.4" fill={PALETTE.marigold} />
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
