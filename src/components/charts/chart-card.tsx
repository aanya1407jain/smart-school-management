"use client";
import type { ReactNode } from "react";
import { GlassCard, CardHeader } from "@/components/ui/card";
import { CHART_AXIS } from "@/lib/constants/theme";

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

/** Glass tooltip used by every chart. */
export function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format?: (v: number, name: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-[12.5px]">
      {label && <p className="mb-1 font-semibold text-ink">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-ink-soft">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-semibold text-ink">{format ? format(p.value, p.name) : p.value}</span>
        </p>
      ))}
    </div>
  );
}
