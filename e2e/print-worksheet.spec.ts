import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./support/fixtures";
import { SAMPLE_WORKSHEET } from "../src/lib/worksheetSample";

/**
 * /print/worksheet — a worksheet from the learner's own words, for paper.
 *
 * The hermetic tests hold the page's behaviour: signed-out visitors go to
 * sign in, nothing is generated until asked (it is a paid call), the sample
 * needs no call at all, a refusal shows its message, and print media hides
 * the controls and keeps the answer key.
 *
 * The last test is the Arabic print check, and it only runs when asked:
 *
 *   WORKSHEET_PRINT_CHECK_DIR=test-results/print-check npx playwright test e2e/print-worksheet.spec.ts
 *
 * It lets the Google Fonts request through (everything else stays blocked),
 * waits for Noto Naskh Arabic, and writes a full-page print-media screenshot
 * and a page.pdf() of the sample to <dir> for a person to look at: do the
 * letters join, do the harakat show, do the writing lines run right to left,
 * and do digits inside Arabic lines ("الساعة 11", "12 ريال") stay in order.
 * Pixels are not something this suite can assert; it can only produce them.
 */

test.describe("the worksheet page", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/print/worksheet");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("waits for the button before spending a call, and offers the sample", async ({ page, signInAs, backend }) => {
    await signInAs("free");
    let calls = 0;
    backend.stubFunction("generate-worksheet", () => {
      calls++;
      return { spec: SAMPLE_WORKSHEET };
    });
    await page.goto("/print/worksheet");

    await expect(page.getByRole("heading", { name: "A worksheet from your own words" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeDisabled();
    expect(calls).toBe(0);

    await page.getByRole("link", { name: "See a sample first" }).click();
    await expect(page.getByTestId("worksheet")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SAMPLE_WORKSHEET.title.arabic);
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeEnabled();
    expect(calls).toBe(0);
  });

  test("makes a worksheet from the function's spec", async ({ page, signInAs, backend }) => {
    await signInAs("free");
    const spec = { ...SAMPLE_WORKSHEET, title: { arabic: "كَلِمَاتِي", english: "Generated for you" } };
    backend.stubFunction("generate-worksheet", { spec });
    await page.goto("/print/worksheet");

    await page.getByRole("button", { name: "Make my worksheet" }).click();
    await expect(page.getByText("Generated for you")).toBeVisible();
    await expect(page.locator("section[data-kind]")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Make another" })).toBeVisible();
  });

  test("shows the function's own message when it refuses", async ({ page, signInAs, backend }) => {
    await signInAs("free");
    backend.stubFunctionFailure("generate-worksheet", 422, {
      error: "not_enough_words",
      message: "A worksheet needs at least 4 words that are weak or due in Gulf Arabic. Review or save a few more and try again.",
    });
    await page.goto("/print/worksheet");

    await page.getByRole("button", { name: "Make my worksheet" }).click();
    await expect(page.getByRole("alert")).toContainText("needs at least 4 words");
    await expect(page.getByTestId("worksheet")).toHaveCount(0);
  });

  test("prints the sheet and the key, not the controls", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/print/worksheet?sample=1");
    await expect(page.getByTestId("worksheet")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
    await expect(page.getByTestId("answer-key")).toBeVisible();
    // The key starts a new page.
    const breakBefore = await page
      .getByTestId("answer-key")
      .evaluate((el) => getComputedStyle(el).breakBefore || getComputedStyle(el).pageBreakBefore);
    expect(["page", "always"]).toContain(breakBefore);
    // Writing runs right to left, with the margin rule on the right.
    const lines = page.getByTestId("writing-lines");
    await expect(lines).toHaveAttribute("dir", "rtl");
    expect(await lines.evaluate((el) => getComputedStyle(el).borderRightStyle)).toBe("solid");
  });
});

test.describe("Arabic print check (local, on request)", () => {
  const outDir = process.env.WORKSHEET_PRINT_CHECK_DIR;
  test.skip(!outDir, "set WORKSHEET_PRINT_CHECK_DIR to write the screenshot and PDF");

  test("renders the sample with the real Arabic font to a screenshot and a PDF", async ({ page, signInAs, browserName }) => {
    test.skip(browserName !== "chromium", "page.pdf() is Chromium-only");
    await signInAs("free");
    // Registered after the fixture's catch-all block, so it runs first: the
    // font is the one thing this check needs from outside.
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.continue());

    await page.goto("/print/worksheet?sample=1");
    await expect(page.getByTestId("worksheet")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.load('16px "Noto Naskh Arabic"', "كلمات");
      await document.fonts.ready;
    });
    const naskh = await page.evaluate(() => document.fonts.check('16px "Noto Naskh Arabic"', "كلمات"));
    expect(naskh, "Noto Naskh Arabic did not load; the check would be looking at a fallback font").toBe(true);

    await page.emulateMedia({ media: "print" });
    mkdirSync(outDir!, { recursive: true });
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.screenshot({ path: join(outDir!, "worksheet-print.png"), fullPage: true });
    await page.pdf({ path: join(outDir!, "worksheet.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  });
});
