import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
