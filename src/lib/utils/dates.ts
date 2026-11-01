import type { ISODate } from "@/types/core";

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse an ISO date (yyyy-mm-dd) as a local date at midnight. */
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(s: ISODate): number {
  return parseISODate(s).getDay();
}

export function isSchoolDay(s: ISODate): boolean {
  const d = dayOfWeek(s);
  return d >= 1 && d <= 5;
}

export function previousSchoolDay(s: ISODate, inclusive = true): ISODate {
  let cur = inclusive ? s : addDays(s, -1);
  while (!isSchoolDay(cur)) cur = addDays(cur, -1);
  return cur;
}

export function nextSchoolDay(s: ISODate, inclusive = true): ISODate {
  let cur = inclusive ? s : addDays(s, 1);
  while (!isSchoolDay(cur)) cur = addDays(cur, 1);
  return cur;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

const fmtDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtShort = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const fmtLong = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("en-IN", { weekday: "short" });
const fmtTime = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

export const formatDate = (s: ISODate | string) => fmtDate.format(parseISODate(s));
export const formatShortDate = (s: ISODate | string) => fmtShort.format(parseISODate(s));
export const formatLongDate = (s: ISODate | string) => fmtLong.format(parseISODate(s));
export const formatWeekday = (s: ISODate | string) => fmtWeekday.format(parseISODate(s));
export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${fmtShort.format(d)}, ${fmtTime.format(d)}`;
};

/** "09:00" -> "9:00 AM" */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(m)} ${suffix}`;
}

export function relativeTime(iso: string, now = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86_400 * 7) return `${Math.floor(diff / 86_400)} d ago`;
  return formatShortDate(iso.slice(0, 10));
}

/** Human description of a due date relative to today. */
export function dueLabel(due: ISODate, today = todayISO()): string {
  const d = daysBetween(today, due);
  if (d < 0) return d === -1 ? "Overdue by 1 day" : `Overdue by ${-d} days`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
