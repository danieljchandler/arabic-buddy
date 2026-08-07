import { test as base, expect, type Page } from "@playwright/test";
import type { MemoryDb } from "../../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../../src/test/support/server/handler";
import {
  isSignedIn,
  seedPersona,
  type Persona,
  type PersonaOptions,
} from "../../src/test/support/personas";
import {
  installSupabaseRoutes,
  seedSession,
} from "../../src/test/support/transports/playwright";
import { TEST_USER_ID } from "../../src/test/support/server/session";

/**
 * The fixture new specs build on.
 *
 * Three protections are auto-applied whether or not a spec asks for them,
 * because the failures they catch are the ones that otherwise go unnoticed:
 *
 *  1. **Foreign hosts are blocked.** vite.config.ts falls back to the real
 *     production Supabase project when its env vars are unset, so a bad build
 *     or a stale variable sends the whole suite at live data while still going
 *     green. Config assertions cannot see that; a request interceptor can. It
 *     also blocks analytics, YouTube and font CDNs, which otherwise make specs
 *     slow and flaky rather than wrong.
 *  2. **console.error fails the test.** Across a hundred routes this is the
 *     cheapest crash detector available.
 *  3. **Teardown asserts the backend was actually exercised** — no unstubbed
 *     edge functions, no queries the double silently could not answer.
 */

/**
 * Console errors that say nothing about the app.
 *
 * These are all *network*-level: a subresource the request guard aborted on
 * purpose (fonts, analytics, video embeds) or Vite's HMR client failing to open
 * its socket against the test server. Chromium logs them without a URL, so they
 * cannot be attributed precisely — and they do not need to be, because network
 * behaviour has its own, exact guard in `blockedRequests` above.
 *
 * Scoping this check to app-level errors is what keeps it worth having. A crash
 * detector that fires on every page is one that gets switched off.
 */
const IGNORED_CONSOLE_ERRORS: RegExp[] = [
  /Failed to load resource/i,
  /WebSocket connection to .* failed/i,
  /\[vite\] failed to connect/i,
  /net::ERR_(BLOCKED_BY_CLIENT|CONNECTION_REFUSED|FAILED)/i,
];

export interface Fixtures {
  backend: SupabaseBackend;
  db: MemoryDb;
  /** Sign in as a persona and seed its profile, roles and subscription tier. */
  signInAs: (persona: Persona, options?: PersonaOptions) => Promise<void>;
  /** Console errors the page emitted. Assert on it, or let teardown do it. */
  consoleErrors: string[];
  /** Opt out of the console-error assertion for a spec that expects one. */
  allowConsoleErrors: () => void;
}

export const test = base.extend<Fixtures>({
  backend: async ({ page }, use) => {
    const { backend, blockedRequests } = await installSupabaseRoutes(page);

    await use(backend);

    // Run after the spec, so a failure here always follows the real assertions
    // and never masks them.
    if (blockedRequests.length > 0) {
      throw new Error(
        `The page tried to reach hosts outside the test environment:\n` +
          [...new Set(blockedRequests)].map((url) => `  - ${url}`).join("\n") +
          `\n\nIf this is production Supabase, the env override has broken — see ` +
          `e2e/support/globalSetup.ts. If it is a third party, stub it in the spec.`,
      );
    }

    backend.assertNoUnstubbedCalls();
    backend.assertNoUnsupportedQueries();
  },

  db: async ({ backend }, use) => {
    await use(backend.db);
  },

  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];

    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) return;
      errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await use(errors);
  },

  allowConsoleErrors: async ({ consoleErrors }, use, testInfo) => {
    let allowed = false;
    await use(() => {
      allowed = true;
    });

    if (!allowed && consoleErrors.length > 0 && testInfo.status === testInfo.expectedStatus) {
      throw new Error(
        `The page logged errors:\n` +
          consoleErrors.map((line) => `  - ${line}`).join("\n") +
          `\n\nIf the spec expects them, call allowConsoleErrors().`,
      );
    }
  },

  signInAs: async ({ page, backend }, use) => {
    await use(async (persona, options = {}) => {
      const userId = seedPersona(backend, persona, options);
      if (isSignedIn(persona)) await seedSession(page, userId ?? TEST_USER_ID);
    });
  },
});

/**
 * Ensure the auto-fixtures run even when a spec names none of them.
 *
 * Playwright only instantiates fixtures a test actually depends on, so without
 * this the guards would silently not apply to the specs that need them most —
 * the short ones.
 */
test.beforeEach(async ({ backend, allowConsoleErrors }) => {
  void backend;
  void allowConsoleErrors;
});

export { expect };
export type { Page, Persona };
