/**
 * Mock session token storage. With "remember me" the session lives in
 * localStorage (survives browser restarts); otherwise in sessionStorage
 * (cleared when the tab closes). A real provider will replace this with an
 * httpOnly cookie / auth SDK.
 */
import type { ID, Role } from "@/types/domain";
import { STORAGE_NAMESPACE } from "@/lib/constants/product";

export interface Session {
  token: string;
  userId: ID;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  /** For student-portal accounts linked to several students (guardians). */
  activeStudentId: ID | null;
}

const KEY = `${STORAGE_NAMESPACE}-session`;
const listeners = new Set<() => void>();
let cache: Session | null | undefined;

function storages(): Storage[] {
  if (typeof window === "undefined") return [];
  const out: Storage[] = [];
  try { out.push(window.sessionStorage); } catch { /* blocked */ }
  try { out.push(window.localStorage); } catch { /* blocked */ }
  return out;
}

export function readSession(): Session | null {
  if (cache !== undefined) return cache;
  for (const s of storages()) {
    try {
      const raw = s.getItem(KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Session;
      if (new Date(parsed.expiresAt).getTime() > Date.now()) {
        cache = parsed;
        return parsed;
      }
      s.removeItem(KEY);
    } catch { /* ignore */ }
  }
  cache = null;
  return null;
}

export function writeSession(session: Session, remember: boolean) {
  clearStored();
  const [sessionStore, localStore] = storages();
  try { (remember ? localStore : sessionStore)?.setItem(KEY, JSON.stringify(session)); } catch { /* ignore */ }
  cache = session;
  listeners.forEach((l) => l());
}

export function updateSession(patch: Partial<Session>) {
  const current = readSession();
  if (!current) return;
  const next = { ...current, ...patch };
  for (const s of storages()) {
    try { if (s.getItem(KEY)) s.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  cache = next;
  listeners.forEach((l) => l());
}

function clearStored() {
  for (const s of storages()) {
    try { s.removeItem(KEY); } catch { /* ignore */ }
  }
}

export function clearSession() {
  clearStored();
  cache = null;
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    cache = undefined;
    listeners.forEach((l) => l());
  });
}
