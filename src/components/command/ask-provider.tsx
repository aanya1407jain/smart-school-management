"use client";
/**
 * Ask Atrium: the ⌘K command bar. One box for the whole school: type what you
 * want to do ("mark attendance", "overdue fees", "find Aarav") or the name of
 * a page, press Enter, and you are there.
 *
 * Results come from src/lib/ask/intents.ts, filtered to the signed-in user's
 * own navigation (role + permissions + school modules).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, CornerDownLeft } from "lucide-react";
import { useSession } from "@/features/auth/session-provider";
import { getNavigationForUser, hasPermission } from "@/lib/permissions";
import { ask, suggestions, type AskResult } from "@/lib/ask/intents";
import { AppIcon, IconTile } from "@/components/icons/app-icon";
import { cn } from "@/lib/utils/cn";

type AskContextValue = { open: (prefill?: string) => void; close: () => void; isOpen: boolean };
const AskContext = createContext<AskContextValue>({ open: () => {}, close: () => {}, isOpen: false });

export const useAsk = () => useContext(AskContext);

/** The signed-in user's pages + whether they may search students. */
export function useAskScope() {
  const { user, dataSource } = useSession();
  return useMemo(() => {
    const items = getNavigationForUser(user, { liveOnly: dataSource === "live" }).flatMap((g) => g.items);
    return { user, items, canSearchStudents: !!user && hasPermission(user, "students:read:all") };
  }, [user, dataSource]);
}

export function AskProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const { user } = useSession();

  const open = useCallback((text = "") => { setPrefill(text); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPrefill(""); setOpen((o) => !o); return; }
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setPrefill(""); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  return (
    <AskContext.Provider value={value}>
      {children}
      {user && <AskDialog open={isOpen} onOpenChange={setOpen} prefill={prefill} />}
    </AskContext.Provider>
  );
}

const RECENT_KEY = "ssms-ask-recent";

/** Last few places opened from Ask (this device only; never synced). */
function rememberRecent(r: AskResult) {
  try {
    const prev = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as AskResult[];
    const item = { id: r.id, title: r.title, subtitle: r.subtitle, href: r.href, icon: r.icon, kind: r.kind, score: 0 };
    const next = [item, ...prev.filter((x) => x.href !== r.href)].slice(0, 4);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable: no recents */ }
}

/** Recents the user can still open (their pages may change with role or modules). */
function readRecent(items: { href: string }[]): AskResult[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as AskResult[];
    return list.filter((x) => x && typeof x.href === "string" && (x.href === "/account" || items.some((i) => x.href === i.href || x.href.startsWith(`${i.href}?`) || x.href.startsWith(`${i.href}/`))));
  } catch { return []; }
}

function AskDialog({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; prefill: string }) {
  const router = useRouter();
  const { user, items, canSearchStudents } = useAskScope();
  const [q, setQ] = useState(prefill);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(prefill); setActive(0); } }, [open, prefill]);

  const [recent, setRecent] = useState<AskResult[]>([]);
  useEffect(() => { if (open) setRecent(readRecent(items)); }, [open, items]);

  const results = useMemo(() => {
    const r = ask(q, items, { canSearchStudents });
    if (q.trim()) return r.slice(0, 9);
    // Empty: where you went last, a few suggested actions, then every page.
    const rec = recent.map((x) => ({ ...x, id: `recent-${x.href}`, kind: "recent" as const }));
    const seen = new Set(rec.map((x) => x.href));
    return [...rec, ...r.filter((x) => x.kind === "action" && !seen.has(x.href)).slice(0, 5), ...r.filter((x) => x.kind === "page" && !seen.has(x.href))];
  }, [q, items, canSearchStudents, recent]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (r: AskResult | undefined) => {
    if (!r) return;
    rememberRecent(r);
    onOpenChange(false);
    router.push(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
  };

  const recentItems = results.filter((r) => r.kind === "recent");
  const doItems = results.filter((r) => r.kind !== "page" && r.kind !== "recent");
  const pageItems = results.filter((r) => r.kind === "page");
  const chips = user ? suggestions(user.role, items) : [];

  const row = (r: AskResult, i: number) => (
    <button
      key={r.id + r.href}
      id={`ask-${i}`}
      type="button"
      role="option"
      aria-selected={i === active}
      data-index={i}
      onMouseMove={() => setActive(i)}
      onClick={() => go(r)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none",
        i === active ? "bg-brand-50" : "bg-transparent",
      )}
    >
      <IconTile key={i === active ? `${r.id}-on` : r.id} name={r.icon} size="md" live={i === active} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{r.title}</span>
        {r.subtitle && <span className="block truncate text-[12.5px] text-ink-muted">{r.subtitle}</span>}
      </span>
      {i === active ? (
        <span className="kbd shrink-0"><CornerDownLeft className="h-3 w-3" aria-hidden /></span>
      ) : (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      )}
    </button>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-ink/25 backdrop-blur-[3px] data-[state=open]:animate-[fade-up_.15s_ease-out]" />
        <Dialog.Content
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[12vh] z-[81] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[22px] bg-surface shadow-[0_0_0_1px_rgb(17_19_24/0.08),0_30px_80px_-20px_rgb(17_19_24/0.35)] focus:outline-none data-[state=open]:animate-[scale-in_.16s_cubic-bezier(.2,.8,.2,1)] max-sm:top-3"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Ask Atrium</Dialog.Title>
          <div className="ask-glow border-b border-line px-4 pb-3 pt-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-marigold">
                <AppIcon name="spark" className="h-5 w-5" />
              </span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="What do you need? Try “overdue fees”"
                aria-label="Ask Atrium"
                role="combobox"
                aria-expanded
                aria-controls="ask-results"
                aria-activedescendant={results[active] ? `ask-${active}` : undefined}
                className="h-10 min-w-0 flex-1 bg-transparent text-[17px] font-medium tracking-[-0.01em] text-ink placeholder:text-ink-faint focus:outline-none max-sm:text-base"
              />
              <span className="kbd hidden sm:inline-flex">esc</span>
            </div>
            {!q && chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <button key={c} type="button" onClick={() => setQ(c)} className="rounded-full bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink-soft ring-1 ring-inset ring-line transition-colors duration-150 hover:text-ink hover:ring-line-strong">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div id="ask-results" ref={listRef} role="listbox" className="scrollbar-thin max-h-[min(52vh,440px)] overflow-y-auto p-2">
            {results.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-[14px] font-medium text-ink">No page matches “{q}”</p>
                <p className="mt-1 text-[13px] text-ink-muted">Try a task like “take attendance” or a page name like “Fees”.</p>
              </div>
            ) : (
              <>
                {recentItems.length > 0 && <p className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium text-ink-muted">Recent</p>}
                {recentItems.map((r) => row(r, results.indexOf(r)))}
                {doItems.length > 0 && <p className={cn("px-2.5 pb-1 text-[11.5px] font-medium text-ink-muted", recentItems.length ? "pt-3" : "pt-1.5")}>{q ? "Best match" : "Suggested"}</p>}
                {doItems.map((r) => row(r, results.indexOf(r)))}
                {pageItems.length > 0 && <p className="px-2.5 pb-1 pt-3 text-[11.5px] font-medium text-ink-muted">Pages</p>}
                {pageItems.map((r) => row(r, results.indexOf(r)))}
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-2.5 text-[11.5px] text-ink-muted">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
              <span className="flex items-center gap-1"><span className="kbd">↵</span> open</span>
            </span>
            <span className="hidden sm:inline">Only shows pages your account can open</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
