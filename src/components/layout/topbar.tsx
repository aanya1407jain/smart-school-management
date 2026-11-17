"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, ChevronDown, ChevronRight, LogOut, Settings, UserRound, Search, CheckCheck } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { useAsk } from "@/components/command/ask-provider";
import { useSession } from "@/features/auth/session-provider";
import { findNavItem, hasPermission, ROLE_LABELS } from "@/lib/permissions";
import { requireDemo } from "@/lib/demo/runtime";
import { useQuery } from "@/lib/hooks/use-query";
import { relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { useUnreadCount } from "@/features/notifications/use-unread-count";
import { CategoryIcon } from "@/features/notifications/category-icon";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";
import { useToast } from "@/components/ui/toast";
import { api } from "@convex/_generated/api";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import type { NotificationCategory } from "@/types/core";

const AREA_LABEL: Record<string, string> = { admin: "Administration", teacher: "Teacher", student: "Student portal" };
const SUBPAGE_LABEL: Record<string, string> = { new: "New", edit: "Edit" };

function useBreadcrumbs() {
  const pathname = usePathname();
  const { user, viewer, dataSource } = useSession();
  const demoSchoolName = useSchoolProfile()?.name ?? "";
  const schoolName = dataSource === "live" ? viewer?.school.name ?? "" : demoSchoolName;
  const segs = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [{ label: AREA_LABEL[segs[0]] ?? schoolName, href: user ? `/${user.role}/dashboard` : undefined }];
  const item = findNavItem(pathname, user);
  if (item) crumbs.push({ label: item.label, href: item.href });
  const rest = item ? pathname.slice(item.href.length).split("/").filter(Boolean) : segs.slice(1);
  rest.forEach((s, i) => crumbs.push({ label: SUBPAGE_LABEL[s] ?? (i === 0 ? "Details" : s.charAt(0).toUpperCase() + s.slice(1)) }));
  return { crumbs, title: item?.label ?? schoolName };
}

const LIVE_CATEGORY: Record<string, NotificationCategory> = {
  attendance: "attendance", fees: "fees", homework: "homework", examination: "examination", notice: "notice", general: "general", account: "general",
};

/** Live-portal accounts: notifications straight from Convex (own only, server-enforced). */
function LiveNotificationBell() {
  const { user } = useSession();
  const router = useRouter();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const recent = useSchoolQuery(api.notifications.list, open ? { limit: 6 } : "skip");
  const markRead = useSchoolMutation(api.notifications.markRead);
  const markAll = useSchoolMutation(api.notifications.markAllRead);
  if (!user) return null;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-ink-soft hover:bg-ink/5 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="h-[19px] w-[19px]" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-semibold text-white ring-2 ring-surface">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <p className="text-sm font-semibold text-ink">Notifications</p>
          {unread > 0 && (
            <button onClick={() => { void markAll({}); }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-lagoon hover:underline">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="scrollbar-thin max-h-[360px] overflow-y-auto px-1.5">
          {(recent ?? []).map((n) => (
            <DropdownItem
              key={n._id}
              onSelect={() => { if (!n.isRead) void markRead({ notificationId: n._id }); if (n.href?.startsWith("/student/")) router.push(n.href); }}
              className="items-start py-2.5"
            >
              <CategoryIcon category={LIVE_CATEGORY[n.type] ?? "general"} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[13px]", n.isRead ? "text-ink-soft" : "font-semibold text-ink")}>{n.title}</p>
                <p className="truncate text-[12px] text-ink-muted">{n.message}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">{relativeTime(new Date(n._creationTime).toISOString())}</p>
              </div>
              {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" aria-label="Unread" />}
            </DropdownItem>
          ))}
          {recent && recent.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-muted">You're all caught up.</p>}
          {open && recent === undefined && <p className="px-3 py-6 text-center text-sm text-ink-muted">Loading…</p>}
        </div>
        <DropdownSeparator />
        <DropdownItem
          onSelect={() => {
            const path = `/${user.role}/notifications`;
            router.push(path);
          }}
          className="mx-1.5 mb-1.5 justify-center font-medium text-lagoon"
        >
          View all notifications
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

function NotificationBell() {
  const { user } = useSession();
  const router = useRouter();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const recent = useQuery(() => requireDemo().notifications.list(), [user?.id, open], { enabled: open });
  if (!user) return null;
  const base = `/${user.role}`;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-ink-soft hover:bg-ink/5 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="h-[19px] w-[19px]" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-semibold text-white ring-2 ring-surface">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownTrigger>
      <DropdownContent className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <p className="text-sm font-semibold text-ink">Notifications</p>
          {unread > 0 && (
            <button onClick={() => requireDemo().notifications.markAllRead()} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-lagoon hover:underline">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="scrollbar-thin max-h-[360px] overflow-y-auto px-1.5">
          {(recent.data ?? []).slice(0, 6).map((n) => (
            <DropdownItem
              key={n.id}
              onSelect={() => { requireDemo().notifications.markRead(n.id); if (n.href) router.push(n.href); }}
              className="items-start py-2.5"
            >
              <CategoryIcon category={n.category} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[13px]", n.read ? "text-ink-soft" : "font-semibold text-ink")}>{n.title}</p>
                <p className="truncate text-[12px] text-ink-muted">{n.message}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">{relativeTime(n.createdAt)}</p>
              </div>
              {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" aria-label="Unread" />}
            </DropdownItem>
          ))}
          {recent.data && recent.data.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-muted">You're all caught up.</p>}
          {recent.isLoading && <p className="px-3 py-6 text-center text-sm text-ink-muted">Loading…</p>}
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push(`${base}/notifications`)} className="mx-1.5 mb-1.5 justify-center font-medium text-lagoon">View all notifications</DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

function ProfileMenu() {
  const { user, viewer, dataSource, logout } = useSession();
  const router = useRouter();
  if (!user) return null;
  const base = `/${user.role}`;
  const secondary = dataSource === "live" ? `Login ID ${viewer?.loginId ?? "—"}` : user.email;
  const roleLabel = user.title ?? ROLE_LABELS[user.role];
  // Teachers and students have personal Settings; an administrator needs settings:manage for the school Settings page.
  const settingsHref = user.role !== "admin" || hasPermission(user, "settings:manage") ? `${base}/settings` : `${base}/profile`;
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-ink/5" aria-label="Open profile menu">
          <Avatar name={user.displayName} size="sm" />
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-[13px] font-semibold text-ink">{user.displayName}</span>
            <span className="block text-[11.5px] text-ink-muted">{roleLabel}</span>
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-ink-muted lg:block" />
        </button>
      </DropdownTrigger>
      <DropdownContent>
        <div className="px-3 pb-2 pt-2">
          <p className="text-sm font-semibold text-ink">{user.displayName}</p>
          <p className="text-[12px] text-ink-muted">{secondary}</p>
          <span className="mt-1.5 inline-block rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-inset ring-line">{roleLabel}</span>
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push(`${base}/profile`)}><UserRound className="h-4 w-4" /> Profile</DropdownItem>
        <DropdownItem onSelect={() => router.push(settingsHref)}><Settings className="h-4 w-4" /> Account settings</DropdownItem>
        <DropdownItem onSelect={() => router.push(`${base}/notifications`)}><Bell className="h-4 w-4" /> Notifications</DropdownItem>
        <DropdownSeparator />
        <DropdownItem tone="danger" onSelect={async () => { await logout(); router.replace("/login"); }}><LogOut className="h-4 w-4" /> Log out</DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

/** The search/ask pill: opens Ask Atrium (⌘K). Replaces the old students-only search box. */
function AskTrigger() {
  const { open } = useAsk();
  return (
    <>
      <button
        type="button"
        onClick={() => open()}
        className="group hidden h-9 w-full max-w-[300px] items-center gap-2 rounded-[10px] bg-surface px-3 text-[13px] text-ink-muted shadow-card transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus md:flex"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 truncate text-left">Search or ask anything…</span>
        <span className="kbd">⌘K</span>
      </button>
      <Button variant="ghost" size="icon" className="text-ink-soft hover:bg-ink/5 hover:text-ink md:hidden" onClick={() => open()} aria-label="Search or ask">
        <Search className="h-[19px] w-[19px]" />
      </Button>
    </>
  );
}

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { crumbs } = useBreadcrumbs();
  // Live-portal accounts never touch the demo-data services.
  const live = useSession().dataSource === "live";
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-surface-2/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:rounded-t-[20px]">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6 lg:px-8">
        <button type="button" className="-ml-1 grid h-10 w-10 place-items-center rounded-xl md:hidden" onClick={onOpenMobileNav} aria-label="Open navigation menu">
          <LogoMark size={28} />
        </button>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            {crumbs.map((c, i) => (
              // Phones: the page name, plus its parent on sub-pages ("Students › New"); the workspace crumb only from `sm`.
              <li key={i} className={cn("flex min-w-0 items-center gap-1.5", i < Math.min(crumbs.length - 1, Math.max(1, crumbs.length - 2)) && "hidden sm:flex")}>
                {i > 0 && <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 opacity-50", i === Math.max(1, crumbs.length - 2) && "hidden sm:block")} aria-hidden />}
                {c.href && i < crumbs.length - 1 ? (
                  <Link href={c.href} className="truncate transition-colors hover:text-ink">{c.label}</Link>
                ) : (
                  <span className={cn("truncate", i === crumbs.length - 1 && "font-medium text-ink")} aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <AskTrigger />
        {live ? <LiveNotificationBell /> : <NotificationBell />}
        <ProfileMenu />
      </div>
    </header>
  );
}
