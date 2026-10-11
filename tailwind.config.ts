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
        lagoon: channel("c-lagoon"),
        sapphire: channel("c-sapphire"),
        blush: channel("c-blush"),
        lavender: channel("c-lavender"),
        mauve: channel("c-mauve"),
        purple: channel("c-purple"),
        plum: channel("c-plum"),
        alabaster: channel("c-alabaster"),
        heather: channel("c-heather"),

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
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem", "3xl": "1.5rem" },
      boxShadow: {
        glass: "0 1px 0 0 rgb(255 255 255 / 0.6) inset, 0 8px 32px -12px rgb(var(--c-sapphire) / 0.18)",
        soft: "0 2px 12px -4px rgb(var(--c-sapphire) / 0.12)",
        lift: "0 14px 40px -16px rgb(var(--c-sapphire) / 0.28)",
        focus: "0 0 0 3px rgb(var(--c-teal) / 0.35)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-up": "fade-up .35s cubic-bezier(.2,.7,.2,1) both",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};
export default config;
