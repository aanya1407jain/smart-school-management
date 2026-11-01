"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSession } from "@/features/auth/session-provider";
import { getNavigationForUser, ROLE_LABELS } from "@/lib/permissions";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import { NAV_ICONS } from "./nav-icons";
import { useUnreadCount } from "@/features/notifications/use-unread-count";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";

const WORKSPACE: Record<string, string> = { admin: "Administration", teacher: "Teacher workspace", student: "Student portal" };

/**
 * The sidebar: a deep forest-green panel (#0A382C) with white brand text, soft
 * mint group headings, an emerald pill for the active item and a tonal
 * "Signed in as" card at the foot. Contrast on the panel: white 13.0, links
 * (emerald-100/80) 7.9, headings (emerald-200/70) 5.8 — all WCAG AA. Items
 * come only from the user's permissions — unauthorized items are never rendered.
 */
export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { user, viewer, dataSource } = useSession();
  const pathname = usePathname();
  const live = dataSource === "live";
  const groups = getNavigationForUser(user, { liveOnly: live });
  const unread = useUnreadCount();
  const demoSchool = useSchoolProfile();
  // Live accounts show THEIR school (server-derived), never the demo tenant.
  const school = live ? viewer?.school : demoSchool;
  if (!user) return null;
  const roleLabel = user.title ?? ROLE_LABELS[user.role];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-forest text-white">
      {/* In the phone drawer (onNavigate set) leave room for its close button. */}
      <div className={cn("flex items-center gap-3 border-b border-white/10 px-5 py-4", collapsed && "justify-center px-0", onNavigate && "pr-14")}>
        <LogoMark size={collapsed ? 34 : 36} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-[16px] font-semibold tracking-wide text-white">{school?.name ?? " "}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-200/70">{WORKSPACE[user.role]}</p>
          </div>
        )}
      </div>

      <nav aria-label="Main navigation" className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => (
          <div key={g.label} className={cn(gi > 0 && "mt-5")}>
            {!collapsed && <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-200/70">{g.label}</p>}
            {collapsed && gi > 0 && <div aria-hidden className="mx-3 mb-3 border-t border-white/10" />}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge = item.icon === "notifications" && unread > 0 ? unread : null;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-emerald-800 font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
                          : "font-medium text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white",
                      )}
                    >
                      {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-emerald-300" />}
                      <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors duration-150", active ? "text-white" : "text-emerald-300/80 group-hover:text-white")} aria-hidden />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {badge !== null && (
                        <span className={cn("grid min-w-5 place-items-center rounded-full bg-emerald-400 px-1.5 text-[11px] font-bold leading-5 text-emerald-950", collapsed && "absolute right-2 top-1 min-w-4 px-1 text-[9px] leading-4")}>
                          {badge > 99 ? "99+" : badge}
                          <span className="sr-only"> unread</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {!collapsed ? (
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-emerald-900/60 p-3 ring-1 ring-inset ring-white/10">
            <Avatar name={user.displayName} size="sm" className="bg-emerald-700 text-white" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-emerald-200/70">Signed in as</p>
              <p className="truncate text-[13.5px] font-semibold text-white">{user.displayName}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-emerald-800 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-100 ring-1 ring-inset ring-emerald-700">{roleLabel}</span>
                {!live && <span className="text-[11px] text-emerald-200/70 tabular-nums">Session 2026–27</span>}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-center border-t border-white/10 py-3" title={`Signed in as ${user.displayName}`}>
          <Avatar name={user.displayName} size="sm" className="bg-emerald-700 text-white" />
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={cn("sticky top-0 hidden h-screen shrink-0 transition-[width] duration-300 md:block", collapsed ? "w-[76px]" : "w-[76px] lg:w-[272px]")}>
      <div className="h-full lg:hidden"><SidebarContent collapsed /></div>
      <div className="hidden h-full lg:block"><SidebarContent collapsed={collapsed} /></div>
      <button
        onClick={onToggle}
        className="absolute -right-3 top-7 z-10 hidden h-6 w-6 place-items-center rounded-full border border-line bg-white text-ink-muted shadow-soft hover:text-emerald-700 lg:grid"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );
}
