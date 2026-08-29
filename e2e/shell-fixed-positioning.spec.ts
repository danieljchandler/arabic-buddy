import { expect, test } from "./support/fixtures";

/**
 * `position: fixed` inside a page still means "relative to the viewport".
 *
 * This exists because it silently stopped being true, and nothing caught it.
 * AppShell's content column carries `animate-fade-up`, and the Lahja motion
 * language ships that animation with `animation-fill-mode: both`. `both`
 * retains the final keyframe forever, and fade-up's final keyframe is
 * `translateY(0)` — which computes to `transform: matrix(1,0,0,1,0,0)`, not
 * `none`. Per spec, any transform other than `none` makes the element a
 * containing block for its fixed descendants.
 *
 * So every fixed child of every page anchored to the column rather than the
 * window. Measured on /settings before the fix: a fixed probe with `bottom: 0`
 * landed at y=3850 in a 1000px window. That broke Settings' unsaved-changes
 * bar, the word-tap bar in TappableArabicText, SaveUnknownsBar, XPPopup and
 * the admin status banners. It went unnoticed for so long because everything
 * people *look* at — Radix dialogs, toasts, the dialect switcher — portals to
 * document.body and so escapes the containing block entirely.
 *
 * The failure mode is what makes this worth an e2e test rather than a unit
 * one: nothing throws, no test fails, and the element is still on screen — it
 * is just parked at the bottom of a 4,000px document where nobody scrolls. It
 * is only visible to something that measures, which is what this does.
 *
 * A probe element rather than the real save bar, deliberately: the bug is a
 * property of the shell, so this keeps holding for fixed children that do not
 * exist yet, and does not need Settings to be in a dirty state to run.
 */

test("a fixed child of the app shell anchors to the viewport", async ({ page, signInAs }) => {
  await signInAs("allin");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings", { waitUntil: "networkidle" });
  // Outlast the 360ms arrival animation: during it a transform is present and
  // expected, and only what it leaves behind afterwards is the bug.
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const column = document.querySelector(".animate-fade-up") as HTMLElement | null;
    if (!column) return null;

    const el = document.createElement("div");
    el.style.cssText = "position:fixed;bottom:0;left:0;width:10px;height:10px";
    column.appendChild(el);
    const top = el.getBoundingClientRect().top;
    el.remove();

    return {
      transform: getComputedStyle(column).transform,
      fixedProbeTop: Math.round(top),
      viewportBottom: window.innerHeight - 10,
    };
  });

  expect(probe, "AppShell's content column should be on the page").not.toBeNull();

  // The assertion that actually matters. Anything else means a fixed child is
  // positioned against the document instead of the window.
  expect(
    probe!.fixedProbeTop,
    "a bottom:0 fixed child should sit at the bottom of the window",
  ).toBe(probe!.viewportBottom);

  // And the reason, pinned separately so a failure says *why* rather than just
  // reporting two numbers that differ.
  expect(
    probe!.transform,
    "a lingering transform makes the column a containing block for fixed children",
  ).toBe("none");
});
