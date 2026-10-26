import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/format";

/**
 * Soft multi-tone mesh gradients (two radial blooms over a linear base), picked
 * deterministically from the name so a person always gets the same avatar.
 */
const meshes = [
  "bg-[radial-gradient(circle_at_25%_20%,rgb(var(--c-cyan)/0.35),transparent_55%),radial-gradient(circle_at_80%_85%,rgb(var(--c-teal)/0.35),transparent_60%),linear-gradient(135deg,rgb(var(--c-teal-soft)),rgb(255_255_255))] text-lagoon",
  "bg-[radial-gradient(circle_at_20%_25%,rgb(var(--c-lavender)/0.55),transparent_55%),radial-gradient(circle_at_85%_80%,rgb(var(--c-blush)),transparent_60%),linear-gradient(135deg,rgb(var(--c-blush)/0.6),rgb(255_255_255))] text-plum",
  "bg-[radial-gradient(circle_at_30%_20%,rgb(var(--c-cyan)/0.28),transparent_55%),radial-gradient(circle_at_80%_80%,rgb(var(--c-sapphire)/0.18),transparent_60%),linear-gradient(135deg,rgb(var(--c-sapphire)/0.06),rgb(255_255_255))] text-sapphire",
  "bg-[radial-gradient(circle_at_25%_25%,rgb(var(--c-aqua)/0.35),transparent_55%),radial-gradient(circle_at_80%_85%,rgb(var(--c-lavender)/0.35),transparent_60%),linear-gradient(135deg,rgb(var(--c-alabaster)),rgb(255_255_255))] text-lagoon",
  "bg-[radial-gradient(circle_at_20%_20%,rgb(var(--c-heather)/0.55),transparent_55%),radial-gradient(circle_at_85%_85%,rgb(var(--c-cyan)/0.22),transparent_60%),linear-gradient(135deg,rgb(var(--c-heather)/0.25),rgb(255_255_255))] text-sapphire",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = "md", className }: { name: string; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sz = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-[11px]", md: "h-10 w-10 text-[13px]", lg: "h-14 w-14 text-base", xl: "h-20 w-20 text-xl" }[size];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold ring-1 ring-white/90 shadow-[0_0_0_1px_rgb(var(--c-heather)/0.35),0_4px_10px_-4px_rgb(var(--c-sapphire)/0.25)]",
        sz, meshes[hash(name) % meshes.length], className,
      )}
    >
      {initials(name)}
    </span>
  );
}
