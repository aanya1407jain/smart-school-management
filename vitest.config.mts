import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for Convex functions run in-process with `convex-test`
// (edge-runtime mirrors the Convex function runtime).
export default defineConfig({
  // Same path aliases as tsconfig.json, so pure frontend helpers (navigation,
  // live identity) can be unit-tested next to the backend.
  resolve: {
    alias: {
      "@convex": fileURLToPath(new URL("./convex", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/convex/**/*.test.ts"],
    environment: "edge-runtime",
    testTimeout: 20000,
    server: { deps: { inline: ["convex-test"] } },
  },
});
