/**
 * The DEMO runtime port (D4: demo mode is internal-only).
 *
 * The in-browser demo layer (src/lib/services, mock-data, store and the
 * demo-only screens) is NOT part of customer builds. Core reaches it only
 * through this narrow, typed port, which the composition root
 * (src/modules/demo.generated.ts) fills in the internal full build and leaves
 * `null` in every customer export — where no session is ever "demo" and these
 * calls are never made.
 *
 * Only Core-owned data crosses the port (school, notices, notifications,
 * accounts). Module-specific demo screens are mounted by id through
 * `DemoSlot` (demo-slot.tsx), never imported by shipped code.
 */
import type { ComponentType } from "react";
import type { Viewer } from "@convex/users";
import { DEMO } from "@/modules/demo.generated";
import type {
  AcademicYear, AppNotification, ID, Notice, NoticeAudience, NoticePriority, NoticeType, NotificationCategory, Role, School, SchoolClass, SchoolSettings, UserAccount,
} from "@/types/core";

export type NoticeInput = {
  title: string; body: string; type: NoticeType; audience: NoticeAudience; publishDate: string; eventDate: string | null;
  priority: NoticePriority; status: "draft" | "published" | "archived";
};
export type NoticeFilters = {
  search?: string; type?: NoticeType | "all"; priority?: NoticePriority | "all"; audience?: NoticeAudience["scope"] | "all";
  status?: Notice["status"] | "all"; from?: string; to?: string;
};
export type NoticeView = Notice & { audienceLabel: string; author: string; isUpcoming: boolean };
export type SchoolInfoInput = Pick<School, "name" | "tagline" | "address" | "phone" | "email" | "website" | "affiliation" | "principalName">;
export type PublicSchoolProfile = { name: string; shortName: string; tagline: string; emailDomain: string };

/** Years, classes, sections (scoped to the user), subjects, teachers — for forms and filters. */
export type AcademicOptions = {
  years: AcademicYear[];
  currentYearId: ID;
  classes: SchoolClass[];
  sections: { id: ID; classId: ID; name: string; label: string; grade: number; room: string }[];
  subjects: { id: ID; name: string; code: string; type: "core" | "language" | "elective" }[];
  /** Bell schedule (demo only; live screens load their own). */
  periods: { index: number; label: string; startTime: string; endTime: string; isBreak?: boolean }[];
  teachers: { id: ID; name: string; specializationIds: ID[] }[];
};

export type DemoPersona = { label: string; loginId: string; password: string; role: Role; roleLabel: string };

export interface DemoRuntime {
  /** Development demo logins shown on the sign-in screen. */
  personas: readonly DemoPersona[];
  auth: {
    /** Match the signed-in server identity to its demo persona (by Login ID). */
    bindIdentity(viewer: Viewer): { ok: true; user: UserAccount } | { ok: false };
    clearIdentity(): void;
    getSessionSnapshot(): { activeStudentId: string | null; user: UserAccount | null };
  };
  /** Any change of demo data or demo identity. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Remove browser storage written by earlier demo versions. */
  purgeLegacyStorage(): void;
  notifications: {
    list(filters?: { category?: NotificationCategory | "all"; unreadOnly?: boolean }): Promise<AppNotification[]>;
    unreadCount(): Promise<number>;
    markRead(id: ID): Promise<unknown>;
    markAllRead(): Promise<{ count: number }>;
    remove(id: ID): Promise<unknown>;
  };
  notices: {
    list(filters?: NoticeFilters): Promise<NoticeView[]>;
    create(input: NoticeInput): Promise<{ id: ID; reached: number }>;
    update(noticeId: ID, input: NoticeInput): Promise<unknown>;
    archive(noticeId: ID): Promise<unknown>;
    restore(noticeId: ID): Promise<unknown>;
    remove(noticeId: ID): Promise<unknown>;
    previewReach(audience: NoticeAudience): Promise<{ teachers: number; studentAccounts: number }>;
  };
  school: {
    getPublicProfile(): Promise<PublicSchoolProfile>;
    getSchool(): Promise<{ school: School; currentYear: AcademicYear }>;
    updateInfo(input: SchoolInfoInput): Promise<unknown>;
    updateSettings(settings: SchoolSettings): Promise<unknown>;
    resetDemoData(): Promise<unknown>;
    getAcademicOptions(): Promise<AcademicOptions>;
  };
  /**
   * Demo datasets for screens whose live data comes from Convex (dashboards,
   * reports). Untyped on purpose: the demo layer is internal and shapes it to
   * the screen's view model; customer builds never call it.
   */
  data(key: string, args?: unknown): Promise<unknown>;
  /**
   * Call a demo service method by "service.method" — the demo branches of
   * module screens that also serve live data (internal builds only). Untyped
   * on purpose: module screens must not import the demo layer's types.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call(path: string, ...args: unknown[]): Promise<any>;
  /** Demo-only screens, mounted by id (see DemoSlot). */
  slots: Readonly<Record<string, ComponentType<Record<string, unknown>>>>;
}

/** The demo runtime, or null in builds without the demo layer (every customer export). */
export function demoRuntime(): DemoRuntime | null {
  return DEMO;
}

/** A stable function calling a demo service method (see DemoRuntime.call), e.g. for useMutation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function demoCall(path: string): (...args: any[]) => Promise<any> {
  return (...args) => requireDemo().call(path, ...args);
}

/** For demo-only code paths (a "demo" session exists only when the runtime does). */
export function requireDemo(): DemoRuntime {
  if (!DEMO) throw new Error("Demo data is not part of this build.");
  return DEMO;
}
