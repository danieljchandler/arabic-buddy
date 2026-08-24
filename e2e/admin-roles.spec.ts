import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { aProfile, aRole, TEST_USER_ID } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * /admin/bible-access — where roles are handed out and taken away.
 *
 * This page is the only way any managed role gets granted, and two of them are
 * consequential in different directions: `bible_reader` is the sole key to
 * material with no route guard in front of it, and `admin` hands over this page
 * itself. So the interesting assertions are not "does the form work" but "can
 * it grant something it should not, and does revoking really revoke".
 *
 * It never touches `auth.users` directly, because the client cannot: emails
 * live in a schema the anon key cannot read. Resolving an identifier, granting,
 * listing who holds what and listing who is merely invited all go through
 * security-definer RPCs, which is why the tests care about *which* RPC was
 * called with what, rather than about a table read.
 *
 * The address does not have to belong to anyone yet. An email with no account
 * becomes a row in `pending_role_grants` that a database trigger claims at
 * signup — a path the emulator models on the grant side but not the signup
 * side, so the tests here assert the invitation is stored, listed and
 * cancellable rather than that a later signup picks it up.
 */

const READER = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

const READER_ROLE_ROW = "22222222-0000-4000-8000-000000000000";

/** Register an account so the grant RPC can resolve it by email. */
function anAccount(backend: SupabaseBackend, id: string, email: string) {
  backend.addUser(id, email);
  backend.db.add("profiles", aProfile({ user_id: id, display_name: email.split("@")[0] }));
}

/**
 * Wait for the listing to have come back.
 *
 * Every one of these tests is signed in as an admin, and `admin` is now a
 * listed role, so the signed-in admin's own row is the one thing always
 * present — "No matching role assignments." no longer means "loaded and
 * empty" the way it did when admin rows were filtered out.
 */
async function listingLoaded(page: Page) {
  await expect(
    page.getByRole("cell", { name: "Admin (full access)", exact: true }).first(),
  ).toBeVisible();
}

/** The revoke button on a given row, by the name a screen reader would hear. */
function revokeButton(page: Page, role: string, who: string) {
  return page.getByRole("button", { name: `Revoke ${role} from ${who}` });
}

test.describe("who may open it", () => {
  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);

    await page.goto("/admin/bible-access");

    await expect(page.getByRole("heading", { name: "Role Access Management" })).toBeVisible();
  });

  test("turns a recorder away", async ({ page, signInAs }) => {
    await signInAs("recorder");

    await page.goto("/admin/bible-access");

    // The page's own `isAdmin` check is the backstop; the layout's allow-list
    // is the front door. Either way the grant form must not render.
    await expect(page.getByPlaceholder("User email or UUID")).toHaveCount(0);
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");

    await page.goto("/admin/bible-access");

    // Especially this one: a content reviewer who could reach this page could
    // grant themselves `bible_reader`, and the Bible pages' rule is admin OR
    // (bible_reader AND NOT content_reviewer) — they would then only need to
    // revoke their own reviewer role to be inside.
    await expect(page.getByPlaceholder("User email or UUID")).toHaveCount(0);
  });
});

test.describe("listing who holds what", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    anAccount(backend, READER, "layla@example.com");
    anAccount(backend, OTHER, "omar@example.com");
  });

  test("shows each holder with the email the RPC resolved", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));

    await page.goto("/admin/bible-access");

    // The email is the only human-readable handle an admin has — profiles has
    // no email column, so a page that could not resolve it would list UUIDs.
    await expect(page.getByText("layla@example.com")).toBeVisible();
    // Scoped to the table: "Bible reader" also appears in the page's own
    // description and in the role picker's current value.
    await expect(page.getByRole("cell", { name: "Bible reader", exact: true })).toBeVisible();
  });

  test("leaves out roles it does not manage", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));
    db.add("user_roles", aRole("recorder", { id: "22222222-0000-4000-8000-000000000009", user_id: OTHER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    // `recorder` is not grantable here, so showing it would offer a revoke
    // button for something this page cannot restore.
    await expect(page.getByText("omar@example.com")).toHaveCount(0);
  });

  test("narrows the list to one role", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));
    db.add("user_roles", aRole("content_reviewer", { id: "22222222-0000-4000-8000-000000000002", user_id: OTHER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.getByRole("combobox").last().click();
    await page.getByRole("option", { name: "Content reviewer" }).click();

    await expect(page.getByText("omar@example.com")).toBeVisible();
    await expect(page.getByText("layla@example.com")).toHaveCount(0);
  });

  test("dates each grant", async ({ page, db }) => {
    db.add(
      "user_roles",
      aRole("bible_reader", {
        id: READER_ROLE_ROW,
        user_id: READER,
        created_at: "2026-03-04T00:00:00.000Z",
      }),
    );

    await page.goto("/admin/bible-access");

    // Access granted long ago and forgotten is the thing an audit is looking
    // for, so the date has to be real rather than "Invalid Date".
    await expect(page.getByText("layla@example.com")).toBeVisible();
    await expect(page.getByText(/2026|3\/4\/2026|04\/03\/2026/).first()).toBeVisible();
  });

  test("says so when a filter matches nothing", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").last().click();
    await page.getByRole("option", { name: "Beta tester" }).click();

    // The empty state still has to exist — "nobody is a beta tester" and "the
    // list failed to load" are different things and must not look alike.
    await expect(page.getByText("No matching role assignments.")).toBeVisible();
  });

  test("reports a failed load rather than an empty list", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));
    // The RPC, not the table: `admin_list_managed_roles` is security-definer
    // and reads `user_roles` server-side, so the client never issues that read
    // and failing the table would leave the listing working.
    db.failRpc("admin_list_managed_roles");

    await page.goto("/admin/bible-access");

    // "Nobody has access" and "we could not check" must not look the same on a
    // page whose whole job is knowing who has access.
    await expect(page.getByText("Failed to load role assignments")).toBeVisible();
  });
});

test.describe("granting a role", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    anAccount(backend, READER, "layla@example.com");
  });

  test("resolves an email and writes the role", async ({ page, db, backend }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("Bible reader granted")).toBeVisible();
    expect(backend.rpcCalls.filter((c) => c.name === "admin_grant_role_by_email")).toHaveLength(1);
    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ user_id: READER, role: "bible_reader" });
  });

  test("takes a UUID as well as an email", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill(READER);
    await page.getByRole("button", { name: "Add" }).click();

    // An admin acting on a support ticket usually has the UUID and not the
    // address, so both have to resolve.
    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "bible_reader" });
  });

  test("grants whichever role was chosen", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Beta tester" }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "beta_tester" });
  });

  test("refuses a UUID that resolves to nobody", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page
      .getByPlaceholder("User email or UUID")
      .fill("00000000-0000-4000-8000-00000000dead");
    await page.getByRole("button", { name: "Add" }).click();

    // A typo must not become a role row against a user id that does not exist
    // — nothing in the schema would ever clean that up. A UUID is the only
    // identifier that still errors: no future signup can ever carry one, so
    // there is nothing to park an invitation against.
    await expect(page.getByText("User not found")).toBeVisible();
    expect(db.rows("user_roles").filter((r) => r.role === "bible_reader")).toHaveLength(0);
  });

  test("will not grant the same role twice", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // A duplicate row would show twice in the list and take two revokes to
    // undo — the second of which an admin would have no reason to look for.
    await expect(page.getByText("This role is already assigned to that user.")).toBeVisible();
    expect(db.rows("user_roles").filter((r) => r.role === "bible_reader")).toHaveLength(1);
  });

  test("adds a second, different role to the same person", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Content reviewer" }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // The duplicate check is per role, not per user. It has to be: this exact
    // combination — reader plus reviewer — is the one the Bible pages treat as
    // "no access", so an admin has to be able to create it.
    await expect
      .poll(() => db.rows("user_roles").filter((r) => r.user_id === READER).length)
      .toBe(2);
  });

  test("clears the box after a successful grant", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Bible reader granted")).toBeVisible();

    // Left populated, the next Enter grants the same person again.
    await expect(page.getByPlaceholder("User email or UUID")).toHaveValue("");
  });

  test("grants on Enter as well as on the button", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByPlaceholder("User email or UUID").press("Enter");

    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "bible_reader" });
  });

  test("will not submit an empty box", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  test("reports a write that failed", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    // The RPC, not the table: the grant is written server-side now, so failing
    // `user_roles` from the client would leave the grant working.
    db.failRpc("admin_grant_role_by_email");

    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // Silence here would leave an admin believing they had granted access that
    // does not exist, and the learner emailing again a week later.
    await expect(page.getByText("Failed to grant role")).toBeVisible();
  });
});

test.describe("revoking a role", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [
      aRole("admin"),
      aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }),
    ]);
    anAccount(backend, READER, "layla@example.com");
  });

  test("deletes the grant", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await revokeButton(page, "Bible reader", "layla@example.com").click();

    await expect(page.getByText("Role revoked")).toBeVisible();
    await expect
      .poll(() => db.rows("user_roles").filter((r) => r.role === "bible_reader"))
      .toHaveLength(0);
  });

  test("removes only the row that was revoked", async ({ page, db }) => {
    db.add("user_roles", aRole("content_reviewer", { id: "22222222-0000-4000-8000-000000000002", user_id: READER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByRole("cell", { name: "Bible reader", exact: true })).toBeVisible();

    // Deleting by role-row id rather than by user is what makes this possible;
    // deleting by user would take both roles away at once.
    await revokeButton(page, "Bible reader", "layla@example.com").click();
    await expect(page.getByText("Role revoked")).toBeVisible();

    await expect
      .poll(() => db.rows("user_roles").filter((r) => r.user_id === READER).map((r) => r.role))
      .toEqual(["content_reviewer"]);
  });

  test("keeps the row on screen when the delete fails", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.failWrites("user_roles", 500);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await revokeButton(page, "Bible reader", "layla@example.com").click();

    // The list is filtered optimistically on success only. Dropping the row on
    // failure would tell an admin that access they still hold is gone.
    await expect(page.getByText("Failed to revoke role")).toBeVisible();
    await expect(page.getByText("layla@example.com")).toBeVisible();
  });

  test("names the revoke button after whose access it removes", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    // Previously recorded as a gap against the app-wide icon-button baseline,
    // and worth closing here rather than elsewhere: it is an irreversible
    // action on a page full of identical rows, and now that admin is grantable
    // the row a screen reader reaches for matters more than it used to.
    await expect(revokeButton(page, "Bible reader", "layla@example.com")).toHaveCount(1);
  });
});

test.describe("granting admin", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    anAccount(backend, READER, "layla@example.com");
  });

  test("offers admin in the picker", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").first().click();

    await expect(page.getByRole("option", { name: /^Admin/ })).toBeVisible();
    // Recorder stays out: it pairs with a recording setup arranged outside the
    // app, so a grant here would be a role with nothing behind it.
    await expect(page.getByRole("option", { name: /^Recorder/ })).toHaveCount(0);
  });

  test("asks before handing over the console", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^Admin/ }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // Every other role is one click. This one is not, because it is the click
    // that lets somebody else revoke *your* access.
    await expect(page.getByText("Grant full admin access?")).toBeVisible();
    expect(db.rows("user_roles").filter((r) => r.user_id === READER)).toHaveLength(0);
  });

  test("writes nothing when the confirmation is dismissed", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^Admin/ }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText("Grant full admin access?")).toHaveCount(0);
    expect(db.rows("user_roles").filter((r) => r.user_id === READER)).toHaveLength(0);
  });

  test("grants admin once confirmed", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^Admin/ }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Grant admin" }).click();

    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "admin" });
  });

  test("lists an admin grant so it can be audited", async ({ page, db, backend }) => {
    anAccount(backend, OTHER, "omar@example.com");
    db.add("user_roles", aRole("admin", { id: "22222222-0000-4000-8000-00000000000b", user_id: OTHER }));

    await page.goto("/admin/bible-access");

    // The old page filtered admin rows out of the listing, which meant the one
    // role that can do the most damage was the one nobody could review.
    await expect(page.getByText("omar@example.com")).toBeVisible();
    await expect(revokeButton(page, "Admin (full access)", "omar@example.com")).toBeVisible();
  });

  test("will not let an admin revoke their own admin row", async ({ page, db, backend }) => {
    anAccount(backend, TEST_USER_ID, "me@example.com");
    db.seed("user_roles", [
      aRole("admin", { id: "22222222-0000-4000-8000-00000000000c", user_id: TEST_USER_ID }),
    ]);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("me@example.com")).toBeVisible();

    // Disabled here and rejected by a trigger in the database, because RLS lets
    // any admin delete any role row and this page is not the only way in.
    await expect(
      page.getByRole("button", { name: /^Revoke Admin \(full access\) from me@example.com$/ }),
    ).toBeDisabled();
  });
});

test.describe("inviting an address with no account", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
  });

  test("parks the grant instead of refusing it", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^Transcriber/ }).click();
    await page.getByPlaceholder("User email or UUID").fill("newhire@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // The point of the feature: hiring somebody does not have to wait for them
    // to sign up first, and the admin does not have to remember to come back.
    await expect(page.getByText("Transcriber (native reviewer) invitation saved")).toBeVisible();
    await expect
      .poll(() => db.rows("pending_role_grants").map((r) => [r.email, r.role]))
      .toEqual([["newhire@example.com", "transcriber"]]);
  });

  test("says the role has not been given to anyone yet", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("newhire@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // A green "granted" for an address nobody owns is the failure mode worth
    // guarding: the admin would tick it off and never look again. Matched
    // exactly, so the toast's own wrapper — whose text is the title and the
    // description run together — cannot also match and trip strict mode.
    await expect(
      page.getByText(
        "newhire@example.com has no account yet. The role is applied " +
          "automatically when they sign up with this address.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("lowercases the address it stores", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("NewHire@Example.COM");
    await page.getByRole("button", { name: "Add" }).click();

    // Signup matching is on the lowercased address, so a stored mixed-case row
    // would sit there forever while the person signs in perfectly happily.
    await expect
      .poll(() => db.rows("pending_role_grants").map((r) => r.email))
      .toEqual(["newhire@example.com"]);
  });

  test("lists what is waiting, separately from what was granted", async ({ page, db }) => {
    db.seed("pending_role_grants", [
      {
        id: "44444444-0000-4000-8000-000000000001",
        email: "newhire@example.com",
        role: "beta_tester",
        created_at: "2026-05-06T00:00:00.000Z",
        created_by: TEST_USER_ID,
        claimed_at: null,
        claimed_by: null,
      },
    ]);

    await page.goto("/admin/bible-access");

    // Two lists, not one: an invitation is a promise about a future signup and
    // showing it next to real grants would overstate who has access today.
    await expect(page.getByRole("heading", { name: "Waiting on signup" })).toBeVisible();
    await expect(page.getByText("newhire@example.com")).toBeVisible();
    await listingLoaded(page);
  });

  test("cancels an invitation that was typed wrong", async ({ page, db }) => {
    db.seed("pending_role_grants", [
      {
        id: "44444444-0000-4000-8000-000000000002",
        email: "typo@example.com",
        role: "admin",
        created_at: "2026-05-06T00:00:00.000Z",
        created_by: TEST_USER_ID,
        claimed_at: null,
        claimed_by: null,
      },
    ]);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("typo@example.com")).toBeVisible();

    await page
      .getByRole("button", { name: /^Cancel Admin \(full access\) invitation for typo@example.com$/ })
      .click();

    // A mistyped invitation is a live grant to whoever registers that address
    // next, so cancelling it has to actually remove the row.
    await expect(page.getByText("Invitation cancelled")).toBeVisible();
    await expect.poll(() => db.rows("pending_role_grants")).toHaveLength(0);
  });

  test("does not invite the same address twice", async ({ page, db }) => {
    db.seed("pending_role_grants", [
      {
        id: "44444444-0000-4000-8000-000000000003",
        email: "newhire@example.com",
        role: "bible_reader",
        created_at: "2026-05-06T00:00:00.000Z",
        created_by: TEST_USER_ID,
        claimed_at: null,
        claimed_by: null,
      },
    ]);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("newhire@example.com")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("newhire@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("That invitation is already waiting.")).toBeVisible();
    expect(db.rows("pending_role_grants")).toHaveLength(1);
  });

  test("grants immediately when the address does have an account", async ({
    page,
    db,
    backend,
  }) => {
    anAccount(backend, READER, "layla@example.com");

    await page.goto("/admin/bible-access");
    await listingLoaded(page);

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // The invitation path is a fallback, not the default: an existing account
    // must not be left waiting on a signup that already happened.
    await expect(page.getByText("Bible reader granted")).toBeVisible();
    expect(db.rows("pending_role_grants")).toHaveLength(0);
  });
});
