import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/format";

const palettes = [
  "bg-teal-soft text-lagoon",
  "bg-lavender/35 text-plum",
  "bg-sapphire/10 text-sapphire",
  "bg-blush/70 text-plum",
  "bg-heather/40 text-sapphire",
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
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold ring-2 ring-white/80", sz, palettes[hash(name) % palettes.length], className)}
    >
      {initials(name)}
    </span>
  );
}
