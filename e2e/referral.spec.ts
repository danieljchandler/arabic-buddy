import { expect, test } from "./support/fixtures";
import { aProfile, aUserXp } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The referral share link, end to end.
 *
 * `ReferralCard` shares `https://hakiya.app/?ref=<CODE>`. Until the handoff
 * existed nothing read that param, so the friend on the other end had to find
 * the card and type the code by hand — the link was decoration. What these
 * specs hold in place: the code is captured at the front door, the address
 * bar is cleaned so the browser stops re-offering it, and it survives every
 * navigation in between (in real life the sign-up redirect) to land, already
 * typed, in the redeem box on the profile page.
 */

function seedProfile(db: MemoryDb) {
  db.seed("profiles", [aProfile({ created_at: "2024-03-15T00:00:00Z" })]);
  db.seed("user_xp", [aUserXp({ total_xp: 0 })]);
  db.seed("user_vocabulary", []);
  db.seed("review_streaks", []);
  db.seed("user_achievements", []);
  db.seed("achievements", []);
}

test.describe("a friend's share link", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedProfile(db);
  });

  test("carries the code from the link into the redeem box", async ({ page, backend }) => {
    // The front door is the feed; give it an empty one so the visit is quiet.
    backend.stubFunction("discover-feed", {
      items: [],
      cold_start: true,
      seed: 1,
      active_dialect: "Gulf",
      cefr: null,
    });

    await page.goto("/?ref=abcd2345");

    // Captured and stripped, with no reload: the param is gone from the URL.
    await expect(page).toHaveURL(/\/$/);
    await expect(page).not.toHaveURL(/ref=/);

    // A full navigation later, the card opens itself with the code in place.
    await page.goto("/profile");

    const input = page.getByLabel("Referral code");
    await expect(input).toHaveValue("ABCD2345");
    await expect(page.getByText(/A friend invited you/)).toBeVisible();
  });

  test("redeems the carried code and forgets it", async ({ page, backend }) => {
    await page.goto("/profile?ref=abcd2345");

    await expect(page).not.toHaveURL(/ref=/);
    await page.getByRole("button", { name: "Redeem" }).click();

    // The redeem row retires, the backend saw the normalised code, and a
    // later visit is back to the lazy, collapsed card.
    await expect(page.getByLabel("Referral code")).toHaveCount(0);
    const redeem = backend.callsTo("referral").find(
      (call) => (call.body as { action?: string }).action === "redeem",
    );
    expect(redeem?.body).toEqual({ action: "redeem", code: "ABCD2345" });

    await page.goto("/profile");
    await expect(page.getByRole("button", { name: "Invite friends" })).toBeVisible();
    await expect(page.getByLabel("Referral code")).toHaveCount(0);
  });

  test("ignores a link whose code could not have been minted", async ({ page }) => {
    await page.goto("/profile?ref=not-a-code");

    // Nothing stashed, so the card stays collapsed and lazy.
    await expect(page.getByRole("button", { name: "Invite friends" })).toBeVisible();
    await expect(page.getByLabel("Referral code")).toHaveCount(0);
  });
});
