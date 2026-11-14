"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSession } from "@/features/auth/session-provider";
import { getNavigationForUser, ROLE_LABELS } from "@/lib/permissions";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import { AppIcon, IconTile } from "@/components/icons/app-icon";
import { useAsk } from "@/components/command/ask-provider";
import { useUnreadCount } from "@/features/notifications/use-unread-count";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";

const WORKSPACE: Record<string, string> = { admin: "Administration", teacher: "Teacher workspace", student: "Student portal" };


/**
 * The sidebar sits on the app ground: school switcher, the Ask entry, then the
 * user's own pages, each with its module's colour tile. The active page is a
 * white chip that slides between items (shared layout animation) and its icon
 * plays once. Items come only from the user's permissions.
 */
export function SidebarContent({ collapsed = false, onNavigate, idPrefix = "side" }: { collapsed?: boolean; onNavigate?: () => void; idPrefix?: string }) {
  const { user, viewer, dataSource } = useSession();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const live = dataSource === "live";
  const groups = getNavigationForUser(user, { liveOnly: live });
  const unread = useUnreadCount();
  const demoSchool = useSchoolProfile();
  const { open } = useAsk();
  const school = live ? viewer?.school : demoSchool;
  if (!user) return null;
  const roleLabel = user.title ?? ROLE_LABELS[user.role];

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <div className={cn("flex items-center gap-2.5 px-4 pb-3 pt-4", collapsed && "justify-center px-0", onNavigate && "pr-14")}>
        <LogoMark size={32} label={`${school?.name ?? "School"} crest`} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[14px] font-semibold tracking-[-0.015em] text-ink">{school?.name ?? " "}</p>
            <p className="mt-0.5 truncate text-[12px] text-ink-muted">{WORKSPACE[user.role]}</p>
          </div>
        )}
      </div>

      <div className={cn("px-3 pb-3", collapsed && "px-2.5")}>
        <button
          type="button"
          onClick={() => { onNavigate?.(); open(); }}
          title={collapsed ? "Ask Atrium (⌘K)" : undefined}
          className={cn(
            "group flex h-10 w-full items-center gap-2.5 rounded-xl bg-brand-600 px-2.5 text-[13.5px] font-medium text-white shadow-button transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
            collapsed && "justify-center px-0",
          )}
        >
          <AppIcon name="spark" className="h-[18px] w-[18px] text-marigold" />
          {!collapsed && <span className="flex-1 truncate text-left">Ask Atrium</span>}
          {!collapsed && <span className="rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-[10.5px] text-white/85">⌘K</span>}
        </button>
      </div>

      <LayoutGroup id={idPrefix}>
        <nav aria-label="Main navigation" className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g, gi) => (
            <div key={g.label} className={cn(gi > 0 && "mt-4")}>
              {!collapsed && gi > 0 && <p className="px-2.5 pb-1.5 text-[11.5px] font-medium text-ink-faint">{g.label}</p>}
              {collapsed && gi > 0 && <div aria-hidden className="mx-2 mb-3 border-t border-line-strong/70" />}
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const badge = item.icon === "notifications" && unread > 0 ? unread : null;
                  return (
                    <li key={item.href} className="relative">
                      {active && (
                        <motion.span
                          layoutId={`${idPrefix}-active`}
                          aria-hidden
                          className="absolute inset-0 rounded-xl bg-surface shadow-card"
                          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40, mass: 0.7 }}
                        />
                      )}
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group relative flex min-h-[36px] items-center gap-2.5 rounded-xl px-1.5 text-[13.5px] transition-colors duration-150 max-md:min-h-11",
                          "focus-visible:outline-none focus-visible:shadow-focus",
                          collapsed && "justify-center px-0",
                          active ? "font-medium text-ink" : "text-ink-soft hover:bg-ink/[0.04] hover:text-ink",
                        )}
                      >
                        <IconTile name={item.icon} size="sm" live={active} className={cn("transition-transform duration-200 group-hover:scale-105", !active && "saturate-[.85]")} />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {badge !== null && (
                          <span className={cn("figures grid min-w-5 place-items-center rounded-full bg-coral px-1.5 text-[10.5px] font-semibold leading-5 text-white", collapsed && "absolute right-0.5 top-0 min-w-4 px-1 text-[9px] leading-4")}>
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
      </LayoutGroup>

      <div className={cn("border-t border-line-strong/60 p-3", collapsed && "flex justify-center px-0")}>
        {collapsed ? (
          <span title={`Signed in as ${user.displayName}`}><Avatar name={user.displayName} size="sm" /></span>
        ) : (
          <div className="flex items-center gap-2.5 px-1">
            <Avatar name={user.displayName} size="sm" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-medium text-ink">{user.displayName}</p>
              <p className="truncate text-[12px] text-ink-muted">{roleLabel}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 248 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 38 }}
      className="group/side sticky top-0 z-40 hidden h-screen shrink-0 overflow-hidden md:block max-lg:!w-[72px]"
    >
      <div className="h-full lg:hidden"><SidebarContent collapsed idPrefix="side-md" /></div>
      <div className="hidden h-full lg:block"><SidebarContent collapsed={collapsed} idPrefix="side-lg" /></div>
      <button
        onClick={onToggle}
        className={cn(
          "absolute bottom-[70px] z-10 hidden h-7 w-7 place-items-center rounded-lg text-ink-muted opacity-0 transition-opacity duration-150 hover:bg-ink/5 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-focus group-hover/side:opacity-100 lg:grid",
          collapsed ? "left-1/2 -translate-x-1/2" : "right-3",
        )}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
      </button>
    </motion.aside>
  );
}
