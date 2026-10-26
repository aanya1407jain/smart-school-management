/**
 * Permission catalogue invariants + a source guard that keeps every public
 * Convex function behind the auth/tenancy builders.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolvePermissions, ROLE_PERMISSIONS } from "../../convex/core/permissions";

describe("permission catalogue", () => {
  test("admin can view attendance but never mark or edit it", () => {
    const admin = ROLE_PERMISSIONS.admin;
    expect(admin.has("attendance:read:all")).toBe(true);
    expect(admin.has("attendance:mark:class_teacher")).toBe(false);
    expect(admin.has("attendance:edit:class_teacher")).toBe(false);
  });
  test("teachers hold class-teacher capabilities (ownership checked separately)", () => {
    expect(ROLE_PERMISSIONS.teacher.has("attendance:mark:class_teacher")).toBe(true);
    expect(ROLE_PERMISSIONS.teacher.has("attendance:read:all")).toBe(false);
  });
  test("students are own-scope only", () => {
    expect([...ROLE_PERMISSIONS.student].every((p) => p.endsWith(":own") || ["area:student", "homework:submit", "notices:read", "notifications:read"].includes(p))).toBe(true);
  });
  test("accountant set adds finance only", () => {
    const p = resolvePermissions("admin", ["accountant"]);
    expect(p.has("fees:manage")).toBe(true);
    expect(resolvePermissions("teacher", ["accountant"]).has("fees:manage")).toBe(true); // set semantics; invite guard restricts sets to admin memberships
    expect(resolvePermissions("student", ["unknown-set"]).has("fees:manage")).toBe(false);
  });
});

describe("source guard", () => {
  // Public functions defined with the raw builders bypass tenancy. Only these may.
  //  - users.ts:me / users.ts:session report "signed out" instead of throwing (session resolves the actor itself via requireActor)
  //  - account.ts:changePassword is an action (no db) that authenticates with getAuthUserId and Convex Auth's own credential check
  //  - tcVerification.ts:verifyTransferCertificate is the public QR check on a printed TC (random code; certificate facts only)
  const ALLOWED_RAW = new Set(["auth.ts", "users.ts:me", "users.ts:session", "account.ts:changePassword", "schools.ts:publicProfile", "tcVerification.ts:verifyTransferCertificate"]);
  const dir = join(__dirname, "../../convex");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !["schema.ts", "auth.config.ts", "http.ts"].includes(f));

  test.each(files)("%s defines public functions only via schoolQuery/schoolMutation/userQuery/userMutation/schoolAction", (file) => {
    if (ALLOWED_RAW.has(file)) return;
    const src = readFileSync(join(dir, file), "utf8");
    const raw = [...src.matchAll(/export const (\w+) = (query|mutation|action)\(/g)].map((m) => `${file}:${m[1]}`);
    expect(raw.filter((r) => !ALLOWED_RAW.has(r))).toEqual([]);
  });
});
