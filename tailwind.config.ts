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

        // Semantic tokens
        bg: channel("bg"),
        surface: channel("surface"),
        ink: { DEFAULT: channel("ink"), soft: channel("ink-soft"), muted: channel("ink-muted") },
        line: channel("line"),
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
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      // Moderate, consistent corners: 12px controls, 16px cards, 20px large overlays.
      borderRadius: { xl: "0.75rem", "2xl": "1rem", "3xl": "1.25rem" },
      // Restrained elevation: hairline shadows for surfaces, one soft shadow for overlays, no glows.
      boxShadow: {
        glass: "0 1px 2px rgb(16 24 40 / 0.04)",
        soft: "0 1px 3px rgb(16 24 40 / 0.08)",
        lift: "0 12px 32px -12px rgb(16 24 40 / 0.18)",
        // Focus ring for inputs, selects and search.
        focus: "0 0 0 3px rgb(var(--primary) / 0.18)",
        ambient: "0 1px 2px rgb(16 24 40 / 0.04)",
        "ambient-lg": "0 2px 8px -2px rgb(16 24 40 / 0.08)",
        glow: "0 0 0 3px rgb(var(--primary) / 0.1)",
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
