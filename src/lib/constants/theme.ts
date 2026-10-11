/**
 * Palette constants for places that cannot read CSS variables
 * (SVG chart attributes). Mirrors the tokens in globals.css — keep in sync.
 */
export const PALETTE = {
  teal: "#2F9D94",
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

export const CHART_GRID = "rgba(188,197,204,0.45)";
export const CHART_AXIS = "#627282";
