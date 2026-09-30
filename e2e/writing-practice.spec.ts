import { expect, test } from "./support/fixtures";

/**
 * Writing practice — the page fetches a prompt on mount and reviews what the
 * learner typed, both through `writing-coach`.
 *
 * What is pinned here is the failure copy. During the 2026-09-29 sweep the
 * function's model was out of credit and the page said "Couldn't load a
 * prompt" with no reason and no way to retry; the review said "try again"
 * about something that would not have changed. The function's own message
 * (`{ message }` in the body, whatever the status) is what the learner reads.
 */

const OUT_OF_CREDIT = { error: "coach_failed", message: "The writing coach is out of credit." };

test.describe("when the coach is down", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("says why no prompt loaded and offers a retry", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("writing-coach", 502, OUT_OF_CREDIT);

    await page.goto("/write");

    await expect(page.getByRole("alert")).toContainText("Couldn't load a prompt.");
    await expect(page.getByRole("alert")).toContainText("The writing coach is out of credit.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("retries when asked", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("writing-coach", 502, OUT_OF_CREDIT);
    await page.goto("/write");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    backend.stubFunction("writing-coach", {
      prompt: {
        scenario_english: "Your friend is planning the weekend.",
        message_arabic: "وش رايك نروح البر بكرة؟",
        message_transliteration: "wish rayik nrooh al-barr bukra?",
        message_english: "What do you think about going to the desert tomorrow?",
      },
    });
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText("وش رايك نروح البر بكرة؟")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("says why a review failed", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    await page.goto("/write");
    await expect(page.getByText("وش رايك نروح البر بكرة؟")).toBeVisible();

    backend.stubFunctionFailure("writing-coach", 402, OUT_OF_CREDIT);
    await page.getByPlaceholder("اكتب ردك هنا…").fill("ايه يلا نروح");
    await page.getByRole("button", { name: "Get corrections" }).click();

    await expect(page.getByText("The writing coach is out of credit.")).toBeVisible();
  });
});
