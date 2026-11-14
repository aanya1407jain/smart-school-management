"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useSession } from "@/features/auth/session-provider";
import { getNavigationForUser, type NavItem } from "@/lib/permissions";
import { AppIcon, ICON_TONE } from "@/components/icons/app-icon";
import { useAsk } from "@/components/command/ask-provider";
import { cn } from "@/lib/utils/cn";
import { SidebarContent } from "./sidebar";

/** Drawer navigation for phones — same items as the desktop sidebar. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] md:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(86vw,300px)] shadow-lift focus:outline-none data-[state=open]:animate-[drawer-l_.22s_cubic-bezier(.2,.8,.2,1)] md:hidden">
          <Dialog.Title className="sr-only">Navigation menu</Dialog.Title>
          <Dialog.Description className="sr-only">Links to the sections of your workspace</Dialog.Description>
          <div className="h-full pt-[env(safe-area-inset-top)]"><SidebarContent onNavigate={() => onOpenChange(false)} /></div>
          <Dialog.Close className="absolute right-2 top-[calc(env(safe-area-inset-top)+10px)] grid h-11 w-11 place-items-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus" aria-label="Close menu">
            <X className="h-5 w-5" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Which pages earn a slot in the phone tab bar, per role (first two the user can open). */
const TAB_PREFS: Record<string, string[]> = {
  admin: ["/admin/students", "/admin/fees", "/admin/attendance", "/admin/notices"],
  teacher: ["/teacher/attendance", "/teacher/classes", "/teacher/homework", "/teacher/timetable"],
  student: ["/student/timetable", "/student/homework", "/student/results", "/student/fees"],
};

const SHORT: Record<string, string> = {
  "Teachers & Staff": "Staff", "Notices & Events": "Notices", "My Classes": "Classes", "My Timetable": "Timetable",
  "My Homework": "Homework", "My Results": "Results", "My Fees": "Fees", "My Attendance": "Attendance",
};

/**
 * Phone tab bar (PWA-style): Home, two key pages, Ask in the middle, Menu.
 * Sits above the home indicator via the safe-area inset.
 */
export function MobileTabBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, dataSource } = useSession();
  const pathname = usePathname();
  const { open } = useAsk();
  if (!user) return null;
  const items = getNavigationForUser(user, { liveOnly: dataSource === "live" }).flatMap((g) => g.items);
  const home = items.find((i) => i.icon === "dashboard");
  const picks = (TAB_PREFS[user.role] ?? []).map((h) => items.find((i) => i.href === h)).filter(Boolean).slice(0, 2) as NavItem[];
  const tab = (i: NavItem) => {
    const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
    return (
      <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10.5px] font-medium transition-colors", active ? "text-ink" : "text-ink-muted")}>
<span className={cn("grid h-8 w-11 place-items-center rounded-full transition-colors duration-200", active && ICON_TONE[i.icon].bg)}><AppIcon key={active ? `${i.href}-on` : i.href} name={i.icon} live={active} className={cn("h-[21px] w-[21px]", active ? ICON_TONE[i.icon].fg : "text-ink-muted")} /></span>
        {i.icon === "dashboard" ? "Home" : SHORT[i.label] ?? i.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-md items-center gap-1 py-1">
        {home && tab(home)}
        {picks[0] && tab(picks[0])}
        <div className="flex flex-1 justify-center">
          <button type="button" onClick={() => open()} aria-label="Ask Atrium" className="grid h-12 w-12 -translate-y-2 place-items-center rounded-2xl bg-brand-600 text-marigold shadow-[0_10px_24px_-8px_rgb(11_52_44/0.6)] transition-transform duration-150 active:scale-[.96]">
            <AppIcon name="spark" className="h-6 w-6" />
          </button>
        </div>
        {picks[1] && tab(picks[1])}
        <button type="button" onClick={onOpenMenu} className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10.5px] font-medium text-ink-muted">
          <span className="grid h-[22px] w-[22px] place-items-center"><span className="grid gap-[3px]"><span className="block h-[2px] w-[16px] rounded bg-current" /><span className="block h-[2px] w-[16px] rounded bg-current" /><span className="block h-[2px] w-[11px] rounded bg-current" /></span></span>
          Menu
        </button>
      </div>
    </nav>
  );
}
