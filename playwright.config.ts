import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Every worker's browser talks to one `next start` process, and the local PGlite database
  // runs inside it on the same thread as rendering. With the default (half the CPU cores, 10
  // here) that thread saturates: streamed pages and prefetches finish seconds late, the browser's
  // six connections fill up, and a click can sit on the loading skeleton past the 5 s expect
  // timeout. 10 workers were no faster than 4 (the server is the limit), so use 4. Production
  // differs: Neon queries are network I/O and each Vercel function has its own CPU.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    // Never reuse a running server: it would not have PIPELINE_DISABLED, and a test pressing
    // "start discovery" would send real requests and write to the demo database.
    reuseExistingServer: false,
    timeout: 180_000,
    // Never send real requests to Meta or Shopify from e2e (ADR-013 kill switch).
    env: { PIPELINE_DISABLED: "1" },
  },
});
