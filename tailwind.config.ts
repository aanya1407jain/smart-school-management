import type { Config } from "tailwindcss";

/**
 * All colours resolve to CSS variables defined in src/app/globals.css.
 * Never hard-code hex values in components — use these token names.
 */
const channel = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        // Raw palette
        teal: { DEFAULT: channel("c-teal"), soft: channel("c-teal-soft") },
        // Brand accents for gradients, glows and focus rings (#06B6D4, #14B8A6).
        cyan: channel("c-cyan"),
        aqua: channel("c-aqua"),
        lagoon: channel("c-lagoon"),
        sapphire: channel("c-sapphire"),
        blush: channel("c-blush"),
        lavender: channel("c-lavender"),
        mauve: channel("c-mauve"),
        purple: channel("c-purple"),
        plum: channel("c-plum"),
        alabaster: channel("c-alabaster"),
        heather: channel("c-heather"),
        // Deep forest green for the navigation sidebar (#0A382C).
        forest: channel("c-forest"),

        // Atrium brand (Evergreen)
        brand: {
          50: channel("c-brand-50"), 100: channel("c-brand-100"), 200: channel("c-brand-200"), 400: channel("c-brand-400"),
          500: channel("c-brand-500"), 600: channel("c-brand-600"), DEFAULT: channel("c-brand-600"), 700: channel("c-brand-700"),
          800: channel("c-brand-800"), 900: channel("c-brand-900"),
        },
        cobalt: { DEFAULT: channel("c-cobalt"), deep: channel("c-cobalt-deep"), soft: channel("c-cobalt-soft") },
        marigold: { DEFAULT: channel("c-marigold"), soft: channel("c-marigold-soft") },
        mint: channel("c-mint"),
        coral: channel("c-coral"),

        // Semantic tokens
        ground: channel("ground"),
        bg: channel("bg"),
        surface: { DEFAULT: channel("surface"), 2: channel("surface-2") },
        ink: { DEFAULT: channel("ink"), soft: channel("ink-soft"), muted: channel("ink-muted"), faint: channel("ink-faint") },
        line: { DEFAULT: channel("line"), strong: channel("line-strong") },
        primary: { DEFAULT: channel("primary"), hover: channel("primary-hover"), fg: channel("primary-fg") },
        accent: channel("accent"),
        success: channel("success"),
        warning: channel("warning"),
        danger: channel("danger"),

        // Principal dashboard (scoped tokens; see --pd-* in globals.css).
        pd: {
          bg: channel("pd-bg"), ink: channel("pd-ink"), muted: channel("pd-muted"), line: channel("pd-line"),
          accent: channel("pd-accent"), "accent-hover": channel("pd-accent-hover"), "accent-soft": channel("pd-accent-soft"),
          danger: channel("pd-danger"), "danger-soft": channel("pd-danger-soft"),
          warning: channel("pd-warning"), "warning-soft": channel("pd-warning-soft"),
          ok: channel("pd-ok"), "ok-soft": channel("pd-ok-soft"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      // Corners: 10px controls, 14px small cards, 18px panels, 24px overlays.
      borderRadius: { lg: "0.5rem", xl: "0.625rem", "2xl": "0.875rem", "3xl": "1.125rem", "4xl": "1.5rem" },
      boxShadow: {
        glass: "0 1px 2px rgb(17 19 24 / 0.04), 0 0 0 1px rgb(17 19 24 / 0.06)",
        soft: "0 1px 3px rgb(17 19 24 / 0.08)",
        lift: "0 18px 40px -16px rgb(17 19 24 / 0.22), 0 0 0 1px rgb(17 19 24 / 0.06)",
        // Focus ring for inputs, selects and search (cobalt).
        focus: "0 0 0 3px rgb(var(--c-brand-500) / 0.22)",
        ambient: "0 1px 2px rgb(17 19 24 / 0.04)",
        "ambient-lg": "0 2px 8px -2px rgb(17 19 24 / 0.08)",
        glow: "0 0 0 3px rgb(var(--c-brand-500) / 0.14)",
        card: "var(--shadow-card)",
        button: "inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(11 52 44 / 0.25), 0 0 0 1px rgb(var(--c-brand-700))",
        canvas: "0 0 0 1px rgb(17 19 24 / 0.06), 0 1px 3px rgb(17 19 24 / 0.04)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        // Staggered list entrance (items set --stagger-i).
        "rise-in": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        // Floating menus: soft scale-in from just below the trigger.
        "scale-in": { from: { opacity: "0", transform: "scale(.96) translateY(-4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-up": "fade-up .35s cubic-bezier(.2,.7,.2,1) both",
        // 40 ms stagger per item (the `.stagger` utility sets the delay from --stagger-i).
        "rise-in": "rise-in .38s cubic-bezier(.2,.8,.2,1) both",
        shimmer: "shimmer 1.4s infinite",
        "scale-in": "scale-in .16s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
