import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { IconTile } from "@/components/icons/app-icon";
import { liveIconFor } from "@/components/icons/from-lucide";

/** Glass surface — use for dashboard widgets, floating panels and key cards. */
export function GlassCard({ className, hover, ...props }: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn("glass rounded-[18px]", hover && "transition-shadow duration-150 hover:shadow-lift", className)}
      {...props}
    />
  );
}

/** Opaque surface — use where readability matters most (tables, forms). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("solid-card", className)} {...props} />;
}

export function CardHeader({
  title, description, action, className, icon,
}: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("group flex items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (liveIconFor(icon)
          ? <IconTile name={liveIconFor(icon)!} size="md" className="mt-0.5" />
          : <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-bg text-ink-soft ring-1 ring-inset ring-line">{icon}</div>)}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
