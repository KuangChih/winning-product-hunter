import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
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
