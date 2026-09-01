import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `access-credentials` — the only way an ID-number login comes into existence.
 *
 * Everything this function does is a privilege its subject must not have:
 * creating an auth account, setting its password, and writing the `user_roles`
 * row that turns it into a reviewer. So the properties worth pinning are about
 * who may call it and what it refuses:
 *
 *   1. Admin only, and only the two outside-contributor roles. A credential
 *      minted by someone else and sent over a chat app is not how anyone should
 *      become an admin.
 *   2. The account's address is derived from the ID, not from anything in the
 *      request. That mapping is the whole login: if it drifts from the client's
 *      copy, the credential is dead on arrival and nobody can say why.
 *   3. A half-created credential is worse than none — an account whose password
 *      has already been sent but which holds no role signs in and sees nothing.
 *      A failure after the account exists rolls it back.
 *   4. Switching access off removes the role *and* bans the account. Either
 *      alone leaves the person half-staff.
 */

const ADMIN = "00000000-0000-4000-8000-000000000001";
const NEW_USER = "11111111-1111-4111-8111-111111111111";
const CREDENTIAL = "22222222-2222-4222-8222-222222222222";

interface Options {
  /** Role rows the gate sees for the caller. */
  callerRole?: string | null;
  /** Fail the `user_roles` insert, to exercise the rollback. */
  failRoleInsert?: boolean;
  extra?: Record<string, UpstreamHandler>;
}

function upstreams({ callerRole = "admin", failRoleInsert = false, extra = {} }: Options = {}) {
  return {
    "/auth/v1/user": () => json({ id: ADMIN, aud: "authenticated", role: "authenticated" }),
    "/auth/v1/admin/users": (request: Request) =>
      request.method === "POST"
        ? json({ id: NEW_USER, email: "unused@example.com" })
        : json({ id: NEW_USER }),
    "/rest/v1/user_roles": (request: Request) => {
      if (request.method === "GET") return json(callerRole ? [{ role: callerRole }] : []);
      if (failRoleInsert) {
        return json({ message: "insert or update violates foreign key constraint" }, 409);
      }
      return new Response(null, { status: 204 });
    },
    "/rest/v1/access_credentials": (request: Request) => {
      if (request.method === "POST") {
        return json({ id: CREDENTIAL, user_id: NEW_USER, access_id: "40318825" }, 201);
      }
      if (request.method === "GET") {
        return json({ id: CREDENTIAL, user_id: NEW_USER, access_id: "40318825", role: "transcriber" });
      }
      return new Response(null, { status: 204 });
    },
    ...extra,
  };
}

function load(options?: Options) {
  return loadFunction("access-credentials", { upstreams: upstreams(options) });
}

const request = (body: unknown) =>
  jsonRequest("access-credentials", body, { jwt: "admin-session-token" });

Deno.test("refuses a caller who is not an admin", async () => {
  const fn = await load({ callerRole: null });
  try {
    const response = await fn.handler(request({ action: "create", role: "transcriber" }));
    assertEquals(response.status, 403);
    // Nothing was minted on the way to being refused.
    assertEquals(fn.callsTo("/auth/v1/admin/users").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("refuses a caller with no token at all", async () => {
  const fn = await load();
  try {
    const response = await fn.handler(
      jsonRequest("access-credentials", { action: "create", role: "transcriber" }, { jwt: null }),
    );
    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});

Deno.test("refuses a role that may not be an ID login", async () => {
  const fn = await load();
  try {
    for (const role of ["admin", "complimentary", "", "not_a_role"]) {
      const response = await fn.handler(request({ action: "create", role }));
      assertEquals(response.status, 400, `role ${role} should be refused`);
    }
    assertEquals(fn.callsTo("/auth/v1/admin/users").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("refuses an unknown action", async () => {
  const fn = await load();
  try {
    const response = await fn.handler(request({ action: "delete_everything" }));
    assertEquals(response.status, 400);
  } finally {
    fn.restore();
  }
});

Deno.test("mints an ID, a password and the role in one go", async () => {
  const fn = await load();
  try {
    const response = await fn.handler(
      request({ action: "create", role: "transcriber", label: "Ahmed — Yemeni reviewer" }),
    );
    assertEquals(response.status, 200);
    const body = await response.json();

    assert(/^[1-9][0-9]{7}$/.test(body.access_id), `not an ID number: ${body.access_id}`);
    assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(body.password), `not a password: ${body.password}`);

    // The address is derived from the ID and from nothing else — this is the
    // mapping the sign-in page reproduces, so a drift here is a dead credential.
    const [created] = fn.callsTo("/auth/v1/admin/users");
    const sent = JSON.parse(created.body ?? "{}");
    assertEquals(sent.email, `${body.access_id}@ids.hakiya.app`);
    assertEquals(sent.password, body.password);
    // No inbox exists to confirm from, so an unconfirmed account is an unusable
    // one rather than a safer one.
    assertEquals(sent.email_confirm, true);

    const [role] = fn.callsTo("/rest/v1/user_roles").filter((call) => call.method === "POST");
    assertEquals(JSON.parse(role.body ?? "{}").role, "transcriber");

    // The registry records who it is and never the password.
    const [stored] = fn.callsTo("/rest/v1/access_credentials").filter((c) => c.method === "POST");
    const row = JSON.parse(stored.body ?? "{}");
    assertEquals(row.label, "Ahmed — Yemeni reviewer");
    assertEquals(row.created_by, ADMIN);
    assert(!JSON.stringify(row).includes(body.password), "the password was written to the registry");
  } finally {
    fn.restore();
  }
});

Deno.test("rolls the account back when the role grant fails", async () => {
  const fn = await load({ failRoleInsert: true });
  try {
    const response = await fn.handler(request({ action: "create", role: "transcriber" }));
    assertEquals(response.status, 500);

    // The alternative is an account whose password has already been read off
    // the screen, holding no role: it signs in, sees nothing, and reads to its
    // holder as the app being broken.
    const deletes = fn
      .callsTo("/auth/v1/admin/users")
      .filter((call) => call.method === "DELETE");
    assertEquals(deletes.length, 1);
    assert(deletes[0].url.includes(NEW_USER));
  } finally {
    fn.restore();
  }
});

Deno.test("resets a password without changing the ID", async () => {
  const fn = await load();
  try {
    const response = await fn.handler(
      request({ action: "reset_password", credential_id: CREDENTIAL }),
    );
    assertEquals(response.status, 200);
    const body = await response.json();

    // The ID is what the reviewer knows; a reset that moved it would be a new
    // credential, not a recovered one.
    assertEquals(body.access_id, "40318825");
    assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(body.password));

    const [updated] = fn
      .callsTo("/auth/v1/admin/users")
      .filter((call) => call.method === "PUT");
    assert(updated.url.includes(NEW_USER));
    assertEquals(JSON.parse(updated.body ?? "{}").password, body.password);

    const second = await fn.handler(request({ action: "reset_password", credential_id: CREDENTIAL }));
    assertNotEquals((await second.json()).password, body.password);
  } finally {
    fn.restore();
  }
});

Deno.test("reports a credential that does not exist rather than inventing one", async () => {
  const fn = await load({
    extra: { "/rest/v1/access_credentials": () => json(null) },
  });
  try {
    const response = await fn.handler(
      request({ action: "reset_password", credential_id: CREDENTIAL }),
    );
    assertEquals(response.status, 404);
  } finally {
    fn.restore();
  }
});

Deno.test("switching access off bans the account and removes the role", async () => {
  const fn = await load();
  try {
    const response = await fn.handler(
      request({ action: "set_disabled", credential_id: CREDENTIAL, disabled: true }),
    );
    assertEquals(response.status, 200);

    const [banned] = fn.callsTo("/auth/v1/admin/users").filter((call) => call.method === "PUT");
    assertEquals(JSON.parse(banned.body ?? "{}").ban_duration, "876000h");

    // Both halves. A ban alone leaves the person reading as a reviewer
    // everywhere the app counts roles; a role removal alone leaves an account
    // that can still sign in.
    const removals = fn
      .callsTo("/rest/v1/user_roles")
      .filter((call) => call.method === "DELETE");
    assertEquals(removals.length, 1);
    assert(removals[0].url.includes("transcriber"));
  } finally {
    fn.restore();
  }
});

Deno.test("switching access back on lifts the ban and restores the role", async () => {
  const fn = await load();
  try {
    const response = await fn.handler(
      request({ action: "set_disabled", credential_id: CREDENTIAL, disabled: false }),
    );
    assertEquals(response.status, 200);

    const [unbanned] = fn.callsTo("/auth/v1/admin/users").filter((call) => call.method === "PUT");
    assertEquals(JSON.parse(unbanned.body ?? "{}").ban_duration, "none");

    const restored = fn
      .callsTo("/rest/v1/user_roles")
      .filter((call) => call.method === "POST");
    assertEquals(restored.length, 1);
    assertEquals(JSON.parse(restored[0].body ?? "{}").role, "transcriber");
  } finally {
    fn.restore();
  }
});
