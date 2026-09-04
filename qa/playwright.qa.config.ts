import { defineConfig, devices } from "@playwright/test";

/**
 * Live QA crawl config — deliberately NOT the hermetic e2e config.
 *
 * Serves the production bundle in `dist/` (built with the real Supabase
 * project baked in by vite.config.ts's fallbacks, exactly as a Lovable preview
 * is) and drives it against the live backend. Nothing here stubs Supabase.
 *
 *   npm run build
 *   npx playwright test -c qa/playwright.qa.config.ts
 *   node qa/report.mjs            # merges qa/output/routes/*.json into a report
 *
 * Optional env:
 *   QA_EMAIL / QA_PASSWORD   sign in as this learner before crawling (needs a
 *                            confirmed account; signup needs an invite code and
 *                            email confirmation, so it is not automatable here)
 *   QA_INVITE_CODE           with QA_EMAIL/QA_PASSWORD unset, attempt a real
 *                            signup through the /auth form using this code
 *   QA_ROUTES                comma-separated route paths to restrict the crawl
 *   QA_ALLOW_PAID=1          allow one TTS/ASR call in media.spec (default: flag
 *                            as "needs live API test" and skip)
 */
const PORT = 4173;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "./output/test-results",
  fullyParallel: true,
  workers: 3,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "output/playwright-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    video: "off",
    // Sandboxed containers route outbound HTTPS through an egress proxy that
    // Chromium does not pick up from the environment; hand it over explicitly
    // so the browser can reach supabase.co. No-op when no proxy is configured.
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--no-sandbox",
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
        permissions: ["microphone"],
      },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --host 127.0.0.1 --strictPort`,
    // A TCP check, not an HTTP one: an HTTP readiness probe can be routed
    // through the egress proxy in sandboxed containers and never come back.
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
