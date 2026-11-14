"use client";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon, IconTile, type AppIconName } from "@/components/icons/app-icon";
import { cn } from "@/lib/utils/cn";
import { Caret, Clock, Reveal, useTyping } from "./bits";

/* ------------------------------------------------------------------ 1. Type it, go there (split, auto-cycling) */
const STEPS: { q: string; page: string; icon: AppIconName; tint: string; body: React.ReactNode }[] = [
  {
    q: "take attendance", page: "Attendance register", icon: "attendance", tint: "bg-[#E8F7EE] text-[#157F3C]",
    body: (
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={cn("grid aspect-square place-items-center rounded-lg text-[11px] font-semibold", i === 5 || i === 17 ? "bg-blush text-plum" : i === 11 ? "bg-pd-warning-soft text-pd-warning" : "bg-pd-ok-soft text-pd-ok")}>{i === 5 || i === 17 ? "A" : i === 11 ? "L" : "P"}</span>
        ))}
      </div>
    ),
  },
  {
    q: "overdue fees class 9", page: "Defaulters · Class 9", icon: "fees", tint: "bg-marigold-soft text-[#9A5B00]",
    body: (
      <ul className="space-y-2 text-[13px]">
        {[["Kabir Mehta", "₹18,400", 0.9], ["Ira Nair", "₹9,200", 0.5], ["Vivaan Rao", "₹6,750", 0.35]].map(([n, a, w]) => (
          <li key={n as string} className="flex items-center gap-2.5"><Avatar name={n as string} size="xs" /><span className="w-28 truncate text-ink-soft">{n}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg"><span className="grow-x block h-full rounded-full bg-marigold" style={{ width: `${(w as number) * 100}%` }} /></span><span className="figures w-16 text-right font-medium text-ink">{a}</span></li>
        ))}
      </ul>
    ),
  },
  {
    q: "set homework for 8-B", page: "New homework", icon: "homework", tint: "bg-[#FFEDEE] text-[#B4232A]",
    body: (
      <div className="space-y-2 text-[13px]">
        <div className="rounded-lg bg-bg px-3 py-2 text-ink">Fractions worksheet, exercise 4.2</div>
        <div className="flex gap-2"><span className="rounded-lg bg-bg px-3 py-2 text-ink-soft">8-B · Maths</span><span className="rounded-lg bg-bg px-3 py-2 text-ink-soft">Due Mon, 17 Nov</span></div>
      </div>
    ),
  },
  {
    q: "unit test 2 marks", page: "Marks entry · Unit Test 2", icon: "exams", tint: "bg-[#F1ECFF] text-[#5B3FD6]",
    body: (
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-[13px]">
        {[["Aarav Sharma", "46", "A1"], ["Diya Patel", "41", "A2"], ["Kabir Mehta", "33", "B1"]].map(([n, m, g]) => (<Fragment key={n}><span className="text-ink-soft">{n}</span><span className="figures text-right font-medium text-ink">{m}/50</span><span className="rounded bg-[#F1ECFF] px-1.5 text-center text-[11px] font-semibold text-[#5B3FD6]">{g}</span></Fragment>))}
      </div>
    ),
  },
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (reduce || paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % STEPS.length), 3200);
    return () => clearInterval(t);
  }, [reduce, paused]);
  const s = STEPS[i];
  return (
    <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16 [&>*]:min-w-0">
        <div>
          <h2 className="text-[36px] font-semibold leading-[1.05] tracking-[-0.045em] text-ink sm:text-[46px]">Say what you need.<br /><span className="text-ink-muted">Skip the menus.</span></h2>
          <p className="mt-4 max-w-[440px] text-[16px] leading-relaxed text-ink-muted">Press <span className="kbd">⌘K</span> or tap the spark. Atrium understands everyday school words and only offers pages your account is allowed to open.</p>
          <ul className="mt-8 space-y-1.5" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            {STEPS.map((st, k) => (
              <li key={st.q}>
                <button type="button" onClick={() => setI(k)} className={cn("group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-[background-color,box-shadow] duration-200", k === i ? "bg-surface shadow-card" : "hover:bg-ink/[0.03]")}>
                  <IconTile key={k === i ? `${st.q}-on` : st.q} name={st.icon} size="md" live={k === i} className={cn("transition-[filter] duration-200", k !== i && "grayscale-[.6] opacity-80")} />
                  <span className="flex-1 font-mono text-[14px] text-ink">“{st.q}”</span>
                  <ArrowRight className={cn("h-4 w-4 transition-[opacity,transform] duration-200", k === i ? "translate-x-0 text-ink opacity-100" : "-translate-x-1 opacity-0")} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div className="rounded-[26px] bg-brand-700 p-2.5">
            <div className="flex items-center gap-2.5 rounded-[18px] bg-white px-3 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-marigold"><AppIcon name="spark" className="h-[18px] w-[18px]" /></span>
              <span className="font-mono text-[14px] text-ink">{s.q}</span>
              <span className="kbd ml-auto">↵</span>
            </div>
            <div key={s.q} className="mt-2.5 animate-[scale-in_.25s_cubic-bezier(.2,.8,.2,1)] rounded-[18px] bg-white p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <IconTile name={s.icon} size="sm" live />
                <p className="text-[14px] font-semibold text-ink">{s.page}</p>
                <span className="ml-auto text-[11.5px] text-ink-muted">opened in 1 step</span>
              </div>
              {s.body}
            </div>
          </div>
          <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
            {STEPS.map((_, k) => <span key={k} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-300", k === i ? "w-6 bg-brand-600" : "w-1.5 bg-line-strong")} />)}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------ 2. Modules bento (interactive miniatures) */
function Tile({ className, title, text, icon, tint, children }: { className?: string; title: string; text: string; icon: AppIconName; tint: string; children: React.ReactNode }) {
  return (
    <div className={cn("group relative flex flex-col overflow-hidden rounded-[24px] bg-surface p-5 shadow-card sm:p-6", className)}>
      <div className="flex items-center gap-2.5">
        <IconTile name={icon} size="md" />
        <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
      </div>
      <p className="mt-2 max-w-[360px] text-[14px] leading-relaxed text-ink-muted">{text}</p>
      <div className="mt-5 flex-1">{children}</div>
    </div>
  );
}

function AttendanceToy() {
  const names = ["Aarav", "Diya", "Kabir", "Ira", "Vivaan", "Anaya", "Reyansh", "Myra"];
  const [st, setSt] = useState<string[]>(["P", "P", "L", "A", "P", "P", "P", "P"]);
  const cycle = (k: number) => setSt((s) => s.map((v, j) => (j === k ? (v === "P" ? "A" : v === "A" ? "L" : "P") : v)));
  const present = st.filter((v) => v !== "A").length;
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {names.map((n, k) => (
          <button key={n} type="button" onClick={() => cycle(k)} aria-label={`${n}: ${st[k] === "P" ? "present" : st[k] === "A" ? "absent" : "late"}. Tap to change.`} className={cn("flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 ring-1 ring-inset transition-[background-color,transform] duration-150 active:scale-95", st[k] === "P" ? "bg-pd-ok-soft ring-pd-ok/15" : st[k] === "A" ? "bg-blush ring-plum/15" : "bg-pd-warning-soft ring-pd-warning/15")}>
            <Avatar name={`${n} S`} size="sm" />
            <span className="text-[11.5px] font-medium text-ink">{n}</span>
            <span className={cn("text-[10.5px] font-semibold", st[k] === "P" ? "text-pd-ok" : st[k] === "A" ? "text-plum" : "text-pd-warning")}>{st[k] === "P" ? "Present" : st[k] === "A" ? "Absent" : "Late"}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-muted">Tap a student to change. <span className="figures font-medium text-ink">{present} of {names.length}</span> in class.</p>
    </div>
  );
}

function TimetableMini() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const cells: [string, string][] = [["Maths", "bg-cobalt-soft text-cobalt-deep"], ["Science", "bg-[#E8F7EE] text-[#157F3C]"], ["English", "bg-[#FFF1E8] text-[#B4490B]"], ["Hindi", "bg-[#F1ECFF] text-[#5B3FD6]"], ["Sports", "bg-marigold-soft text-[#9A5B00]"]];
  return (
    <div className="relative">
      <div className="grid grid-cols-5 gap-1.5 text-center text-[11px]">
        {days.map((d) => <span key={d} className="pb-1 font-medium text-ink-muted">{d}</span>)}
        {Array.from({ length: 20 }, (_, k) => { const c = cells[(k * 3 + Math.floor(k / 5)) % 5]; return <span key={k} className={cn("rounded-lg px-1 py-2 font-medium", c[1])}>{c[0]}</span>; })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-[58%] flex items-center gap-1.5"><span className="live-dot h-2 w-2 rounded-full bg-coral text-coral" /><span className="h-px flex-1 bg-coral" /><span className="rounded bg-coral px-1.5 text-[10px] font-semibold text-white">10:40</span></div>
    </div>
  );
}

function HomeworkMini() {
  const [done, setDone] = useState<boolean[]>([true, false, false]);
  const items = ["Fractions worksheet 4.2", "Read chapter 6, Our Environment", "Essay: A day without phones"];
  return (
    <ul className="space-y-2">
      {items.map((t, k) => (
        <li key={t}>
          <button type="button" onClick={() => setDone((d) => d.map((v, j) => (j === k ? !v : v)))} className="flex w-full items-center gap-3 rounded-xl bg-bg px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-ink/[0.05]">
            <span className={cn("grid h-5 w-5 place-items-center rounded-md ring-1 ring-inset transition-colors", done[k] ? "bg-brand-600 text-white ring-brand-600" : "bg-surface ring-line-strong")}>{done[k] && <Check className="h-3.5 w-3.5 animate-[pop_.3s_ease-out]" />}</span>
            <span className={cn("flex-1", done[k] ? "text-ink-muted line-through" : "text-ink")}>{t}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Modules() {
  return (
    <section id="modules" className="scroll-mt-20 bg-ground py-24 sm:py-32">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <Reveal className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[560px] text-[36px] font-semibold leading-[1.05] tracking-[-0.045em] text-ink sm:text-[46px]">Every daily job, built in and connected.</h2>
          <p className="max-w-[380px] text-[16px] leading-relaxed text-ink-muted">Mark a student absent and the parent portal, the report and the principal&apos;s dashboard all update. Nothing to copy twice.</p>
        </Reveal>
        <Reveal className="mt-12 grid gap-3 md:grid-cols-6 [&>*]:min-w-0">
          <Tile className="md:col-span-3" title="Attendance" text="A register that takes ten seconds. Late, absent and leave are one tap each." icon="attendance" tint="bg-[#E8F7EE] text-[#157F3C]"><AttendanceToy /></Tile>
          <Tile className="md:col-span-3" title="Fees & receipts" text="Collect, issue a numbered receipt, see who is overdue by class." icon="fees" tint="bg-marigold-soft text-[#9A5B00]">
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-4 font-mono text-[12px]">
              <div className="flex justify-between text-ink-muted"><span>Receipt AA/26-27/0412</span><span>14 Nov</span></div>
              <div className="mt-3 space-y-1 text-ink-soft"><div className="flex justify-between"><span>Tuition, Term 2</span><span>₹10,800</span></div><div className="flex justify-between"><span>Transport</span><span>₹2,400</span></div><div className="flex justify-between text-pd-ok"><span>Sibling concession</span><span>−₹800</span></div></div>
              <div className="mt-3 flex justify-between border-t border-line pt-2 text-[13px] font-semibold text-ink"><span>Paid by UPI</span><span>₹12,400</span></div>
            </div>
          </Tile>
          <Tile className="md:col-span-2" title="Timetable" text="Clash-free weeks for every class and teacher." icon="timetable" tint="bg-[#E9F3FF] text-[#1F5FBF]"><TimetableMini /></Tile>
          <Tile className="md:col-span-2" title="Homework" text="Set it once, students see it on their phones." icon="homework" tint="bg-[#FFEDEE] text-[#B4232A]"><HomeworkMini /></Tile>
          <Tile className="md:col-span-2" title="Exams & report cards" text="Marks in, grades and report cards out." icon="exams" tint="bg-[#F1ECFF] text-[#5B3FD6]">
            <div className="flex h-28 items-end gap-2">
              {[["A1", 34], ["A2", 52], ["B1", 70], ["B2", 46], ["C1", 24]].map(([g, h], k) => (
                <div key={g as string} className="flex h-full flex-1 flex-col items-center justify-end gap-1"><div className="w-full origin-bottom animate-[grow-y_.8s_cubic-bezier(.2,.8,.2,1)_both] rounded-lg bg-[#7C63F0]" style={{ height: `${h}%`, animationDelay: `${k * 60}ms` }} /><span className="text-[11px] font-medium text-ink-muted">{g}</span></div>
              ))}
            </div>
          </Tile>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 3. Roles: three phones */
function Phone({ who, role, children, className }: { who: string; role: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-[260px] shrink-0 rounded-[38px] bg-[#1B2522] p-2 shadow-[0_40px_80px_-30px_rgb(17_19_24/0.45)]", className)}>
      <div className="relative h-[500px] overflow-hidden rounded-[30px] bg-surface-2">
        <div className="mx-auto mt-2 h-5 w-20 rounded-full bg-[#1B2522]" />
        <div className="px-4 pt-4">
          <div className="flex items-center gap-2.5"><Avatar name={who} size="sm" /><div className="leading-tight"><p className="text-[13px] font-semibold text-ink">{who}</p><p className="text-[11px] text-ink-muted">{role}</p></div></div>
          {children}
        </div>
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-around rounded-2xl bg-surface py-2 shadow-card">
          {(["dashboard", "attendance", "spark", "homework", "profile"] as AppIconName[]).map((n) => n === "spark"
            ? <span key={n} className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-marigold"><AppIcon name="spark" weight="fill" className="h-4 w-4" /></span>
            : <AppIcon key={n} name={n} className="h-[18px] w-[18px] text-ink-muted" />)}
        </div>
      </div>
    </div>
  );
}

export function Roles() {
  return (
    <section id="roles" className="scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <div className="mx-auto max-w-[1200px] px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="mx-auto max-w-[640px] text-[36px] font-semibold leading-[1.05] tracking-[-0.045em] text-ink sm:text-[46px]">One school, three views.</h2>
          <p className="mx-auto mt-4 max-w-[520px] text-[16px] leading-relaxed text-ink-muted">Each person sees their own work. The server decides what an account can open, never the link.</p>
        </Reveal>
      </div>
      <Reveal className="scrollbar-none mt-14 flex snap-x gap-6 overflow-x-auto px-6 pb-6 md:justify-center md:overflow-visible">
        <Phone who="Aanya Jain" role="Principal" className="snap-center md:mt-10 md:-rotate-3">
          <p className="mt-5 text-[20px] font-semibold tracking-[-0.03em] text-ink">94.6% here today</p>
          <p className="text-[12px] text-ink-muted">3 registers still open</p>
          <div className="mt-4 space-y-2">{[["Fees collected", "₹1.42 Cr", "bg-mint"], ["Overdue", "₹4.28 L", "bg-marigold"], ["Leave requests", "2", "bg-cobalt"]].map(([l, v, c]) => <div key={l} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 shadow-card"><span className={cn("h-2 w-2 rounded-full", c)} /><span className="flex-1 text-left text-[12.5px] text-ink-soft">{l}</span><span className="figures text-[13px] font-semibold text-ink">{v}</span></div>)}</div>
        </Phone>
        <Phone who="Rahul Verma" role="Maths · Class teacher 10-A" className="snap-center">
          <div className="mt-5 rounded-2xl bg-brand-700 p-3.5 text-left text-white"><p className="text-[11px] text-white/60">Now · Period 3</p><p className="mt-1 text-[16px] font-semibold">Maths, 10-A</p><p className="text-[11.5px] text-white/60">Room 204 · ends 11:20</p><div className="mt-3 rounded-lg bg-white py-2 text-center text-[12.5px] font-medium text-ink">Mark attendance</div></div>
          <div className="mt-3 space-y-2">{[["9-A homework", "18 of 32 in"], ["Unit Test 2", "Marks due Friday"]].map(([a, b]) => <div key={a} className="rounded-xl bg-surface px-3 py-2.5 text-left shadow-card"><p className="text-[12.5px] font-medium text-ink">{a}</p><p className="text-[11.5px] text-ink-muted">{b}</p></div>)}</div>
        </Phone>
        <Phone who="Aarav Sharma" role="Class 10-A · Roll 1" className="snap-center md:mt-10 md:rotate-3">
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
            <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90"><circle cx="18" cy="18" r="15" fill="none" stroke="rgb(var(--line))" strokeWidth="4" /><circle cx="18" cy="18" r="15" fill="none" stroke="rgb(var(--c-mint))" strokeWidth="4" strokeDasharray="88 100" strokeLinecap="round" /></svg>
            <div className="text-left"><p className="text-[18px] font-semibold tracking-[-0.03em] text-ink">93%</p><p className="text-[11.5px] text-ink-muted">attendance, on track</p></div>
          </div>
          <div className="mt-3 space-y-2">{[["Science", "Due tomorrow", "bg-[#E8F7EE] text-[#157F3C]"], ["English essay", "Due Mon", "bg-[#FFF1E8] text-[#B4490B]"]].map(([a, b, t]) => <div key={a} className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 text-left shadow-card"><span className={cn("grid h-7 w-7 place-items-center rounded-lg", t)}><AppIcon name="homework" className="h-3.5 w-3.5" /></span><div><p className="text-[12.5px] font-medium text-ink">{a}</p><p className="text-[11.5px] text-ink-muted">{b}</p></div></div>)}</div>
        </Phone>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------ 4. Security as an audit log */
const LOG = [
  ["09:02:11", "ADMIN-001", "signed in", "auth", "text-cobalt-deep"],
  ["09:04:37", "TCH-00001", "marked attendance · 10-A · 31/34", "attendance", "text-pd-ok"],
  ["09:05:02", "STU-2026-00002", "tried to open /admin/fees · refused (role)", "denied", "text-plum"],
  ["09:11:48", "ADMIN-001", "issued receipt AA/26-27/0412 · ₹12,400", "fees", "text-[#9A5B00]"],
  ["09:15:20", "ADMIN-001", "reset password for TCH-00004", "accounts", "text-cobalt-deep"],
];

export function Security() {
  const { text } = useTyping(["audit --today --school aster"], { holdMs: 60_000 });
  return (
    <section id="security" className="scroll-mt-20 bg-brand-900 py-24 text-white sm:py-32">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.2fr] lg:items-center [&>*]:min-w-0">
        <Reveal>
          <h2 className="text-[36px] font-semibold leading-[1.05] tracking-[-0.045em] sm:text-[46px]">Strict where it matters.</h2>
          <p className="mt-4 max-w-[440px] text-[16px] leading-relaxed text-white/60">Hiding a button is not security. Atrium checks every request on the server.</p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              ["Roles checked on the server", "Every function re-checks who is asking."],
              ["Sessions in httpOnly cookies", "Tokens never sit in page scripts."],
              ["An audit log of every change", "Sign-ins, receipts, resets, exports."],
              ["Modules per school", "Turn off what your plan does not include."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-inset ring-white/10"><p className="flex items-center gap-2 text-[14px] font-medium"><Check className="h-4 w-4 text-marigold" />{t}</p><p className="mt-1 text-[13px] text-white/55">{d}</p></li>
            ))}
          </ul>
        </Reveal>
        <Reveal>
          <div className="overflow-hidden rounded-[22px] bg-[#08261F] ring-1 ring-white/10">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3"><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="ml-3 text-[12px] text-white/40">Audit log</span></div>
            <div className="overflow-x-auto p-5 font-mono text-[12.5px] leading-7">
              <p className="text-white/80"><span className="text-marigold">$</span> {text}<Caret /></p>
              {LOG.map(([t, who, what, cat, c], k) => (
                <p key={t} className="whitespace-nowrap opacity-0 animate-[rise-in_.4s_ease-out_both]" style={{ animationDelay: `${1.6 + k * 0.35}s` }}>
                  <span className="text-white/35">{t}</span> <span className="text-white/80">{who}</span> <span className="text-white/55">{what}</span> <span className={cn("rounded bg-white/90 px-1.5 text-[11px]", c)}>{cat}</span>
                </p>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[12px] text-white/40">Illustrative entries. The real log lives under Audit log for administrators.</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 5. Closing + footer */
export function Closing({ signedIn, home }: { signedIn: boolean; home: string }) {
  return (
    <section className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="relative overflow-hidden rounded-[32px] bg-marigold px-6 py-14 text-center sm:px-12 sm:py-20">
        <div aria-hidden className="float-y absolute left-8 top-8 hidden rounded-2xl bg-white p-2 shadow-lift md:block"><IconTile name="attendance" size="lg" live /></div>
        <div aria-hidden className="float-y absolute right-10 top-10 hidden rounded-2xl bg-white p-2 shadow-lift [animation-delay:-1.5s] md:block"><IconTile name="fees" size="lg" live /></div>
        <div aria-hidden className="float-y absolute bottom-8 left-[14%] hidden rounded-2xl bg-white p-2 shadow-lift [animation-delay:-3s] md:block"><IconTile name="exams" size="lg" live /></div>
        <div aria-hidden className="float-y absolute bottom-10 right-[16%] hidden rounded-2xl bg-white p-2 shadow-lift [animation-delay:-2.2s] md:block"><IconTile name="notices" size="lg" live /></div>
        <h2 className="mx-auto max-w-[620px] text-[38px] font-semibold leading-[1.02] tracking-[-0.05em] text-ink sm:text-[56px]">Your school day, sorted by 9 a.m.</h2>
        <p className="mx-auto mt-4 max-w-[460px] text-[16px] text-ink/70">Sign in with the Login ID from your school office. Add Atrium to your home screen and it works like an app.</p>
        <Link href={signedIn ? home : "/login"} className="group mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 text-[15px] font-medium text-white shadow-button transition-colors hover:bg-brand-700">
          {signedIn ? "Open your dashboard" : "Sign in to your school"} <ArrowRight className="icon-nudge h-4 w-4" />
        </Link>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="overflow-hidden border-t border-line bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 pt-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3"><LogoMark size={28} /><p className="text-[13px] text-ink-muted">Atrium. The school, in one place.</p></div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink-muted">
          <span className="flex items-center gap-2"><span className="live-dot h-2 w-2 rounded-full bg-mint text-mint" /> All systems normal</span>
          <span>Local time <Clock /></span>
          <Link href="/login" className="hover:text-ink">Sign in</Link>
          <Link href="/verify/tc" className="hover:text-ink">Verify a certificate</Link>
        </div>
      </div>
      <p aria-hidden className="mx-auto -mb-[0.22em] mt-6 max-w-[1200px] select-none px-3 text-center text-[clamp(96px,22vw,300px)] font-semibold leading-none tracking-[-0.07em] text-transparent [-webkit-text-stroke:1.5px_rgb(var(--line-strong))]">Atrium</p>
    </footer>
  );
}
