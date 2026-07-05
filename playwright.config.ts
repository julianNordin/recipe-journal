import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, run against a **production build** on port 3001.
 *
 * Not the dev server, and not port 3000. Dev-server output is not what ships:
 * it re-renders on every request, serves unminified bundles, and papers over
 * build-time errors that only appear in `next build`. A test suite whose whole
 * job is to prove what the server actually sends should be pointed at what the
 * server actually sends. 3001 keeps it clear of a dev server on 3000, so both
 * can be running.
 *
 * The suite needs Postgres up and seeded: `npm run db:up` first. The seed is
 * idempotent -- phase 05 has a test for that -- so re-running it before every
 * build is safe and keeps the fixtures honest.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The server-rendering spec belongs to the no-js project alone. Running
      // it with scripting on would pass without proving anything.
      testIgnore: /server-rendering\.spec\.ts/,
    },
    {
      /*
       * The same browser with scripting switched off.
       *
       * This is the project that can tell the difference between a page the
       * server rendered and a page React filled in after hydration. Anything
       * asserted here is in the HTML that came down the wire.
       */
      name: "no-js",
      use: { ...devices["Desktop Chrome"], javaScriptEnabled: false },
      testMatch: /server-rendering\.spec\.ts/,
    },
  ],

  webServer: {
    command: "npm run db:seed && npm run build && npx next start -p 3001",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
  },
});
