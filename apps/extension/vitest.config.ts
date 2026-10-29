import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the crx plugin is not loaded in tests.
export default defineConfig({
  test: {
    environment: "node",
  },
});
