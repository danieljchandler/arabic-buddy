import { expect, test } from "./support/fixtures";

/**
 * Native Feedback — the one page where real money changes hands outside the
 * subscription. The stakes are all in the Stripe return leg: the `purchase`
 * query param is the retry token for the exactly-once confirm call, so what
 * happens to it on failure decides whether a paid pack can silently vanish.
 */

test.describe("the credit balance", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows the balance the server reports", async ({ page, backend }) => {
    backend.stubFunction("native-feedback", {
      balance: 3,
      requests: [],
      credits_per_pack: 5,
      purchase_enabled: true,
    });

    await page.goto("/native-feedback");

    await expect(page.getByText("3", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /buy 5 credits/i })).toBeVisible();
  });

  test("offers a retry instead of an eternal em dash when the lookup fails", async ({
    page,
    backend,
  }) => {
    backend.stubFunctionFailure("native-feedback", 500);

    await page.goto("/native-feedback");

    await expect(page.getByText(/balance didn't load/i)).toBeVisible();

    // And the retry is real.
    backend.stubFunction("native-feedback", {
      balance: 2,
      requests: [],
      credits_per_pack: 5,
      purchase_enabled: false,
    });
    await page.getByRole("button", { name: /try again/i }).click();
    await expect(page.getByText("2", { exact: true })).toBeVisible();
  });
});

test.describe("returning from Stripe", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("confirms the purchase and retires the token", async ({ page, backend }) => {
    backend.stubFunction("native-feedback", (ctx) =>
      (ctx.body as { action?: string } | null)?.action === "confirm"
        ? { ok: true }
        : { balance: 5, requests: [], credits_per_pack: 5, purchase_enabled: true },
    );

    await page.goto("/native-feedback?purchase=cs_test_123");

    await expect(page.getByText(/credits added/i).first()).toBeVisible();
    // Confirmed exactly once server-side; the token has done its job.
    await expect(page).toHaveURL(/\/native-feedback$/);
  });

  test("keeps the token when the confirm fails, so a reload can retry", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/credit confirm failed/]);
    backend.stubFunction("native-feedback", (ctx) =>
      (ctx.body as { action?: string } | null)?.action === "confirm"
        ? { error: "stripe_unreachable" }
        : { balance: 0, requests: [], credits_per_pack: 5, purchase_enabled: true },
    );

    await page.goto("/native-feedback?purchase=cs_test_123");

    // Money has changed hands by now. The learner hears the truth — paid,
    // not credited yet — and the URL keeps the retry token instead of
    // stripping it, which used to orphan the purchase entirely.
    await expect(page.getByText(/couldn't confirm your purchase/i).first()).toBeVisible();
    await expect(page).toHaveURL(/purchase=cs_test_123/);
  });
});
