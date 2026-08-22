import { expect, test } from "./support/fixtures";

/**
 * The account control lives in the dock; the corner is two things or nothing.
 *
 * Dozens of pages reserve a slot in their top corner. It held a home button,
 * then the profile emblem once the dock made a corner home redundant — and now
 * nothing at all where the dock is showing, because the emblem moved into the
 * dock's own fifth slot, where every feed app this audience uses keeps it. On
 * the pages with no dock the corner stays the home button, because those are
 * the ones with no other way out.
 *
 * Getting this backwards is quiet in both directions: a duplicate account
 * control looks fine and wastes the corner, and no way out on a dock-less page
 * strands someone mid-lesson. Neither shows up as a broken test elsewhere.
 */

test.describe("the account control", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("is the way to your account wherever the dock is showing", async ({ page }) => {
    await page.goto("/reading");

    await page.getByRole("link", { name: /Your account/ }).first().click();
    await expect(page).toHaveURL(/\/me$/);
  });

  test("lives in the dock, and only in the dock", async ({ page }) => {
    // One account control per screen, and it is the dock's fifth slot. A
    // second emblem in a page corner is the same duplication the corner home
    // button was — the identical destination twice, in the two most valuable
    // spots on the screen.
    for (const route of ["/discover", "/listen", "/translate", "/share"]) {
      await page.goto(route);

      const emblems = page.getByRole("link", { name: /Your account/ });
      await expect(emblems, `one account control on ${route}`).toHaveCount(1);
      await expect(
        page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Your account/ }),
        `the account control on ${route} is the dock's`,
      ).toBeVisible();
    }
  });

  test("keeps a corner emblem on the pages that draw their own layout", async ({ page }) => {
    // Transcribe and Learn from X skip AppShell, so the dock — the emblem's
    // home everywhere else — never mounts on them. Their corner keeps the
    // face: a page with no dock still needs a way to your account.
    for (const route of ["/transcribe", "/learn-from-x"]) {
      await page.goto(route);

      await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: /Your account/ }),
        `the corner emblem on ${route}`,
      ).toHaveCount(1);
    }
  });

  test("stays a way out on the pages that have no dock", async ({ page }) => {
    await page.goto("/reset-password");

    // This route hides the dock, as every focused flow does. Swapping its only
    // escape hatch for a profile link would strand whoever landed on it.
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Your account/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Go home" })).toBeVisible();
  });

  test("leaves room for itself, whichever way it runs", async ({ page }) => {
    // The page padding that clears the dock is set twice — once bare, once
    // under md: — and the md: one wins from 768px up. When it was the smaller
    // of the two, anything at the bottom of a page sat underneath the dock and
    // could not be tapped. Ingleezy hit exactly this when it swapped its bar;
    // the clearance is stated at both widths.
    await page.setViewportSize({ width: 900, height: 720 });
    await page.goto("/reading");

    const bar = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    const padding = await page.evaluate(() => {
      const main = document.querySelector("main, [class*='max-w-2xl']") as HTMLElement;
      return parseFloat(getComputedStyle(main).paddingBottom);
    });
    expect(padding).toBeGreaterThanOrEqual(bar!.height);

    // From lg the dock stands up as a left rail, so the clearance has to turn
    // with it: content starting under a fixed rail is unreachable in exactly
    // the same way, and a bottom padding tall enough for a full-height rail
    // would be an absurd gap.
    await page.setViewportSize({ width: 1280, height: 720 });
    const rail = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    const content = await page.locator("[class*='max-w-2xl']").first().boundingBox();

    expect(rail!.x).toBe(0);
    expect(content!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width);
  });

  test("does not offer the same destination twice", async ({ page }) => {
    await page.goto("/reading");

    // The dock owns "home" now. A second home control in the corner is the
    // duplication this swap exists to remove.
    await expect(page.getByRole("button", { name: "Go home" })).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home" }),
    ).toBeVisible();
  });
});

/**
 * What the emblem shows once you have chosen a picture.
 *
 * Picking an avatar wrote `profiles.avatar_url` and changed nothing anyone
 * saw day to day: the emblem was a hard-coded logo, so the setting only
 * surfaced on the profile page and the leaderboard. Both halves of the fix are
 * pinned here, because each is silent on its own — an emblem that never shows
 * your picture reads as a broken picker, and a brand that vanished when the
 * avatar took its slot reads as nothing at all.
 */
test.describe("the emblem's picture", () => {
  test("is the avatar you chose", async ({ page, signInAs }) => {
    await signInAs("free", { profile: { avatar_url: "/avatars/sadu-rose.png" } });
    await page.goto("/choose");

    const emblem = page.getByRole("link", { name: /Your account/ }).first();
    await expect(emblem.locator("img")).toHaveAttribute("src", "/avatars/sadu-rose.png");
  });

  test("falls back to the mark when no picture has been chosen", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/choose");

    // Anything but an empty grey disc. The mark is bundled, so the build
    // fingerprints its filename — the stem is the stable half of the URL.
    //
    // Two images, not one: the fallback is the mark inside its Sadu frame, and
    // the frame is a separate file on purpose so the logo has a single source
    // of truth. Both halves are pinned, because a frame with nothing in it and
    // a mark with nothing around it are each a plausible way for this to break.
    const emblem = page.getByRole("link", { name: /Your account/ }).first();
    await expect(emblem.locator('img[src*="hakiya-mark"]')).toBeVisible();
    await expect(emblem.locator('img[src*="sadu-frame"]')).toBeVisible();
  });

  test("does not take the corner off the mark to do it", async ({ page, signInAs }) => {
    await signInAs("free", { profile: { avatar_url: "/avatars/sadu-rose.png" } });
    await page.goto("/choose");

    // The first pass put the two side by side in the same corner and the
    // avatar ended up wearing the slot the brand had. The mark keeps its
    // corner; the face lives in the dock and nowhere near the header.
    const mark = page.getByRole("img", { name: "Hakiya" }).first();
    await expect(mark).toBeVisible();

    const face = page.getByRole("link", { name: /Your account/ });
    await expect(face).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Your account/ }),
    ).toBeVisible();
  });
});
