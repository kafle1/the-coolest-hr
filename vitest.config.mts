import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globals: true,
    pool: "threads",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});