import type { ID, Notice, NoticeAudience, NoticePriority, NoticeType } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { newId } from "@/lib/utils/ids";
import { todayISO } from "@/lib/utils/dates";
import { handle, invalid, notFound, requireActor, requirePermission } from "./core";
import { audienceLabel, noticeRecipients, noticeVisibleTo } from "./derive";
import { notify } from "./notify";

export interface NoticeInput {
  title: string;
  body: string;
  type: NoticeType;
  audience: NoticeAudience;
  publishDate: string;
  eventDate: string | null;
  priority: NoticePriority;
  status: "draft" | "published" | "archived";
}

export interface NoticeFilters {
  search?: string;
  type?: NoticeType | "all";
  priority?: NoticePriority | "all";
  audience?: Notice["audience"]["scope"] | "all";
  status?: Notice["status"] | "all";
  from?: string;
  to?: string;
}

function validate(input: NoticeInput) {
  const e: Record<string, string> = {};
  if (input.title.trim().length < 4) e.title = "Title is required";
  if (input.body.trim().length < 10) e.body = "Add a short description";
  if (!input.publishDate) e.publishDate = "Publish date is required";
  if ((input.type === "event" || input.type === "holiday") && !input.eventDate) e.eventDate = "Events and holidays need a date";
  if (input.audience.scope === "classes" && !input.audience.classIds?.length) e.audience = "Select at least one class";
  if (input.audience.scope === "sections" && !input.audience.sectionIds?.length) e.audience = "Select at least one section";
  if (Object.keys(e).length) throw invalid("Please fix the highlighted fields.", e);
}

const PRIORITY_RANK: Record<NoticePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const mockNoticeService = {
  /** Lists notices the actor may see (admins: all, incl. drafts). */
  async list(filters: NoticeFilters = {}) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "notices:read");
      const db = readDb();
      const today = todayISO();
      const q = filters.search?.trim().toLowerCase();
      return db.notices
        .filter((n) => noticeVisibleTo(db, n, actor))
        .filter((n) => actor.role === "admin" || n.publishDate <= today)
        .filter((n) => !filters.type || filters.type === "all" || n.type === filters.type)
        .filter((n) => !filters.priority || filters.priority === "all" || n.priority === filters.priority)
        .filter((n) => !filters.audience || filters.audience === "all" || n.audience.scope === filters.audience)
        .filter((n) => !filters.status || filters.status === "all" || n.status === filters.status)
        .filter((n) => !filters.from || (n.eventDate ?? n.publishDate) >= filters.from)
        .filter((n) => !filters.to || (n.eventDate ?? n.publishDate) <= filters.to)
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
        .sort((a, b) => b.publishDate.localeCompare(a.publishDate) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
        .map((n) => ({ ...n, audienceLabel: audienceLabel(db, n), author: db.users.find((u) => u.id === n.createdBy)?.displayName ?? "School office", isUpcoming: !!n.eventDate && n.eventDate >= today }));
    });
  },

  async create(input: NoticeInput) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "notices:manage");
      validate(input);
      return writeDb((db) => {
        const notice: Notice = { id: newId("nt"), ...input, title: input.title.trim(), body: input.body.trim(), createdBy: actor.id };
        db.notices.push(notice);
        let reached = 0;
        if (notice.status === "published" && notice.publishDate <= todayISO()) {
          const recipients = noticeRecipients(db, notice);
          reached = recipients.length;
          for (const u of recipients) {
            notify(db, [u.id], { category: "notice", title: notice.title, message: notice.body.slice(0, 90), href: `/${u.role}/notices` });
          }
        }
        return { id: notice.id, reached };
      });
    });
  },

  async update(noticeId: ID, input: NoticeInput) {
    return handle(() => {
      requirePermission(requireActor(), "notices:manage");
      const editable: NoticeInput = {
        title: input.title,
        body: input.body,
        type: input.type,
        audience: input.audience,
        publishDate: input.publishDate,
        eventDate: input.eventDate,
        priority: input.priority,
        status: input.status,
      };
      validate(editable);
      return writeDb((db) => {
        const n = db.notices.find((x) => x.id === noticeId);
        if (!n) throw notFound("Notice");
        const prevStatus = n.status;
        n.title = editable.title.trim();
        n.body = editable.body.trim();
        n.type = editable.type;
        n.audience = editable.audience;
        n.publishDate = editable.publishDate;
        n.eventDate = editable.eventDate;
        n.priority = editable.priority;
        n.status = editable.status;
        // Only send notifications when transitioning a draft to published (not when restoring an archived notice)
        if (prevStatus === "draft" && n.status === "published" && n.publishDate <= todayISO()) {
          for (const u of noticeRecipients(db, n)) {
            notify(db, [u.id], { category: "notice", title: n.title, message: n.body.slice(0, 90), href: `/${u.role}/notices` });
          }
        }
        return { id: noticeId };
      });
    });
  },

  async archive(noticeId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "notices:manage");
      return writeDb((db) => {
        const n = db.notices.find((x) => x.id === noticeId);
        if (!n) throw notFound("Notice");
        n.status = "archived";
        return { ok: true };
      });
    });
  },

  async restore(noticeId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "notices:manage");
      return writeDb((db) => {
        const n = db.notices.find((x) => x.id === noticeId);
        if (!n) throw notFound("Notice");
        if (n.status !== "archived") throw invalid("Only archived notices can be restored.");
        // Same rule as the live backend: a restored notice goes back to draft and must be published again.
        n.status = "draft";
        return { ok: true, status: "draft" as const };
      });
    });
  },

  async remove(noticeId: ID) {
    return handle(() => {
      requirePermission(requireActor(), "notices:manage");
      return writeDb((db) => {
        db.notices = db.notices.filter((n) => n.id !== noticeId);
        return { ok: true };
      });
    });
  },

  /** How many accounts would receive this audience (shown while composing). */
  async previewReach(audience: NoticeAudience) {
    return handle(() => {
      requirePermission(requireActor(), "notices:manage");
      const db = readDb();
      const fake: Notice = { id: "preview", title: "", body: "", type: "notice", audience, publishDate: todayISO(), eventDate: null, priority: "normal", status: "published", createdBy: "" };
      const r = noticeRecipients(db, fake);
      return { teachers: r.filter((u) => u.role === "teacher").length, studentAccounts: r.filter((u) => u.role === "student").length };
    });
  },
};

export type NoticeService = typeof mockNoticeService;
