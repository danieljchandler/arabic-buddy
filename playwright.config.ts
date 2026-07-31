import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

/**
 * E2E config. The suite stubs Supabase in the browser, so it needs no
 * credentials and no network — see e2e/support/supabase.ts.
 *
 * The dev server is pointed at a fake Supabase host via process.env. That's the
 * only lever available: vite.config.ts sets `envDir: ".vite-env"`, so root
 * `.env` files are ignored, and it injects the client vars through `define`
 * from process.env — falling back to the real production project when unset.
 * Without this override the suite would talk to production.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI, also emit the HTML report so a failed run uploads something
  // debuggable as an artifact — "line" alone writes nothing to disk.
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The sandbox/CI image ships browsers at PLAYWRIGHT_BROWSERS_PATH
        // rather than in node_modules, so let Playwright resolve them itself
        // and only drop the sandbox, which containers don't allow.
        launchOptions: { args: ["--no-sandbox"] },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: a server already running against the real project would
    // silently invalidate the stubs.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
    env: {
      // Fake host. supabase-js derives its localStorage session key from the
      // first hostname label, so "e2e" here == "sb-e2e-auth-token" in the stub.
      VITE_SUPABASE_URL: "https://e2e.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-anon-key-not-a-real-secret",
      VITE_SUPABASE_PROJECT_ID: "e2e",
    },
  },
});
