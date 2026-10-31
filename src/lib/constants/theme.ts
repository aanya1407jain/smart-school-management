/**
 * Palette constants for places that cannot read CSS variables
 * (SVG chart attributes). Mirrors the tokens in globals.css — keep in sync.
 */
export const PALETTE = {
  teal: "#0D9488",
  cyan: "#06B6D4",
  aqua: "#14B8A6",
  lagoon: "#025F67",
  sapphire: "#063154",
  blush: "#F3CCDE",
  lavender: "#D6A8C4",
  mauve: "#BA88AE",
  purple: "#9E6899",
  plum: "#5B3765",
  alabaster: "#F7F6F2",
  heather: "#BCC5CC",
} as const;

/**
 * Chart colour roles. The brand palette is deliberately muted (low chroma), so
 * charts use at most TWO categorical series — Sapphire + Teal was validated as
 * the most separable pair (CVD ΔE 33.7, contrast ≥ 3:1). Never cycle further:
 * more categories → small multiples or a table.
 */
export const CHART = {
  primary: PALETTE.sapphire,
  secondary: PALETTE.teal,
  single: PALETTE.lagoon,
  highlight: PALETTE.plum,
  muted: PALETTE.heather,
} as const;

/**
 * Gradient fills for bars (defined once in <ChartGradients />, mounted by the
 * app shell). Each role pairs a gradient with the solid colour used for the
 * tooltip/legend swatch. Fees use emerald → teal for money in and amber → rose
 * for money still owed.
 */
export const CHART_FILL = {
  primary: { fill: "url(#chart-g-primary)", solid: PALETTE.sapphire, from: "#1E4E7A", to: PALETTE.sapphire },
  secondary: { fill: "url(#chart-g-secondary)", solid: PALETTE.teal, from: "#22C3B0", to: PALETTE.teal },
  single: { fill: "url(#chart-g-single)", solid: PALETTE.lagoon, from: PALETTE.cyan, to: PALETTE.lagoon },
  collected: { fill: "url(#chart-g-collected)", solid: "#10B981", from: "#34D399", to: PALETTE.teal },
  outstanding: { fill: "url(#chart-g-outstanding)", solid: "#F59E0B", from: "#FBBF24", to: "#F43F5E" },
} as const;

export const CHART_GRID = "rgba(188,197,204,0.55)";
/** Muted dashed grid lines shared by every chart. */
export const CHART_GRID_DASH = "3 3";
export const CHART_AXIS = "#627282";
