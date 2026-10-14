/**
 * Convex connection settings. The backend is optional at build time so the
 * Stage 1 UI (mock services) keeps working until each module migrates.
 *   NEXT_PUBLIC_CONVEX_URL set   → Convex client + Convex Auth are mounted.
 *   NEXT_PUBLIC_CONVEX_URL unset → app runs purely on the mock services.
 */
export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
export const isConvexConfigured = CONVEX_URL.length > 0;
