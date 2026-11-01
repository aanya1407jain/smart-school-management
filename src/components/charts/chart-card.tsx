"use client";
import type { ReactNode } from "react";
import { GlassCard, CardHeader } from "@/components/ui/card";
import { CHART_AXIS, CHART_FILL, CHART_GRID, CHART_GRID_DASH } from "@/lib/constants/theme";

export function ChartCard({ title, description, action, children, className, height = 260 }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; height?: number }) {
  return (
    <GlassCard className={className}>
      <CardHeader title={title} description={description} action={action} />
      <div className="px-3 pb-4 pt-3 sm:px-4" style={{ height }}>{children}</div>
    </GlassCard>
  );
}

export const axisProps = {
  tick: { fill: CHART_AXIS, fontSize: 12 },
  axisLine: false,
  tickLine: false,
} as const;

/** Muted dashed horizontal grid shared by every chart. */
export const gridProps = { vertical: false, stroke: CHART_GRID, strokeDasharray: CHART_GRID_DASH } as const;

/** Soft column highlight behind the hovered bar group. */
export const barCursor = { fill: "rgb(15 118 110 / 0.06)", radius: 6 } as const;

/** Flat, slightly rounded bars in the role's own colour (series stay distinguishable); a hovered bar dims a little. */
export function barProps(role: keyof typeof CHART_FILL, { horizontal = false, top = true }: { horizontal?: boolean; top?: boolean } = {}) {
  const r = 4;
  return {
    fill: CHART_FILL[role].solid,
    radius: (top ? (horizontal ? [0, r, r, 0] : [r, r, 0, 0]) : [0, 0, 0, 0]) as [number, number, number, number],
    activeBar: { fillOpacity: 0.85 },
    animationDuration: 600,
  };
}

/**
 * The SVG gradients behind CHART_FILL. Mounted once by the app shell; every
 * chart on the page references them with url(#chart-g-…).
 */
export function ChartGradients() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
      <defs>
        {Object.entries(CHART_FILL).map(([k, g]) => (
          <linearGradient key={k} id={`chart-g-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={g.from} />
            <stop offset="1" stopColor={g.to} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

/** Legend / tooltip swatch: a role's solid colour (also when a chart still passes the gradient url). */
function swatch(color: string) {
  const role = Object.values(CHART_FILL).find((g) => g.fill === color);
  return role ? role.solid : color;
}

/** Floating glass tooltip used by every chart. `extra` adds lines under the series (e.g. counts). */
export function ChartTooltip({ active, payload, label, format, extra }: { active?: boolean; payload?: { name: string; value: number; color: string; payload?: Record<string, unknown> }[]; label?: string; format?: (v: number, name: string) => string; extra?: (row: Record<string, unknown>) => ReactNode }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="glass-strong spatial animate-scale-in rounded-xl px-3 py-2 text-[12.5px]">
      {label && <p className="mb-1 font-semibold text-ink">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-ink-soft">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: swatch(p.color) }} aria-hidden />
          {p.name}: <span className="figures font-semibold text-ink">{format ? format(p.value, p.name) : p.value}</span>
        </p>
      ))}
      {extra && row && <div className="figures mt-1 border-t border-line/60 pt-1 text-[11.5px] text-ink-muted">{extra(row)}</div>}
    </div>
  );
}
