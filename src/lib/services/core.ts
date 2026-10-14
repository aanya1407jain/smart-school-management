/**
 * Shared plumbing for the mock service layer.
 *
 * Each service function behaves like a backend endpoint / Convex function:
 *   1. resolve the caller (`requireActor`)
 *   2. check permissions and data scope
 *   3. read or write the store
 *   4. return plain serialisable data
 *
 * When the backend is connected, the same checks move server-side and the
 * UI keeps calling the same service interface.
 */
import type { Database, ID, UserAccount } from "@/types/domain";
import { hasAnyPermission, hasPermission, type Permission } from "@/lib/permissions";
import { readDb } from "@/lib/store/db";
import { readSession } from "./session-store";

export type ServiceErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT";

export class ServiceError extends Error {
  constructor(public code: ServiceErrorCode, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ServiceError";
  }
}

export const forbidden = (msg = "You do not have permission to access this resource.") => new ServiceError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new ServiceError("NOT_FOUND", `${what} not found.`);
export const invalid = (msg: string, fieldErrors?: Record<string, string>) => new ServiceError("VALIDATION", msg, fieldErrors);

/** Simulated network latency so loading states are exercised. */
const LATENCY = { min: 120, max: 320 };
export function latency(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const ms = LATENCY.min + Math.random() * (LATENCY.max - LATENCY.min);
  return new Promise((r) => setTimeout(r, ms));
}

/** Wraps a handler with latency + structured cloning (no shared references leak to the UI). */
export async function handle<T>(fn: () => T): Promise<T> {
  await latency();
  const result = fn();
  return result === undefined ? result : (structuredClone(result) as T);
}

/**
 * The caller for the mock services: the demo-data record bound to the
 * server-derived identity (see session-store.ts). Role, permission sets and
 * linked students come from the server identity, never from the mock record.
 */
export function getActor(): UserAccount | null {
  const identity = readSession();
  if (!identity) return null;
  const record = readDb().users.find((u) => u.id === identity.userId);
  if (!record) return null;
  return {
    ...record,
    role: identity.role,
    permissionSets: [...identity.permissionSets] as UserAccount["permissionSets"],
    email: identity.email,
    displayName: identity.displayName,
    studentIds: identity.role === "student" ? [...identity.studentIds] : record.studentIds,
  };
}

export function requireActor(): UserAccount {
  const actor = getActor();
  if (!actor) throw new ServiceError("UNAUTHENTICATED", "Your session has ended. Please sign in again.");
  return actor;
}

export function requirePermission(actor: UserAccount, permission: Permission) {
  if (!hasPermission(actor, permission)) throw forbidden();
}

export function requireAny(actor: UserAccount, permissions: Permission[]) {
  if (!hasAnyPermission(actor, permissions)) throw forbidden();
}

// ------------------------------------------------------------------ Data scope

export interface Scope {
  all: boolean;
  sectionIds: Set<ID>;
  studentIds: Set<ID>;
  /** teacher only: "sectionId|subjectId" pairs the teacher teaches */
  subjectPairs: Set<string>;
  teacherId: ID | null;
}

/** Which records the actor may see. Mirrors future server-side row-level rules. */
export function scopeFor(actor: UserAccount, db: Database = readDb()): Scope {
  if (actor.role === "admin") {
    return { all: true, sectionIds: new Set(db.sections.map((s) => s.id)), studentIds: new Set(db.students.map((s) => s.id)), subjectPairs: new Set(), teacherId: null };
  }
  if (actor.role === "teacher" && actor.teacherId) {
    const yearId = db.school.currentAcademicYearId;
    const assignments = db.teacherAssignments.filter((a) => a.teacherId === actor.teacherId && a.academicYearId === yearId);
    const sectionIds = new Set(assignments.map((a) => a.sectionId));
    db.sections.filter((s) => s.classTeacherId === actor.teacherId).forEach((s) => sectionIds.add(s.id));
    const studentIds = new Set(
      db.enrollments.filter((e) => e.academicYearId === yearId && e.status === "active" && sectionIds.has(e.sectionId)).map((e) => e.studentId),
    );
    return { all: false, sectionIds, studentIds, subjectPairs: new Set(assignments.map((a) => `${a.sectionId}|${a.subjectId}`)), teacherId: actor.teacherId };
  }
  const studentIds = new Set(actor.studentIds ?? []);
  const yearId = db.school.currentAcademicYearId;
  const sectionIds = new Set(db.enrollments.filter((e) => studentIds.has(e.studentId) && e.academicYearId === yearId).map((e) => e.sectionId));
  return { all: false, sectionIds, studentIds, subjectPairs: new Set(), teacherId: null };
}

export function assertStudentInScope(actor: UserAccount, studentId: ID) {
  const scope = scopeFor(actor);
  if (!scope.all && !scope.studentIds.has(studentId)) throw forbidden("You can only view records of students linked to your account.");
}

export function assertSectionInScope(actor: UserAccount, sectionId: ID) {
  const scope = scopeFor(actor);
  if (!scope.all && !scope.sectionIds.has(sectionId)) throw forbidden("This class is not assigned to you.");
}
