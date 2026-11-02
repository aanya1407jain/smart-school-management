import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/format";

/**
 * Flat, softly tinted initials, picked deterministically from the name so a
 * person always gets the same avatar colour.
 */
const meshes = [
  "bg-teal-soft text-lagoon",
  "bg-blush/50 text-plum",
  "bg-sapphire/[0.07] text-sapphire",
  "bg-cyan/[0.12] text-lagoon",
  "bg-heather/30 text-sapphire",
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
        "inline-grid shrink-0 place-items-center rounded-full font-semibold",
        sz, meshes[hash(name) % meshes.length], className,
      )}
    >
      {initials(name)}
    </span>
  );
}
