/**
 * Mock persistence layer.
 *
 * A single in-memory `Database` object, persisted to localStorage so demo
 * changes survive a page refresh. Services read with `readDb()` and write with
 * `writeDb()`; every write notifies subscribers so queries re-run — the same
 * reactive model Convex provides, which keeps the later migration simple.
 *
 * Nothing in the UI layer should import this file directly.
 */
import type { Database } from "@/types/domain";
import { createSeedDatabase, DB_VERSION } from "@/lib/mock-data/seed";
import { STORAGE_NAMESPACE } from "@/lib/constants/product";

const STORAGE_KEY = `${STORAGE_NAMESPACE}-db`;
let db: Database | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function load(): Database {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Database;
        if (parsed.version === DB_VERSION) return parsed;
      }
    } catch {
      /* corrupted or unavailable storage — fall back to a fresh seed */
    }
  }
  return createSeedDatabase();
}

function persist() {
  if (typeof window === "undefined" || !db) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* storage full / blocked — the session keeps working in memory */
  }
}

export function readDb(): Database {
  if (!db) {
    db = load();
    persist();
  }
  return db;
}

/** Apply a mutation, persist, and notify subscribers. */
export function writeDb<T>(mutate: (d: Database) => T): T {
  const current = readDb();
  const result = mutate(current);
  revision += 1;
  persist();
  listeners.forEach((l) => l());
  return result;
}

export function subscribeDb(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRevision() {
  return revision;
}

/** Restore the original demo dataset. */
export function resetDb() {
  db = createSeedDatabase();
  revision += 1;
  persist();
  listeners.forEach((l) => l());
}

// Keep multiple open tabs in sync (e.g. admin in one tab, student in another).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      db = JSON.parse(e.newValue) as Database;
      revision += 1;
      listeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
  });
}
