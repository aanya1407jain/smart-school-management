/**
 * Building blocks of the Principal (admin) dashboard: flat white panels with a
 * hairline border, a compact metric card and a section link. Colours come only
 * from the scoped `pd-*` tokens, so nothing here restyles other pages. Module
 * parts of the dashboard (src/features/<module>/admin-dashboard-parts.tsx) use
 * these too, so every card looks the same.
 */
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { IconTile, type AppIconName } from "@/components/icons/app-icon";
import { cn } from "@/lib/utils/cn";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** A text link in a panel header ("View all →"); 44px tall touch target without looking like a button. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-my-3 inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-1 text-[13px] font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pd-accent">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** A dashboard section: white surface, 12px radius, title row with an optional link. */
export function Panel({ title, description, action, children, className, as: Tag = "section", testId, icon }: {
  title: ReactNode;
  /** Module icon shown before the title. */
  icon?: AppIconName;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
  testId?: string;
}) {
  return (
    <Tag className={cn("group/panel flex min-w-0 flex-col rounded-[22px] bg-surface shadow-card", className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="group"><IconTile name={icon} size="sm" /></span>}
          <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-6 tracking-[-0.015em] text-pd-ink">{title}</h2>
          {description && <p className="text-[13px] leading-5 text-pd-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="flex-1 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">{children}</div>
    </Tag>
  );
}

/** One key figure: module icon, label, value, one supporting line, an optional mini chart, and a link to the page that owns it. */
export function MetricCard({ label, value, support, icon: IconC, accent, viz, href, tone = "neutral", testId }: {
  label: string;
  value: ReactNode;
  support?: ReactNode;
  icon: Icon;
  /** The module this figure belongs to: picks the coloured live icon. */
  accent?: AppIconName;
  /** A small picture of the figure (sparkline, progress, dots). */
  viz?: ReactNode;
  href?: string;
  /** Colours the supporting line only, and only when it reports a problem. */
  tone?: "neutral" | "warning" | "danger";
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {accent ? <IconTile name={accent} size="md" /> : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-bg text-ink-soft ring-1 ring-inset ring-line"><IconC className="h-4 w-4" aria-hidden /></span>
        )}
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-[17px] text-pd-muted">{label}</p>
        {href && <ArrowUpRight className="hidden h-4 w-4 shrink-0 sm:block text-ink-faint transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />}
      </div>
      {/* Long figures (e.g. crores of rupees) step down a size rather than breaking mid-number. */}
      <p className={cn("mt-4 whitespace-nowrap font-semibold leading-none tracking-[-0.045em] text-pd-ink tabular-nums", typeof value === "string" && value.length > 7 ? "text-[21px] min-[420px]:text-[24px] sm:text-[28px]" : "text-[30px] sm:text-[34px]")} data-testid={testId}>{value}</p>
      {support && (
        <p className={cn("mt-2 text-[12.5px] leading-[18px]", tone === "danger" ? "text-pd-danger" : tone === "warning" ? "text-pd-warning" : "text-pd-muted")}>{support}</p>
      )}
      {viz && <div className="mt-auto pt-4">{viz}</div>}
    </>
  );
  const cls = "group flex h-full min-w-0 flex-col rounded-[22px] bg-surface p-4 shadow-card sm:p-5";
  return href ? (
    <Link href={href} className={cn(cls, "lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pd-accent")}>{body}</Link>
  ) : <div className={cls}>{body}</div>;
}

/** A tiny line of the recent trend, with the last point marked. Values are drawn to their own min–max. */
export function Sparkline({ values, className, color = "rgb(var(--c-brand-500))" }: { values: number[]; className?: string; color?: string }) {
  if (values.length < 2) return null;
  const w = 120, h = 32, pad = 3;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-full overflow-visible", className)} preserveAspectRatio="none" aria-hidden>
      <path d={`${d} L${lx} ${h} L${pad} ${h} Z`} style={{ fill: color, fillOpacity: 0.1 }} />
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3.2" style={{ fill: color }} stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Big, colourful one-tap shortcuts (each tile's icon plays on hover). */
export function QuickActions({ items }: { items: { label: string; href: string; icon: AppIconName }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((a) => (
        <Link key={a.href} href={a.href} className="group lift flex flex-col items-start gap-3 rounded-2xl bg-bg/70 p-3 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-pd-accent">
          <IconTile name={a.icon} size="md" />
          <span className="text-[13px] font-medium leading-tight text-pd-ink">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

/** A split progress bar with a legend (e.g. collected vs pending). */
export function SplitBar({ parts }: { parts: { value: number; className: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-bg">
        {parts.map((p) => <span key={p.label} className={cn("grow-x h-full rounded-full", p.className)} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-pd-muted">
        {parts.map((p) => <span key={p.label} className="flex items-center gap-1.5"><span className={cn("h-1.5 w-1.5 rounded-full", p.className)} />{p.label}</span>)}
      </div>
    </div>
  );
}

/** Small columns with a caption (e.g. latest exam average by class). */
export function MiniBars({ rows, caption, className = "bg-[#2563EB]" }: { rows: { name: string; value: number }[]; caption?: string; className?: string }) {
  if (rows.length === 0) return null;
  // Drawn to the rows' own range so small differences between classes stay visible.
  const vals = rows.map((r) => r.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  return (
    <div>
      <div className="flex h-8 items-end gap-1" aria-hidden>
        {rows.map((r, i) => (
          <span key={r.name} title={`${r.name}: ${Math.round(r.value)}%`} className={cn("flex-1 origin-bottom rounded-[3px] opacity-80 animate-[grow-y_.7s_cubic-bezier(.2,.8,.2,1)_both]", className)} style={{ height: `${30 + ((r.value - lo) / span) * 70}%`, animationDelay: `${i * 40}ms` }} />
        ))}
      </div>
      {caption && <p className="mt-1.5 truncate text-[11.5px] text-pd-muted">{caption}</p>}
    </div>
  );
}

/** One dot per person: filled = on duty, amber = away. */
export function DotRow({ total, away, max = 24 }: { total: number; away: number; max?: number }) {
  const n = Math.min(total, max);
  const a = Math.min(away, n);
  return (
    <div className="flex flex-wrap gap-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cn("h-2.5 w-2.5 rounded-full animate-[li-pop_.4s_ease-out_both]", i >= n - a ? "bg-marigold" : "bg-[#6D4AE0]/80")} style={{ animationDelay: `${i * 18}ms` }} />
      ))}
      {total > max && <span className="ml-1 text-[11px] text-pd-muted">+{total - max}</span>}
    </div>
  );
}

/** A small status label with text (never colour alone). */
export function StatusTag({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warning" | "danger" | "ok"; children: ReactNode }) {
  const t = {
    neutral: "bg-bg text-pd-muted ring-1 ring-inset ring-line",
    accent: "bg-pd-accent-soft text-pd-accent",
    warning: "bg-pd-warning-soft text-pd-warning",
    danger: "bg-pd-danger-soft text-pd-danger",
    ok: "bg-pd-ok-soft text-pd-ok",
  }[tone];
  return <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4", t)}>{children}</span>;
}

/** Lower-priority content, closed by default (native <details>: keyboard and screen-reader friendly). */
export function Collapsible({ summary, hint, children }: { summary: string; hint?: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 py-2 text-[14px] font-medium text-pd-ink hover:text-pd-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-pd-accent [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          {summary}
          {hint && <span className="block text-[12.5px] font-normal text-pd-muted">{hint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-pd-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-2 pt-1">{children}</div>
    </details>
  );
}

/** Empty / quiet state inside a panel. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-[13px] text-pd-muted">{children}</p>;
}
