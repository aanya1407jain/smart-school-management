"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { IconTile, type AppIconName } from "@/components/icons/app-icon";

/** The module icon for a page, from its route ("/admin/fees/123" → fees). */
const ROUTE_ICON: Record<string, AppIconName> = {
  dashboard: "dashboard", students: "students", teachers: "teachers", academics: "academics", attendance: "attendance",
  fees: "fees", examinations: "exams", timetable: "timetable", homework: "homework", notices: "notices",
  notifications: "notifications", reports: "reports", settings: "settings", classes: "classes", results: "results",
  profile: "profile", accounts: "accounts", permissions: "settings", credentials: "key", audit: "audit", remarks: "remarks",
  promotions: "results", certificates: "certificate",
};

export function PageHeader({ title, description, actions, eyebrow, className, icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string; icon?: AppIconName | null }) {
  const pathname = usePathname() ?? "";
  const seg = pathname.split("/").filter(Boolean)[1] ?? "";
  const name = icon === null ? null : icon ?? ROUTE_ICON[seg] ?? null;
  return (
    <div className={cn("mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="group flex min-w-0 items-center gap-3.5">
        {name && <IconTile name={name} size="lg" live className="shadow-[0_6px_16px_-8px_rgb(20_33_29/0.35)] transition-transform duration-200 group-hover:-rotate-6" />}
        <div className="min-w-0">
          {eyebrow && <p className="mb-0.5 text-[12.5px] font-medium text-ink-muted">{eyebrow}</p>}
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[28px]">{title}</h1>
          {description && <p className="mt-1 line-clamp-2 max-w-2xl text-[14px] leading-snug text-ink-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
