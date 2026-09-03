import { defineConfig, devices } from "@playwright/test";

/**
 * TestNexa scaffold E2E config.
 *
 * These are deliberately smoke-level tests proving the whole stack (nginx +
 * frontend + backend) wires together end to end — not feature tests. The
 * target stack (see docker-compose.yml, dev profile) must already be
 * running; this config does not start it.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:54593",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
