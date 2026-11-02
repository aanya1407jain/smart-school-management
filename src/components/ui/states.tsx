import { LinkButton } from "@/components/ui/button";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Lock, SearchX, Inbox, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-heather/20", className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

/** Generic page/section skeleton. */
export function LoadingState({ variant = "page", label = "Loading" }: { variant?: "page" | "table" | "cards" | "inline"; label?: string }) {
  if (variant === "inline") {
    return <div className="flex items-center gap-2 py-6 text-sm text-ink-muted" role="status"><RefreshCw className="h-4 w-4 animate-spin" /> {label}…</div>;
  }
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <span className="sr-only">{label}…</span>
      {variant === "page" && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><Skeleton className="h-72 rounded-2xl lg:col-span-2" /><Skeleton className="h-72 rounded-2xl" /></div>
        </>
      )}
      {variant === "cards" && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>}
      {variant === "table" && (
        <div className="solid-card space-y-3 p-5">
          <Skeleton className="h-9 w-1/3" />
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      )}
    </div>
  );
}

function StateShell({ icon, title, description, action, className, tone = "neutral" }: { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string; tone?: "neutral" | "warn" }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className={cn("mb-4 grid h-14 w-14 place-items-center rounded-2xl", tone === "warn" ? "bg-blush/60 text-plum" : "bg-teal-soft text-lagoon")}>{icon}</div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon, className }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return <StateShell icon={icon ?? <Inbox className="h-6 w-6" />} title={title} description={description} action={action} className={className} />;
}

export function ErrorState({ error, onRetry, className }: { error: Error | null | undefined; onRetry?: () => void; className?: string }) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "FORBIDDEN") return <UnauthorizedState message={error?.message} className={className} />;
  if (code === "NOT_FOUND") return <NotFoundState message={error?.message} className={className} />;
  return (
    <StateShell
      tone="warn"
      icon={<AlertTriangle className="h-6 w-6" />}
      title="Something went wrong"
      description={error?.message ?? "We couldn't load this information. Please try again."}
      action={onRetry && <Button variant="outline" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Try again</Button>}
      className={className}
    />
  );
}

export function UnauthorizedState({ message, homeHref, className }: { message?: string; homeHref?: string; className?: string }) {
  return (
    <StateShell
      tone="warn"
      icon={<Lock className="h-6 w-6" />}
      title="You don't have access to this"
      description={message ?? "Your account's role doesn't include this area. If you think this is a mistake, contact the school office."}
      action={homeHref && <LinkButton href={homeHref} variant="primary">Go to my dashboard</LinkButton>}
      className={className}
    />
  );
}

export function NotFoundState({ message, homeHref, className }: { message?: string; homeHref?: string; className?: string }) {
  return (
    <StateShell
      icon={<SearchX className="h-6 w-6" />}
      title="Not found"
      description={message ?? "The record you're looking for doesn't exist or may have been removed."}
      action={homeHref && <LinkButton href={homeHref} variant="outline">Back</LinkButton>}
      className={className}
    />
  );
}
