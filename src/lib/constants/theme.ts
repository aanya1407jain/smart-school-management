/**
 * Palette constants for places that cannot read CSS variables
 * (SVG chart attributes). Mirrors the tokens in globals.css — keep in sync.
 * The old palette keys stay as aliases (see the globals.css header).
 */
export const PALETTE = {
  brand: "#176D58",
  brandSoft: "#BEE0D3",
  brandBright: "#24846A",
  cobalt: "#3B5BFD",
  cobaltDeep: "#2440D8",
  cobaltSoft: "#C9D3FF",
  marigold: "#F5A524",
  mint: "#16A34A",
  coral: "#F2555A",
  ink: "#14211D",
  // aliases
  teal: "#176D58",
  cyan: "#4AA084",
  aqua: "#24846A",
  lagoon: "#115948",
  sapphire: "#14211D",
  blush: "#FDECEA",
  lavender: "#FBE2B8",
  mauve: "#E8A33A",
  purple: "#B45309",
  plum: "#C4291C",
  alabaster: "#F6F8F6",
  heather: "#D3D9D5",
} as const;

/** Chart colour roles: evergreen is the primary series, marigold the comparison and highlight. */
export const CHART = {
  primary: PALETTE.brand,
  secondary: PALETTE.marigold,
  single: PALETTE.brand,
  highlight: PALETTE.marigold,
  muted: PALETTE.heather,
} as const;

/** Bars use flat `solid` fills; gradients remain for <ChartGradients /> only. Money in = mint, still owed = marigold. */
export const CHART_FILL = {
  primary: { fill: "url(#chart-g-primary)", solid: PALETTE.brand, from: "#4AA084", to: PALETTE.brand },
  secondary: { fill: "url(#chart-g-secondary)", solid: PALETTE.marigold, from: "#FCD34D", to: PALETTE.marigold },
  single: { fill: "url(#chart-g-single)", solid: PALETTE.brand, from: "#4AA084", to: PALETTE.brand },
  collected: { fill: "url(#chart-g-collected)", solid: PALETTE.mint, from: "#4ADE80", to: PALETTE.mint },
  outstanding: { fill: "url(#chart-g-outstanding)", solid: PALETTE.marigold, from: "#FCD34D", to: PALETTE.marigold },
} as const;

export const CHART_GRID = "rgba(20,33,29,0.07)";
/** Muted dashed grid lines shared by every chart. */
export const CHART_GRID_DASH = "3 3";
export const CHART_AXIS = "#5D6C66";

/** Principal dashboard charts. */
export const PD_CHART = {
  accent: PALETTE.brand,
  accentSoft: PALETTE.brandSoft,
  grid: "#E6ECE8",
  axis: "#5D6C66",
} as const;
