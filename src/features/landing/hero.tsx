"use client";
import Link from "next/link";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, IconTile, type AppIconName } from "@/components/icons/app-icon";
import { cn } from "@/lib/utils/cn";
import { Caret, useTyping } from "./bits";

export function LandingNav({ signedIn, home }: { signedIn: boolean; home: string }) {
  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-surface/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:shadow-focus"><Logo /></Link>
        <nav aria-label="Sections" className="hidden items-center gap-1 text-[14px] text-ink-muted md:flex">
          {[["How it works", "#how"], ["Modules", "#modules"], ["Roles", "#roles"], ["Security", "#security"]].map(([l, h]) => (
            <a key={h} href={h} className="rounded-lg px-3 py-2 transition-colors duration-150 hover:text-ink">{l}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <Link href={home} className="group inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 text-[13.5px] font-medium text-white shadow-button transition-colors hover:bg-brand-700">
              Open dashboard <ArrowRight className="icon-nudge h-4 w-4" />
            </Link>
          ) : (
            <Link href="/login" className="group inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 text-[13.5px] font-medium text-white shadow-button transition-colors hover:bg-brand-700">
              Sign in <ArrowRight className="icon-nudge h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

const QUERIES: { q: string; to: string; icon: AppIconName; tint: string }[] = [
  { q: "mark attendance for 10-A", to: "Attendance · Class 10-A register", icon: "attendance", tint: "bg-[#E8F7EE] text-[#157F3C]" },
  { q: "who hasn't paid term 2 fees", to: "Fees · Defaulters list", icon: "fees", tint: "bg-marigold-soft text-[#9A5B00]" },
  { q: "post a notice about sports day", to: "Notices · New notice", icon: "notices", tint: "bg-[#FFF1E8] text-[#B4490B]" },
  { q: "find Aarav Sharma", to: "Students · 1 result", icon: "students", tint: "bg-cobalt-soft text-cobalt-deep" },
];

export function Hero({ signedIn, home }: { signedIn: boolean; home: string }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-[560px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative mx-auto max-w-[1200px] px-5 pb-10 pt-14 text-center sm:px-8 sm:pt-20">
        <a href="#how" className="group mx-auto inline-flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 text-[13px] font-medium text-ink-soft shadow-card transition-colors hover:text-ink">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11.5px] text-white"><AppIcon name="spark" weight="fill" className="h-3 w-3 text-marigold" /> New</span>
          Ask Atrium: type it, go there
          <ArrowRight className="icon-nudge h-3.5 w-3.5" />
        </a>
        <h1 className="mx-auto mt-6 max-w-[880px] text-[44px] font-semibold leading-[1.02] tracking-[-0.05em] text-ink sm:text-[64px] lg:text-[76px]">
          Run your whole school from <span className="font-serif text-[1.08em] font-normal italic tracking-[-0.02em]">one box</span><span className="text-marigold">.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-relaxed text-ink-muted sm:text-[18px]">
          Attendance, fees, exams, homework and notices in one calm place. Type what you need and Atrium opens the right page.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <Link href={signedIn ? home : "/login"} className="group inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-[15px] font-medium text-white shadow-button transition-colors hover:bg-brand-700">
            {signedIn ? "Open your dashboard" : "Sign in to your school"} <ArrowRight className="icon-nudge h-4 w-4" />
          </Link>
          <a href="#how" className="inline-flex h-11 items-center gap-2 rounded-xl bg-surface px-5 text-[15px] font-medium text-ink shadow-card transition-colors hover:bg-surface-2">
            See how it works
          </a>
        </div>
        <p className="mt-4 text-[13px] text-ink-muted">Installs on any phone as an app · Accounts are issued by your school</p>
      </div>
      <ProductWindow />
    </section>
  );
}

const NAV: [AppIconName, string, boolean?][] = [
  ["dashboard", "Dashboard", true], ["students", "Students"], ["attendance", "Attendance"], ["fees", "Fees"],
  ["exams", "Examinations"], ["timetable", "Timetable"], ["notices", "Notices & Events"], ["reports", "Reports"],
];

/** The hero's made thing: the real dashboard layout, built in code, with the Ask box typing live. */
function ProductWindow() {
  const lines = QUERIES.map((x) => x.q);
  const { text, index } = useTyping(lines);
  const hit = QUERIES[index];
  const done = text.length === hit.q.length;
  return (
    <div className="relative mx-auto max-w-[1200px] px-3 pb-20 sm:px-8">
      <div className="rounded-[26px] bg-ink/[0.035] p-1.5 ring-1 ring-ink/[0.06] sm:p-2.5">
        <div className="overflow-hidden rounded-[20px] bg-ground text-left shadow-[0_40px_80px_-40px_rgb(17_19_24/0.35)] ring-1 ring-ink/[0.07]">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="mx-auto hidden rounded-md bg-surface px-3 py-0.5 font-mono text-[11px] text-ink-muted ring-1 ring-line sm:block">aster.atrium.example/admin/dashboard</span>
          </div>
          <div className="grid md:grid-cols-[200px_1fr]">
            <aside className="hidden flex-col gap-0.5 p-3 text-[12.5px] md:flex">
              <div className="mb-2 flex items-center gap-2 px-2 py-1">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-600 text-[10px] font-bold text-white">AA</span>
                <span className="font-semibold text-ink">Aster Academy</span>
              </div>
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-brand-600 px-2 py-1.5 font-medium text-white"><AppIcon name="spark" className="h-3.5 w-3.5 text-marigold" /> Ask Atrium <span className="ml-auto rounded bg-white/15 px-1 font-mono text-[10px]">⌘K</span></div>
              {NAV.map(([icon, label, active]) => (
                <div key={label} className={cn("group flex items-center gap-2 rounded-lg px-1.5 py-1", active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-soft")}>
                  <IconTile name={icon} size="xs" />{label}
                </div>
              ))}
            </aside>
            <div className="m-0 min-w-0 bg-surface-2 p-3 sm:p-5 md:my-2 md:mr-2 md:rounded-[16px] md:shadow-canvas">
              {/* Ask hero */}
              <div className="relative overflow-hidden rounded-[18px] bg-brand-700 p-4 text-white sm:p-5">
                <p className="text-[18px] font-semibold tracking-[-0.03em] sm:text-[22px]">Good morning, Aanya</p>
                <p className="text-[12px] text-white/55">Aster Academy · 2026–27 · Saturday, 14 November</p>
                <div className="mt-3 flex h-12 items-center gap-2.5 rounded-xl bg-white px-2.5 text-ink">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-marigold"><AppIcon name="spark" className="h-[18px] w-[18px]" /></span>
                  <span className="min-w-0 flex-1 truncate text-[14px]">{text}<Caret /></span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white"><CornerDownLeft className="h-3.5 w-3.5" /></span>
                </div>
                <div className={cn("mt-2 flex items-center gap-2 rounded-xl bg-white/[0.07] px-2.5 py-2 text-[12.5px] ring-1 ring-inset ring-white/10 transition-[opacity,transform] duration-300", done ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0")}>
                  <IconTile key={hit.q} name={hit.icon} size="xs" live={done} />
                  <span className="text-white/85">{hit.to}</span>
                  <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10.5px] text-white/70">↵ open</span>
                </div>
              </div>
              {/* Metrics */}
              <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                {[
                  ["Students enrolled", "1,284", "Across 42 sections", "students"],
                  ["Attendance today", "94.6%", "61 absent · 3 classes left", "attendance"],
                  ["Fees collected", "₹1.42 Cr", "71% of this term", "fees"],
                  ["Exams this month", "3", "Unit Test 2 starts Monday", "exams"],
                ].map(([l, v, s, i]) => (
                  <div key={l} className="rounded-[14px] bg-surface p-3 shadow-card">
                    <div className="flex items-center justify-between text-[11.5px] text-ink-muted">{l}<IconTile name={i as AppIconName} size="xs" /></div>
                    <p className="figures mt-2 text-[22px] font-semibold tracking-[-0.04em] text-ink">{v}</p>
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted">{s}</p>
                  </div>
                ))}
              </div>
              {/* Chart + list */}
              <div className="mt-3 grid gap-2.5 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-[14px] bg-surface p-3.5 shadow-card">
                  <div className="flex items-center justify-between"><p className="text-[12.5px] font-semibold text-ink">Attendance, last 15 days</p><p className="text-[11px] text-ink-muted">avg 93.1%</p></div>
                  <div className="mt-3 flex h-24 items-end gap-1.5">
                    {[88, 92, 95, 91, 94, 96, 90, 86, 93, 95, 97, 92, 94, 95, 96].map((v, i, a) => (
                      <div key={i} className={cn("flex-1 origin-bottom animate-[grow-y_.8s_cubic-bezier(.2,.8,.2,1)_both] rounded-full", v === Math.min(...a) ? "bg-marigold" : i === a.length - 1 ? "bg-brand-800" : "bg-brand-500")} style={{ height: `${(v - 80) * 5}%`, animationDelay: `${i * 35}ms` }} />
                    ))}
                  </div>
                </div>
                <div className="rounded-[14px] bg-surface p-3.5 shadow-card">
                  <p className="text-[12.5px] font-semibold text-ink">Needs attention</p>
                  <ul className="mt-2 space-y-2 text-[12px]">
                    {[["bg-plum", "9-B register not marked", "Mark now"], ["bg-marigold", "60 students with overdue fees", "Remind"], ["bg-cobalt", "2 leave requests", "Review"]].map(([c, t, a]) => (
                      <li key={t} className="flex items-center gap-2"><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c)} /><span className="flex-1 truncate text-ink-soft">{t}</span><span className="rounded-md bg-bg px-1.5 py-0.5 text-[11px] font-medium text-ink ring-1 ring-inset ring-line">{a}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 px-1 text-[11px] text-ink-faint"><Search className="h-3 w-3" /> Illustrative data from the demo school</div>
            </div>
          </div>
        </div>
      </div>
      {/* Floating people, to make the window feel occupied */}
      <div aria-hidden className="float-y absolute -left-1 top-[64%] hidden items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 text-[12px] font-medium text-ink shadow-lift xl:flex">
        <Avatar name="Rahul Verma" size="xs" /> Mr. Verma marked 10-A
      </div>
      <div aria-hidden className="float-y absolute -right-1 top-[30%] hidden items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 text-[12px] font-medium text-ink shadow-lift [animation-delay:-2s] xl:flex">
        <Avatar name="Meera Iyer" size="xs" /> Receipt AA/26-27/0412 issued
      </div>
    </div>
  );
}
