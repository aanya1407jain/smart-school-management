import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import { PALETTE } from "@/lib/constants/theme";
import { PRODUCT } from "@/lib/constants/product";

/**
 * Default school crest — an original mark: shield + eight-petal flower.
 * Used for any school that has not uploaded its own logo (Stage 1 stores logo
 * file names only); the seeded demo school, Aster Academy, uses it as its crest.
 */
export function LogoMark({ className, size = 40, label = "School crest" }: { className?: string; size?: number; label?: string }) {
  const id = useId().replace(/:/g, "");
  const petals = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} role="img" aria-label={label}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={PALETTE.lagoon} />
          <stop offset="1" stopColor={PALETTE.sapphire} />
        </linearGradient>
        <radialGradient id={`c-${id}`}>
          <stop offset="0" stopColor={PALETTE.blush} />
          <stop offset="1" stopColor={PALETTE.mauve} />
        </radialGradient>
      </defs>
      <path d="M24 2.5 41.5 8v15.2c0 10.6-7.3 18.6-17.5 22.3C13.8 41.8 6.5 33.8 6.5 23.2V8L24 2.5Z" fill={`url(#g-${id})`} />
      <path d="M24 5.6 38.7 10.2v13c0 9-6 15.9-14.7 19.3C15.3 39.1 9.3 32.2 9.3 23.2v-13L24 5.6Z" fill="none" stroke="white" strokeOpacity={0.22} strokeWidth="0.8" />
      <g transform="translate(24 22.5)">
        {petals.map((deg) => (
          <ellipse key={deg} rx="2.6" ry="7.4" cy="-6.6" fill="white" fillOpacity={deg % 90 === 0 ? 0.95 : 0.72} transform={`rotate(${deg})`} />
        ))}
        <circle r="3.4" fill={`url(#c-${id})`} stroke="white" strokeWidth="1" />
      </g>
    </svg>
  );
}

/** Crest + name lockup. Pass the school name for tenant branding; defaults to the product name. */
export function Logo({ className, compact, light, name = PRODUCT.shortName }: { className?: string; compact?: boolean; light?: boolean; name?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LogoMark size={compact ? 34 : 40} />
      <div className="leading-tight">
        <p className={cn("font-display text-[17px] font-semibold tracking-wide", light ? "text-white" : "text-sapphire")}>{name}</p>
        {!compact && <p className={cn("text-[11px] font-medium uppercase tracking-[0.16em]", light ? "text-white/60" : "text-ink-muted")}>School Management</p>}
      </div>
    </div>
  );
}
