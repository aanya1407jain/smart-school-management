/**
 * Id contract. Convex `Id<"table">` / `GenericId<"table">` is already a branded
 * type and is the cross-module id contract; no second brand is introduced.
 *
 * `parseIdParam` replaces unchecked `value as Id<…>` casts at untrusted
 * boundaries (URL params, form values, query strings). It only checks the
 * shape — Convex ids are opaque — and the server still validates every id with
 * `v.id(table)` and `getInSchool` (tenancy). It never widens access.
 */
import type { GenericId } from "convex/values";

/** Convex document ids are short opaque strings of lowercase letters and digits. */
const ID_SHAPE = /^[a-z0-9]{16,64}$/;

export function parseIdParam<T extends string>(_table: T, value: unknown): GenericId<T> | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return ID_SHAPE.test(v) ? (v as GenericId<T>) : null;
}
