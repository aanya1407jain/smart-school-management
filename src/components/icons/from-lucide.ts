/**
 * Maps the lucide icons that pages already pass to CardHeader / StatCard onto
 * Atrium's live module icons, so every existing card picks up the coloured,
 * animated glyph without touching each page.
 */
import { isValidElement, type ReactNode } from "react";
import {
  Award, BarChart3, Bell, BookOpenCheck, CalendarCheck2, CalendarClock, CircleDollarSign, ClipboardList, GraduationCap,
  KeyRound, Megaphone, MessageSquarePlus, Presentation, Receipt, School, ScrollText, Settings, UserRound, Users, Wallet,
} from "lucide-react";
import type { AppIconName } from "./app-icon";

const MAP = new Map<unknown, AppIconName>([
  [CalendarCheck2, "attendance"], [CalendarClock, "timetable"], [ClipboardList, "homework"], [BookOpenCheck, "exams"],
  [Presentation, "classes"], [Megaphone, "notices"], [Award, "results"], [Wallet, "fees"], [CircleDollarSign, "fees"],
  [Receipt, "fees"], [Users, "teachers"], [GraduationCap, "students"], [BarChart3, "reports"], [Bell, "notifications"],
  [Settings, "settings"], [School, "academics"], [KeyRound, "accounts"], [ScrollText, "audit"], [MessageSquarePlus, "remarks"],
  [UserRound, "profile"],
]);

export function liveIconFor(node: ReactNode): AppIconName | null {
  return isValidElement(node) ? MAP.get(node.type) ?? null : null;
}
