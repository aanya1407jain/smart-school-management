/**
 * Domain identity for the (temporary) mock domain services.
 *
 * Authentication is real: Convex Auth owns the session (httpOnly cookies set
 * by the Next.js proxy) and `users.session` derives the user's role, school and
 * linked students on the server. While the business modules still run on the
 * mock store, the session provider BINDS that server-derived identity here so
 * the mock services know who is calling.
 *
 * This module is memory-only by design: nothing is written to localStorage or
 * sessionStorage, there is no token, no password and no role the browser could
 * edit. Reloading the page re-derives the identity from the server.
 */
import type { ID, Role } from "@/types/domain";
import { STORAGE_NAMESPACE } from "@/lib/constants/product";

export interface DomainIdentity {
  /** Mock user record the server identity was matched to (by login email). */
  userId: ID;
  /** Server-derived (users.session): these override whatever the mock record says. */
  role: Role;
  permissionSets: readonly string[];
  email: string;
  displayName: string;
  /** Mock student ids, derived ONLY from the server's linked-student list. */
  studentIds: ID[];
  /** Student-portal accounts linked to several students (guardians): the one being viewed. */
  activeStudentId: ID | null;
}

const listeners = new Set<() => void>();
let current: DomainIdentity | null = null;

const emit = () => listeners.forEach((l) => l());

export function readSession(): DomainIdentity | null {
  return current;
}

/** Called by the session provider after `users.session` resolves (or with null on sign-out). */
export function setDomainIdentity(next: DomainIdentity | null) {
  current = next;
  emit();
}

export function updateSession(patch: Partial<Pick<DomainIdentity, "activeStudentId">>) {
  if (!current) return;
  current = { ...current, ...patch };
  emit();
}

export function clearSession() {
  setDomainIdentity(null);
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Stage 1 kept a mock session (user id, role, expiry) in Web Storage under
 * this key. Remove any leftover copy so no stale client-side "session" remains.
 */
const LEGACY_SESSION_KEY = `${STORAGE_NAMESPACE}-session`;
export function purgeLegacySessionStorage() {
  if (typeof window === "undefined") return;
  for (const get of [() => window.localStorage, () => window.sessionStorage]) {
    try { get().removeItem(LEGACY_SESSION_KEY); } catch { /* storage unavailable */ }
  }
}
