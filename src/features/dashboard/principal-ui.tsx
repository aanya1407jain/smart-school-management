/**
 * Building blocks of the Principal (admin) dashboard: flat white panels with a
 * hairline border, a compact metric card and a section link. Colours come only
 * from the scoped `pd-*` tokens, so nothing here restyles other pages. Module
 * parts of the dashboard (src/features/<module>/admin-dashboard-parts.tsx) use
 * these too, so every card looks the same.
 */
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** A text link in a panel header ("View all →"); 44px tall touch target without looking like a button. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-my-3 inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-1 text-[13px] font-semibold text-pd-accent hover:text-pd-accent-hover hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pd-accent">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/** A dashboard section: white surface, 12px radius, title row with an optional link. */
export function Panel({ title, description, action, children, className, as: Tag = "section", testId }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
  testId?: string;
}) {
  return (
    <Tag className={cn("flex min-w-0 flex-col rounded-xl border border-pd-line bg-white", className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-6 text-pd-ink">{title}</h2>
          {description && <p className="text-[13px] leading-5 text-pd-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1 px-4 pb-4 pt-3 sm:px-5">{children}</div>
    </Tag>
  );
}

/** One key figure: label, value, one supporting line and a link to the page that owns it. */
export function MetricCard({ label, value, support, icon: IconC, href, tone = "neutral", testId }: {
  label: string;
  value: ReactNode;
  support?: ReactNode;
  icon: Icon;
  href?: string;
  /** Colours the supporting line only, and only when it reports a problem. */
  tone?: "neutral" | "warning" | "danger";
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium leading-5 text-pd-muted">{label}</p>
        <IconC className="h-[18px] w-[18px] shrink-0 text-pd-muted" aria-hidden />
      </div>
      {/* Long figures (e.g. crores of rupees) step down a size rather than breaking mid-number. */}
      <p className={cn("mt-2 break-words font-semibold leading-7 tracking-tight text-pd-ink tabular-nums", typeof value === "string" && value.length > 10 ? "text-lg sm:text-xl" : "text-[22px] sm:text-2xl")} data-testid={testId}>{value}</p>
      {support && (
        <p className={cn("mt-1 text-[12.5px] leading-[18px]", tone === "danger" ? "text-pd-danger" : tone === "warning" ? "text-pd-warning" : "text-pd-muted")}>{support}</p>
      )}
    </>
  );
  const cls = "block h-full min-w-0 rounded-xl border border-pd-line bg-white p-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-pd-accent/40 hover:bg-pd-accent-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pd-accent")}>{body}</Link>
  ) : <div className={cls}>{body}</div>;
}

/** A small status label with text (never colour alone). */
export function StatusTag({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warning" | "danger" | "ok"; children: ReactNode }) {
  const t = {
    neutral: "bg-pd-bg text-pd-muted",
    accent: "bg-pd-accent-soft text-pd-accent",
    warning: "bg-pd-warning-soft text-pd-warning",
    danger: "bg-pd-danger-soft text-pd-danger",
    ok: "bg-pd-ok-soft text-pd-ok",
  }[tone];
  return <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold leading-4", t)}>{children}</span>;
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
