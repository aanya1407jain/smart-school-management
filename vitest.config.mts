import { defineConfig } from "vitest/config";

// Unit tests for Convex functions run in-process with `convex-test`
// (edge-runtime mirrors the Convex function runtime).
export default defineConfig({
  test: {
    include: ["tests/convex/**/*.test.ts"],
    environment: "edge-runtime",
    testTimeout: 20000,
    server: { deps: { inline: ["convex-test"] } },
  },
});
