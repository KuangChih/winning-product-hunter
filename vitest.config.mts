import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Starting an in-memory PGlite per test can exceed 5s when many test files run in parallel.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
