import { expect, test } from "./support/fixtures";

/**
 * The corner control, which is two controls.
 *
 * Dozens of pages reserve a slot in their top corner. It used to hold a home
 * button on every one of them — including the pages where the dock now offers
 * the identical destination forty pixels lower. So on those pages the slot
 * holds the profile emblem instead, and on the pages with no dock it stays the
 * home button, because those are the ones with no other way out.
 *
 * Getting this backwards is quiet in both directions: a duplicate home button
 * looks fine and wastes the corner, and a profile link on a page with no dock
 * strands someone mid-lesson. Neither shows up as a broken test elsewhere.
 */

test.describe("the corner control", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("is the way to your account wherever the dock is showing", async ({ page }) => {
    await page.goto("/reading");

    await page.getByRole("link", { name: /Your account/ }).first().click();
    await expect(page).toHaveURL(/\/me$/);
  });

  test("sits on the right, never in the mark's corner", async ({ page }) => {
    // The corner on the left belongs to the mark everywhere else in the app,
    // and an avatar wearing it on eighty interior pages was the complaint that
    // sent this back twice. One assertion per layout shape PageCorner is
    // dropped into, because the shapes are what broke it: a block on its own
    // line, a row that already has the page's controls at its far end, and a
    // centred title bar with no slack for an auto margin to eat.
    for (const route of ["/discover", "/listen", "/translate", "/share", "/transcribe"]) {
      await page.goto(route);

      const emblem = page.getByRole("link", { name: /Your account/ }).first();
      await expect(emblem).toBeVisible();

      const box = (await emblem.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(box.x + box.width / 2, `emblem should be right of centre on ${route}`).toBeGreaterThan(
        width / 2,
      );
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

  test("leaves room under itself at desktop width", async ({ page }) => {
    // The page padding that clears the dock is set twice — once bare, once
    // under md: — and the md: one wins from 768px up. When it was the smaller
    // of the two, anything at the bottom of a page sat underneath the dock and
    // could not be tapped. Ingleezy hit exactly this when it swapped its bar;
    // the clearance is stated at both widths.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/reading");

    const dock = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    const padding = await page.evaluate(() => {
      const main = document.querySelector("main, [class*='max-w-2xl']") as HTMLElement;
      return parseFloat(getComputedStyle(main).paddingBottom);
    });

    expect(padding).toBeGreaterThanOrEqual(dock!.height);
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
 * What the corner shows once you have chosen a picture.
 *
 * Picking an avatar wrote `profiles.avatar_url` and changed nothing anyone
 * saw day to day: the emblem was a hard-coded logo, so the setting only
 * surfaced on the profile page and the leaderboard. Both halves of the fix are
 * pinned here, because each is silent on its own — a corner that never shows
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
    const emblem = page.getByRole("link", { name: /Your account/ }).first();
    await expect(emblem.locator("img")).toHaveAttribute("src", /hakiya-mark/);
  });

  test("does not take the corner off the mark to do it", async ({ page, signInAs }) => {
    await signInAs("free", { profile: { avatar_url: "/avatars/sadu-rose.png" } });
    await page.goto("/choose");

    // The first pass put the two side by side in the same corner and the
    // avatar ended up wearing the slot the brand had. They are opposite ends
    // of the header now: mark on the left, where it always was, face on the
    // right.
    const mark = page.getByRole("img", { name: "Hakiya" }).first();
    const face = page.getByRole("link", { name: /Your account/ }).first();
    await expect(mark).toBeVisible();

    const markBox = (await mark.boundingBox())!;
    const faceBox = (await face.boundingBox())!;
    expect(markBox.x).toBeLessThan(faceBox.x);
  });
});
