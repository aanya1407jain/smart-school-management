"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSession } from "@/features/auth/session-provider";
import { getNavigationForUser, ROLE_LABELS } from "@/lib/permissions";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils/cn";
import { NAV_ICONS } from "./nav-icons";
import { useUnreadCount } from "@/features/notifications/use-unread-count";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";

const WORKSPACE: Record<string, string> = { admin: "Administration", teacher: "Teacher workspace", student: "Student portal" };

/**
 * The sidebar is the strongest visual element: a deep sapphire → lagoon
 * panel with soft lavender/teal light. Items come only from the user's
 * permissions — unauthorized items are never rendered.
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

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-sapphire via-sapphire to-lagoon text-white">
      {/* ambient light */}
      <div aria-hidden className="pointer-events-none absolute -right-24 top-10 h-64 w-64 rounded-full bg-mauve/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-teal/30 blur-3xl" />

      <div className={cn("relative flex items-center gap-3 px-5 pb-5 pt-6", collapsed && "justify-center px-0")}>
        <LogoMark size={collapsed ? 36 : 40} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="font-display text-[17px] font-semibold tracking-wide">{school?.name ?? "\u00A0"}</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">{WORKSPACE[user.role]}</p>
          </div>
        )}
      </div>

      <nav aria-label="Main navigation" className="scrollbar-thin relative flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            {!collapsed && <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/40">{g.label}</p>}
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
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-150",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_24px_-12px_rgba(47,157,148,0.8)] backdrop-blur-sm"
                          : "text-white/70 hover:bg-white/[0.07] hover:text-white",
                      )}
                    >
                      {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-teal shadow-[0_0_12px_rgba(47,157,148,0.9)]" />}
                      <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-white" : "text-white/60 group-hover:text-white")} aria-hidden />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {badge !== null && (
                        <span className={cn("grid min-w-5 place-items-center rounded-full bg-blush px-1.5 text-[11px] font-bold text-plum", collapsed && "absolute right-2 top-1.5 min-w-4 px-1 text-[9px]")}>
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

      {!collapsed && (
        <div className="relative m-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Signed in as</p>
          <p className="mt-1 truncate text-sm font-semibold">{user.displayName}</p>
          <p className="text-[12px] text-white/60">{user.guardianId ? "Guardian" : user.title ?? ROLE_LABELS[user.role]}{live ? "" : " · 2026–27"}</p>
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
        className="absolute -right-3 top-7 z-10 hidden h-6 w-6 place-items-center rounded-full border border-line bg-white text-ink-muted shadow-soft hover:text-ink lg:grid"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );
}
