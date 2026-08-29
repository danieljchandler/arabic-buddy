import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every edge function holding the service role must also decide who is asking.
 *
 * This guards the failure that the August 2026 security review found eleven
 * instances of, in `docs/security-review-2026-08.md`. The shape is always the
 * same and always invisible from the outside: a function takes an id from the
 * request body, builds a service-role client — which bypasses RLS entirely —
 * and writes a row belonging to the catalogue rather than to the caller. It
 * compiles, its tests pass, CI is green, and any account can rewrite published
 * content.
 *
 * The reason it kept happening is that the two obvious gates look like
 * authorization and are not:
 *
 *   - `verify_jwt = true` in config.toml only proves the bearer is a JWT signed
 *     by this project, and the publishable key is exactly that. It ships in the
 *     browser bundle. Anyone who views source passes it.
 *   - `auth.getUser(token)` only proves someone completed a free signup.
 *
 * Neither is permission to overwrite a transcript. So the check here is for a
 * named authorization helper, not for the presence of auth at all — that
 * distinction is the whole point.
 *
 * Deliberately shallow, like `edgeFunctionCoverage` and the `*Coverage` guards
 * it sits beside: a helper's name appearing in the file is a claim that someone
 * decided who may call it. That decision is the thing that goes missing. Depth
 * is what review is for.
 */

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");

/**
 * Names that count as having made the decision.
 *
 * Three kinds: the shared role gate (`_shared/requireRole.ts`), the shared
 * spend/identity gate (`_shared/usageCap.ts`), and the older hand-rolled
 * equivalents that predate both and are correct on their own terms.
 */
const AUTHORIZATION_MARKERS = [
  // _shared/requireRole.ts
  "requireContentManager",
  "requireAdmin",
  "requireRole",
  "isServiceRoleCall",
  "hasSharedSecret",
  // _shared/usageCap.ts
  "enforceDailyCap",
  "enforceAnonymousDailyCap",
  "requireActiveSubscription",
  "isAdminUser",
  // hand-rolled, pre-dating the shared helpers
  "isContentManager",
  "REVIEWER_ROLES",
  "user_roles",
  "has_role",
  "is_admin",
];

/**
 * Functions that hold the service role and legitimately gate on identity alone,
 * with the reason.
 *
 * The test is "who may call this", and for these the answer really is "any
 * signed-in account, acting on itself". Every one of them was read during the
 * review. Anything added here needs a reason that would survive being read
 * aloud — and if the reason is "it authenticates the caller", that is not one:
 * authenticating is what these all do, and it is not what this guard is about.
 */
const IDENTITY_IS_THE_AUTHORIZATION = new Map<string, string>([
  [
    "create-checkout",
    "Creates a Stripe session for the caller's own subscription. Price ids are " +
      "server-side constants; nothing from the body reaches Stripe as money.",
  ],
  [
    "customer-portal",
    "Opens the Stripe billing portal for the caller's own customer record, " +
      "looked up by their authenticated email.",
  ],
  [
    "referral",
    "Reads and writes only the caller's own referral code and redemption. " +
      "Self-referral and old-account farming are both refused server-side.",
  ],
  [
    "native-feedback",
    "Every branch is scoped to the caller's own ledger, requests and Stripe " +
      "session; the spend itself is atomic in the database.",
  ],
  [
    "bible-passage",
    "Serves read-only passage content to any signed-in learner. The service " +
      "role is for the passage cache, and it writes nothing the caller names.",
  ],
]);

/** Every deployable function — underscore-prefixed dirs are shared code. */
function functionNames(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function sourceOf(name: string): string {
  const path = join(FUNCTIONS_DIR, name, "index.ts");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Functions that build a service-role client, so RLS is not protecting them. */
function serviceRoleFunctions(): string[] {
  return functionNames().filter((name) => sourceOf(name).includes("SUPABASE_SERVICE_ROLE_KEY"));
}

describe("service-role authorization", () => {
  it("has an authorization decision in every function holding the service role", () => {
    const ungated = serviceRoleFunctions()
      .filter((name) => !IDENTITY_IS_THE_AUTHORIZATION.has(name))
      .filter((name) => {
        const source = sourceOf(name);
        return !AUTHORIZATION_MARKERS.some((marker) => source.includes(marker));
      });

    expect(
      ungated,
      `These edge functions build a service-role client — which bypasses RLS — ` +
        `without naming any authorization helper.\n\n` +
        `Note that neither \`verify_jwt\` nor \`auth.getUser()\` is one: the ` +
        `publishable key is a valid project JWT and ships in the browser ` +
        `bundle, and a signed-in learner is not a content manager.\n\n` +
        `Gate it with requireContentManager / requireRole from ` +
        `_shared/requireRole.ts, or enforceDailyCap from _shared/usageCap.ts if ` +
        `the concern is spend rather than privilege. If the caller acting on ` +
        `their own rows really is the whole rule, add it to ` +
        `IDENTITY_IS_THE_AUTHORIZATION with a reason:\n  ${ungated.join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not carry exemptions for functions that no longer exist", () => {
    // An exemption outliving its function is a stale claim, and the next
    // function to take that name would inherit a pass it never earned.
    const present = new Set(functionNames());
    const orphaned = [...IDENTITY_IS_THE_AUTHORIZATION.keys()].filter((name) => !present.has(name));

    expect(orphaned, `Remove these stale exemptions:\n  ${orphaned.join("\n  ")}`).toEqual([]);
  });

  it("does not exempt a function that has since grown a real gate", () => {
    // The exemptions say "identity is the whole rule here". Once a function
    // gains a role check, that is no longer true and the exemption is
    // misleading about what protects it.
    const nowGated = [...IDENTITY_IS_THE_AUTHORIZATION.keys()].filter((name) => {
      const source = sourceOf(name);
      return ["requireContentManager", "requireAdmin", "requireRole", "isContentManager"].some(
        (marker) => source.includes(marker),
      );
    });

    expect(
      nowGated,
      `These are exempted as "identity is the authorization", but now carry a ` +
        `role gate. Drop the exemption:\n  ${nowGated.join("\n  ")}`,
    ).toEqual([]);
  });

  it("finds the functions it claims to be checking", () => {
    // A guard that silently checks nothing is worse than no guard. If the
    // layout moves or the marker changes, this fails rather than passing
    // vacuously.
    const withServiceRole = serviceRoleFunctions();
    expect(withServiceRole.length).toBeGreaterThan(20);
    expect(withServiceRole).toContain("process-approved-video");
    expect(withServiceRole).toContain("analyze-gulf-arabic");
  });
});
