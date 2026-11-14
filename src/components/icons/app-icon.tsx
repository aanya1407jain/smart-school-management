/**
 * Atrium's live icons: drawn in code, two-tone (a soft fill plus a stroke in
 * the module's colour), and each one moves in its own way when its row or
 * card is hovered (`.group:hover`) or when it becomes active (`live`):
 * the bell rings, the clock hand turns, bars grow, the check draws itself.
 * All motion is transform/opacity/stroke-dashoffset and rests under
 * prefers-reduced-motion (see the `li-*` rules in globals.css).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { NavIcon } from "@/lib/permissions";

export type AppIconName = NavIcon | "spark" | "search" | "plus" | "key" | "certificate";

/** Module colours: `fg` for the glyph, `bg` for its tile. Content colour, never page background. */
export const ICON_TONE: Record<AppIconName, { fg: string; bg: string }> = {
  dashboard: { fg: "text-[#176D58]", bg: "bg-[#DEF0E9]" },
  students: { fg: "text-[#2563EB]", bg: "bg-[#E5EDFF]" },
  academics: { fg: "text-[#0E7C86]", bg: "bg-[#DDF3F4]" },
  teachers: { fg: "text-[#6D4AE0]", bg: "bg-[#EEE9FF]" },
  attendance: { fg: "text-[#15803D]", bg: "bg-[#E1F5E7]" },
  fees: { fg: "text-[#B26A00]", bg: "bg-[#FFF0D3]" },
  exams: { fg: "text-[#7C3AED]", bg: "bg-[#F1E9FF]" },
  timetable: { fg: "text-[#0369A1]", bg: "bg-[#DFF1FD]" },
  homework: { fg: "text-[#BE185D]", bg: "bg-[#FCE6F1]" },
  notices: { fg: "text-[#C2410C]", bg: "bg-[#FFEBD9]" },
  notifications: { fg: "text-[#A15C07]", bg: "bg-[#FEF3C7]" },
  reports: { fg: "text-[#4338CA]", bg: "bg-[#E7E8FF]" },
  settings: { fg: "text-[#475569]", bg: "bg-[#ECEFF3]" },
  classes: { fg: "text-[#0E7C86]", bg: "bg-[#DDF3F4]" },
  results: { fg: "text-[#9333EA]", bg: "bg-[#F4E8FF]" },
  profile: { fg: "text-[#475569]", bg: "bg-[#ECEFF3]" },
  accounts: { fg: "text-[#B26A00]", bg: "bg-[#FFF0D3]" },
  audit: { fg: "text-[#475569]", bg: "bg-[#ECEFF3]" },
  remarks: { fg: "text-[#DB2777]", bg: "bg-[#FDE7F1]" },
  spark: { fg: "text-[#F5A524]", bg: "bg-[#176D58]" },
  search: { fg: "text-[#475569]", bg: "bg-[#ECEFF3]" },
  plus: { fg: "text-[#176D58]", bg: "bg-[#DEF0E9]" },
  key: { fg: "text-[#B26A00]", bg: "bg-[#FFF0D3]" },
  certificate: { fg: "text-[#9333EA]", bg: "bg-[#F4E8FF]" },
};

/** Back-compat for callers that want one class string for a tile. */
export const ICON_TINT: Partial<Record<AppIconName, string>> = Object.fromEntries(
  Object.entries(ICON_TONE).map(([k, v]) => [k, `${v.bg} ${v.fg}`]),
) as Partial<Record<AppIconName, string>>;

const T = { fill: "currentColor", fillOpacity: 0.16, stroke: "none" } as const; // the soft tone layer

const GLYPHS: Record<AppIconName, ReactNode> = {
  dashboard: (<>
    <rect className="li-pop" x="3" y="3" width="8" height="8" rx="2.2" {...T} /><rect className="li-pop" x="3" y="3" width="8" height="8" rx="2.2" />
    <rect className="li-pop li-d1" x="13" y="3" width="8" height="5" rx="2" />
    <rect className="li-pop li-d2" x="13" y="10" width="8" height="11" rx="2.2" {...T} /><rect className="li-pop li-d2" x="13" y="10" width="8" height="11" rx="2.2" />
    <rect className="li-pop li-d3" x="3" y="13" width="8" height="8" rx="2.2" />
  </>),
  students: (<>
    <path d="M2.5 9 12 4.5 21.5 9 12 13.5z" {...T} /><path d="M2.5 9 12 4.5 21.5 9 12 13.5z" />
    <path d="M6.5 11v4.2c0 1.6 2.5 3.3 5.5 3.3s5.5-1.7 5.5-3.3V11" />
    <g className="li-swing"><path d="M21.5 9v5.2" /><circle cx="21.5" cy="15.6" r="1.2" fill="currentColor" stroke="none" /></g>
  </>),
  academics: (<>
    <path d="M4.5 10.5v9.5h15v-9.5" {...T} />
    <path d="M3 11 12 5l9 6" /><path d="M4.5 10.5v9.5h15v-9.5" /><path d="M10 20v-4.5h4V20" /><path d="M8 13.5h.01M16 13.5h.01" />
    <path d="M12 5V1.8" /><path className="li-wave" d="M12 2h3.6l-1 1.1 1 1.1H12" fill="currentColor" fillOpacity={0.5} />
  </>),
  teachers: (<>
    <circle cx="9" cy="8" r="3.2" {...T} /><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <g className="li-bob"><circle cx="17.2" cy="9.2" r="2.5" /><path d="M16 14.3c2.9.3 5 2.6 5 5.7" /></g>
  </>),
  attendance: (<>
    <rect x="3" y="5" width="18" height="16" rx="3" {...T} /><rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M8 3v4M16 3v4M3 10h18" />
    <path className="li-draw" pathLength={1} d="m8.5 15.3 2.4 2.4 4.6-4.9" strokeWidth={2.1} />
  </>),
  fees: (<>
    <circle className="li-drop" cx="12" cy="4.2" r="2.4" fill="currentColor" fillOpacity={0.35} />
    <path d="M3 9a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...T} />
    <path d="M3 9a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <rect x="14.5" y="11" width="6.5" height="4.5" rx="1.6" style={{ fill: "rgb(var(--surface))" }} /><circle cx="17.3" cy="13.25" r=".9" fill="currentColor" stroke="none" />
  </>),
  exams: (<>
    <path d="M6 3h8.5L19 7.5V21H6z" {...T} /><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14.5 3v4.5H19" />
    <path className="li-draw" pathLength={1} d="M9 11.5h6M9 15h3.5" />
    <g className="li-write"><path d="m13.6 20.6 5.6-5.6 1.7 1.7-5.6 5.6h-1.7z" style={{ fill: "rgb(var(--surface))" }} /></g>
  </>),
  timetable: (<>
    <circle cx="12" cy="12" r="9" {...T} /><circle cx="12" cy="12" r="9" />
    <path className="li-spin-slow" d="M12 12V6.8" strokeWidth={2} /><path className="li-spin" d="M12 12l3.4 2.1" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
  </>),
  homework: (<>
    <rect x="5" y="4" width="14" height="17" rx="2.4" {...T} /><rect x="5" y="4" width="14" height="17" rx="2.4" />
    <rect x="9" y="2.4" width="6" height="3.4" rx="1.2" style={{ fill: "rgb(var(--surface))" }} />
    <path className="li-draw" pathLength={1} d="M8.5 10.5h7" /><path className="li-draw li-d1" pathLength={1} d="M8.5 14h7" /><path className="li-draw li-d2" pathLength={1} d="M8.5 17.5h4" />
  </>),
  notices: (<>
    <path d="M3.5 10v4a1 1 0 0 0 1 1h2l7 4.2V4.8L6.5 9h-2a1 1 0 0 0-1 1z" {...T} /><path d="M3.5 10v4a1 1 0 0 0 1 1h2l7 4.2V4.8L6.5 9h-2a1 1 0 0 0-1 1z" />
    <path d="M7 15l1.2 4.2" />
    <path className="li-pulse" d="M17 9.6a3.4 3.4 0 0 1 0 4.8" /><path className="li-pulse li-d1" d="M19.4 7.2a6.8 6.8 0 0 1 0 9.6" />
  </>),
  notifications: (<>
    <g className="li-ring">
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.8h-15z" {...T} /><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.8h-15z" />
      <path d="M10 20.6a2 2 0 0 0 4 0" />
    </g>
  </>),
  reports: (<>
    <path d="M3 21h18" />
    <rect className="li-bar" x="4.5" y="12" width="3.6" height="9" rx="1.2" {...T} /><rect className="li-bar" x="4.5" y="12" width="3.6" height="9" rx="1.2" />
    <rect className="li-bar li-d1" x="10.2" y="6" width="3.6" height="15" rx="1.2" fill="currentColor" fillOpacity={0.45} />
    <rect className="li-bar li-d2" x="15.9" y="9.5" width="3.6" height="11.5" rx="1.2" {...T} /><rect className="li-bar li-d2" x="15.9" y="9.5" width="3.6" height="11.5" rx="1.2" />
  </>),
  settings: (<>
    <g className="li-gear">
      <circle cx="12" cy="12" r="7.2" fill="none" strokeWidth={3.4} strokeDasharray="2.6 2.05" />
      <circle cx="12" cy="12" r="5.4" {...T} /><circle cx="12" cy="12" r="5.4" />
    </g>
    <circle cx="12" cy="12" r="2" />
  </>),
  classes: (<>
    <rect x="3" y="4" width="18" height="12" rx="2.2" {...T} /><rect x="3" y="4" width="18" height="12" rx="2.2" />
    <path d="m8.5 20.5 1.8-4.5M15.5 20.5l-1.8-4.5" />
    <path className="li-draw" pathLength={1} d="M7 11c1.4-2.2 2.8-2.2 4 0s2.6 2.2 4.2-.2" />
  </>),
  results: (<>
    <path d="m8 2.5 2.6 6M16 2.5l-2.6 6" />
    <g className="li-swing">
      <circle cx="12" cy="14.5" r="5.8" {...T} /><circle cx="12" cy="14.5" r="5.8" />
      <path d="m12 11.6.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="currentColor" stroke="none" />
    </g>
  </>),
  profile: (<>
    <circle cx="12" cy="12" r="9" {...T} /><circle cx="12" cy="12" r="9" />
    <g className="li-bob"><circle cx="12" cy="10" r="3" /></g>
    <path d="M6.6 18.4c1.3-2.1 3.1-3.2 5.4-3.2s4.1 1.1 5.4 3.2" />
  </>),
  accounts: (<>
    <g className="li-turn">
      <circle cx="8" cy="15" r="4.2" {...T} /><circle cx="8" cy="15" r="4.2" />
      <path d="m11 12 9-9M16.2 6.8l2.2 2.2M18.6 4.4l2 2" />
    </g>
  </>),
  audit: (<>
    <rect x="4" y="3" width="16" height="18" rx="2.4" {...T} /><rect x="4" y="3" width="16" height="18" rx="2.4" />
    <circle cx="8" cy="8.5" r=".9" fill="currentColor" stroke="none" /><circle cx="8" cy="12.5" r=".9" fill="currentColor" stroke="none" /><circle cx="8" cy="16.5" r=".9" fill="currentColor" stroke="none" />
    <path className="li-slide" d="M10.5 8.5H16" /><path className="li-slide li-d1" d="M10.5 12.5H16" /><path className="li-slide li-d2" d="M10.5 16.5h3.5" />
  </>),
  remarks: (<>
    <path d="M4 4.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-8.5L6.5 21v-4H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" {...T} />
    <path d="M4 4.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-8.5L6.5 21v-4H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
    <circle className="li-hop" cx="8.4" cy="10.8" r="1.15" fill="currentColor" stroke="none" />
    <circle className="li-hop li-d1" cx="12" cy="10.8" r="1.15" fill="currentColor" stroke="none" />
    <circle className="li-hop li-d2" cx="15.6" cy="10.8" r="1.15" fill="currentColor" stroke="none" />
  </>),
  spark: (<>
    {/* Ask Atrium: a speech bubble with a spark inside. Ask, and the school answers. */}
    <path d="M5 3.8h14a2.6 2.6 0 0 1 2.6 2.6v8.5a2.6 2.6 0 0 1-2.6 2.6h-7.1L7.3 21v-3.5H5a2.6 2.6 0 0 1-2.6-2.6V6.4A2.6 2.6 0 0 1 5 3.8z" {...T} />
    <path className="li-bubble" d="M5 3.8h14a2.6 2.6 0 0 1 2.6 2.6v8.5a2.6 2.6 0 0 1-2.6 2.6h-7.1L7.3 21v-3.5H5a2.6 2.6 0 0 1-2.6-2.6V6.4A2.6 2.6 0 0 1 5 3.8z" strokeWidth={1.9} />
    <path className="li-star" d="M12 6.4c.45 2.6 1.65 3.8 4.25 4.25-2.6.45-3.8 1.65-4.25 4.25-.45-2.6-1.65-3.8-4.25-4.25 2.6-.45 3.8-1.65 4.25-4.25z" fill="currentColor" stroke="none" />
  </>),
  search: (<>
    <g className="li-wiggle"><circle cx="10.8" cy="10.8" r="6.6" {...T} /><circle cx="10.8" cy="10.8" r="6.6" /><path d="m15.8 15.8 4.7 4.7" strokeWidth={2.1} /></g>
  </>),
  plus: (<><path className="li-turn" d="M12 5v14M5 12h14" strokeWidth={2.2} /></>),
  key: (<>
    <g className="li-turn"><circle cx="8" cy="15" r="4.2" {...T} /><circle cx="8" cy="15" r="4.2" /><path d="m11 12 9-9M16.2 6.8l2.2 2.2M18.6 4.4l2 2" /></g>
  </>),
  certificate: (<>
    <rect x="3" y="4" width="18" height="13" rx="2" {...T} /><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 8.5h10M7 12h5" />
    <g className="li-swing"><circle cx="16.5" cy="15.5" r="2.8" style={{ fill: "rgb(var(--surface))" }} /><path d="m15.2 18 -.8 3.5 2.1-1.2 2.1 1.2-.8-3.5" /></g>
  </>),
};

/**
 * One live icon. `live` plays its motion once (e.g. on the active nav item);
 * hover on any ancestor with `.group` replays it. `weight` is accepted for
 * compatibility with older call sites and ignored.
 */
export function AppIcon({ name, className, live, size }: { name: AppIconName; className?: string; live?: boolean; size?: number; weight?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("li shrink-0 overflow-visible", live && "li-on", className)}
    >
      {GLYPHS[name] ?? GLYPHS.dashboard}
    </svg>
  );
}

/** An icon on its soft module-coloured tile. */
export function IconTile({ name, size = "md", live, className }: { name: AppIconName; size?: "xs" | "sm" | "md" | "lg"; live?: boolean; className?: string }) {
  const t = ICON_TONE[name] ?? ICON_TONE.dashboard;
  const box = { xs: "h-6 w-6 rounded-[7px]", sm: "h-7 w-7 rounded-lg", md: "h-9 w-9 rounded-[11px]", lg: "h-11 w-11 rounded-[13px]" }[size];
  const ico = { xs: "h-[15px] w-[15px]", sm: "h-4 w-4", md: "h-[19px] w-[19px]", lg: "h-[23px] w-[23px]" }[size];
  return (
    <span className={cn("grid shrink-0 place-items-center", box, t.bg, t.fg, className)}>
      <AppIcon name={name} live={live} className={ico} />
    </span>
  );
}
