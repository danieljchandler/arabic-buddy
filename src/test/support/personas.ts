import type { MemoryDb } from "./postgrest/store";
import {
  aProfile,
  aRole,
  aSubscriber,
  aUserXp,
  TEST_USER_ID,
} from "./factories";
import type { SupabaseBackend } from "./server/handler";

/**
 * Who the test is signed in as.
 *
 * Roles and tiers are the two axes that gate most of this app, and both were
 * previously untestable — role checks go through `has_role`, which the old
 * double answered `null` to, and tier checks go through the `check-subscription`
 * edge function, which it answered `{}` to. Every admin route and every premium
 * feature therefore had zero coverage.
 */
export type Persona =
  | "anonymous"
  | "free"
  | "standard"
  | "allin"
  | "admin"
  | "recorder"
  | "content_reviewer"
  | "bible_reader"
  | "beta_tester"
  | "transcriber";

export interface PersonaOptions {
  userId?: string;
  /** The account's email. Lives in auth.users, not on the profile row. */
  email?: string;
  /** Extra profile columns, e.g. `{ onboarding_completed: false }`. */
  profile?: Record<string, unknown>;
}

interface PersonaSpec {
  roles: string[];
  tier: "free" | "standard" | "allin";
  signedIn: boolean;
}

const SPECS: Record<Persona, PersonaSpec> = {
  anonymous: { roles: [], tier: "free", signedIn: false },
  free: { roles: [], tier: "free", signedIn: true },
  standard: { roles: [], tier: "standard", signedIn: true },
  allin: { roles: [], tier: "allin", signedIn: true },
  admin: { roles: ["admin"], tier: "allin", signedIn: true },
  recorder: { roles: ["recorder"], tier: "free", signedIn: true },
  content_reviewer: { roles: ["content_reviewer"], tier: "free", signedIn: true },
  bible_reader: { roles: ["bible_reader"], tier: "free", signedIn: true },
  beta_tester: { roles: ["beta_tester"], tier: "free", signedIn: true },
  // A native speaker checking the AI's Arabic. Free tier on purpose: reviewing
  // is not a paid feature, and the role must not smuggle in subscriber access.
  transcriber: { roles: ["transcriber"], tier: "free", signedIn: true },
};

export function isSignedIn(persona: Persona): boolean {
  return SPECS[persona].signedIn;
}

/**
 * Seed everything a persona needs: profile, roles, subscription state and the
 * `check-subscription` response the tier gate reads.
 */
export function seedPersona(
  backend: SupabaseBackend,
  persona: Persona,
  options: PersonaOptions = {},
): string | null {
  const spec = SPECS[persona];
  const userId = options.userId ?? TEST_USER_ID;

  if (!spec.signedIn) {
    backend.setUser(null);
    // The subscription hook still runs signed out; answer it honestly.
    backend.stubFunction("check-subscription", unsubscribedResponse());
    return null;
  }

  backend.setUser(userId);
  // The account itself, which lives in auth.users rather than profiles.
  backend.addUser(userId, options.email ?? "e2e@example.com");
  backend.db.seed("profiles", [aProfile({ user_id: userId, ...options.profile })]);
  backend.db.seed(
    "user_roles",
    spec.roles.map((role) => aRole(role, { user_id: userId })),
  );
  backend.db.seed("user_xp", [aUserXp({ user_id: userId })]);

  const subscribed = spec.tier !== "free";
  backend.db.seed(
    "subscribers",
    subscribed ? [aSubscriber({ user_id: userId, subscription_tier: spec.tier })] : [],
  );

  // useSubscription reads this rather than the table — the tier lives in Stripe,
  // not Postgres, so the function is the only source of truth the client has.
  backend.stubFunction(
    "check-subscription",
    subscribed
      ? {
          subscribed: true,
          // `tier`, not `subscription_tier`: that is the field
          // check-subscription actually returns and useSubscription actually
          // reads. Getting it wrong here made every persona look free-tier
          // while the tests still passed, because nothing in the app enforces
          // the tier yet.
          tier: spec.tier,
          product_id: `prod_fixture_${spec.tier}`,
          subscription_end: aSubscriber().subscription_end,
        }
      : unsubscribedResponse(),
  );

  return userId;
}

/** The shape check-subscription returns for someone with no active plan. */
function unsubscribedResponse() {
  return { subscribed: false, tier: null, product_id: null, subscription_end: null };
}
