import { expect, test } from "./support/fixtures";
import { aRole } from "../src/test/support/factories";

/**
 * ID-number logins — the way in for a reviewer no email invitation reaches.
 *
 * The feature is two pages that have to agree on one thing: the ID an admin
 * mints on `/admin/id-logins` must be the ID that signs in on `/login/id`. Both
 * derive the account's address from the same shared rule, and a drift between
 * them is invisible in review and total at runtime — the credential simply
 * never works, and the person holding it has no way to say why.
 *
 * So these specs care about the round trip and about the refusals: who may mint
 * one, which roles it may carry, and that switching one off takes the role away
 * rather than only banning the account.
 */

const CREDENTIAL = "cred-40318825";
const ID_USER = "user-40318825";

/** A credential that already exists, as the console would have left it. */
function seedCredential(
  db: { add: (table: string, ...rows: Record<string, unknown>[]) => unknown },
  over: Record<string, unknown> = {},
) {
  db.add("access_credentials", {
    id: CREDENTIAL,
    access_id: "40318825",
    user_id: ID_USER,
    role: "transcriber",
    label: "Ahmed — Yemeni reviewer",
    created_at: "2026-08-30T09:00:00.000Z",
    password_set_at: "2026-08-30T09:00:00.000Z",
    disabled_at: null,
    ...over,
  });
}

test.describe("who may mint one", () => {
  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);

    await page.goto("/admin/id-logins");

    await expect(page.getByRole("heading", { name: "ID logins", exact: true })).toBeVisible();
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");

    await page.goto("/admin/id-logins");

    // A reviewer who could mint credentials could mint one for themselves and
    // hand it to anyone — the page has to be admin-only in the same way the
    // role console is.
    await expect(page.getByPlaceholder("Ahmed — Yemeni reviewer")).toHaveCount(0);
  });

  test("turns a transcriber away", async ({ page, signInAs }) => {
    await signInAs("transcriber");

    await page.goto("/admin/id-logins");

    await expect(page.getByPlaceholder("Ahmed — Yemeni reviewer")).toHaveCount(0);
  });
});

test.describe("minting a credential", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
  });

  test("shows the ID and password once, with the message to send", async ({ page, db }) => {
    await page.goto("/admin/id-logins");

    await page.getByPlaceholder("Ahmed — Yemeni reviewer").fill("Ahmed — Yemeni reviewer");
    await page.getByRole("button", { name: "Create" }).click();

    const id = await page.getByTestId("fresh-access-id").innerText();
    const password = await page.getByTestId("fresh-password").innerText();
    expect(id.replace(/\D/g, "")).toMatch(/^[1-9][0-9]{7}$/);
    expect(password).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // The message is the deliverable: it is what actually gets pasted into a
    // chat, and a credential split over three messages arrives as two.
    await expect(page.locator("pre")).toContainText("/login/id");

    // The role is granted, not merely recorded. A credential that signs in and
    // holds no role reads to its holder as the app being broken.
    const roles = db.rows("user_roles").filter((row) => row.role === "transcriber");
    expect(roles).toHaveLength(1);
    const credential = db.rows("access_credentials")[0];
    expect(credential.label).toBe("Ahmed — Yemeni reviewer");
    // Nothing anywhere stores the password in a readable form.
    expect(JSON.stringify(credential)).not.toContain(password);
  });

  test("offers only the roles an ID login may carry", async ({ page }) => {
    await page.goto("/admin/id-logins");

    await page.getByRole("combobox").click();

    await expect(page.getByRole("option", { name: "Transcriber (native reviewer)" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Content reviewer" })).toBeVisible();
    // The credential is minted by someone else and sent over a chat app, so an
    // admin must never be one: there is no inbox to verify the holder with.
    await expect(page.getByRole("option", { name: "Admin (full access)" })).toHaveCount(0);
  });

  test("lists an existing credential by ID and who it is for", async ({ page, db }) => {
    seedCredential(db);

    await page.goto("/admin/id-logins");

    await expect(page.getByRole("cell", { name: "4031 8825" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Ahmed — Yemeni reviewer" })).toBeVisible();
  });

  test("switching access off removes the role, not just the row's status", async ({ page, db }) => {
    seedCredential(db);
    db.add("user_roles", { id: "role-40318825", user_id: ID_USER, role: "transcriber" });

    await page.goto("/admin/id-logins");
    await page.getByRole("button", { name: "Switch off" }).click();

    await expect(page.getByRole("cell", { name: "Switched off" })).toBeVisible();
    // A row marked off while the role row survives is the worst of both: the
    // console says stopped and every role check still says reviewer.
    expect(db.rows("user_roles").filter((row) => row.user_id === ID_USER)).toHaveLength(0);
  });

  test("a new password keeps the same ID", async ({ page, db }) => {
    seedCredential(db);

    await page.goto("/admin/id-logins");
    await page.getByRole("button", { name: "New password" }).click();

    // The ID is what the reviewer already has written down; moving it would
    // make this a new credential rather than a recovered one.
    await expect(page.getByTestId("fresh-access-id")).toHaveText("4031 8825");
    await expect(page.getByTestId("fresh-password")).toHaveText(
      /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
    );
  });
});

test.describe("signing in with an ID", () => {
  test("takes a reviewer to the videos they review", async ({ page, backend }) => {
    // The account behind the ID, as the edge function would have created it:
    // an ordinary password account whose address is derived from the digits.
    backend.addUser(ID_USER, "40318825@ids.hakiya.app");

    await page.goto("/login/id");
    await page.getByLabel("ID number").fill("40318825");
    await page.getByLabel("Password", { exact: true }).fill("K7QM-4RTX-9BFD");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/videos/);
  });

  test("accepts the ID with the spacing it was sent with", async ({ page, backend }) => {
    backend.addUser(ID_USER, "40318825@ids.hakiya.app");

    await page.goto("/login/id");
    // A pasted ID brings its formatting along. Refusing it would look, to the
    // person typing, exactly like a wrong credential.
    await page.getByLabel("ID number").fill("4031 8825");
    await page.getByLabel("Password", { exact: true }).fill("K7QM-4RTX-9BFD");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/videos/);
  });

  test("says so when the ID is the wrong length, without calling the server", async ({ page }) => {
    await page.goto("/login/id");
    await page.getByLabel("ID number").fill("4031");
    await page.getByLabel("Password", { exact: true }).fill("K7QM-4RTX-9BFD");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("alert")).toContainText("8 digits");
  });

  test("does not say which half was wrong", async ({ page }) => {
    await page.goto("/login/id");
    await page.getByLabel("ID number").fill("40318825");
    // The emulator's recognisable rejection.
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // Naming the wrong half tells anyone trying IDs at random which ones exist.
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("did not match");
    await expect(alert).not.toContainText("password is");
  });

  test("is linked from the email sign-in page", async ({ page }) => {
    await page.goto("/admin/login");

    // Without this a reviewer who was sent an ID lands on a form asking for an
    // email address they do not have, and stops there.
    await page.getByRole("button", { name: /Given an ID number instead/ }).click();

    await expect(page.getByRole("heading", { name: "Sign in with your ID" })).toBeVisible();
  });
});
