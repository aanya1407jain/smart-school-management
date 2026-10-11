import type { ID, NotificationCategory } from "@/types/domain";
import { readDb, writeDb } from "@/lib/store/db";
import { forbidden, handle, requireActor, requirePermission } from "./core";

export const mockNotificationService = {
  async list(filters: { category?: NotificationCategory | "all"; unreadOnly?: boolean } = {}) {
    return handle(() => {
      const actor = requireActor();
      requirePermission(actor, "notifications:read");
      return readDb()
        .notifications.filter((n) => n.userId === actor.id)
        .filter((n) => !filters.category || filters.category === "all" || n.category === filters.category)
        .filter((n) => !filters.unreadOnly || !n.read)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  },

  async unreadCount() {
    return handle(() => {
      const actor = requireActor();
      return readDb().notifications.filter((n) => n.userId === actor.id && !n.read).length;
    });
  },

  async markRead(id: ID) {
    return handle(() => {
      const actor = requireActor();
      return writeDb((db) => {
        const n = db.notifications.find((x) => x.id === id);
        if (!n || n.userId !== actor.id) throw forbidden();
        n.read = true;
        return { ok: true };
      });
    });
  },

  async markAllRead() {
    return handle(() => {
      const actor = requireActor();
      return writeDb((db) => {
        let count = 0;
        db.notifications.forEach((n) => {
          if (n.userId === actor.id && !n.read) { n.read = true; count += 1; }
        });
        return { count };
      });
    });
  },

  async remove(id: ID) {
    return handle(() => {
      const actor = requireActor();
      return writeDb((db) => {
        db.notifications = db.notifications.filter((n) => !(n.id === id && n.userId === actor.id));
        return { ok: true };
      });
    });
  },
};

export type NotificationService = typeof mockNotificationService;
