import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import { buildCTest } from "../src/lib/cTest";

/**
 * The C-test: a passage from reading-passage with half of every second word
 * removed. What is worth pinning end to end: the gaps render as inputs in
 * place, scoring reads them back, and a signed-in learner's result lands in
 * placement_results as a c_test row with a percentage — not a level.
 */

const PASSAGE =
  "أنا رحت السوق أمس مع صديقي. اشترينا خضار وفواكه وقهوة من الدكان. بعدين قعدنا في مقهى صغير قريب من البيت. كان الجو حلو والناس كثير.";

test.describe("the C-test", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("free");
    db.seed("placement_results", []);
    db.seed("review_log", []);
    backend.stubFunction("reading-passage", { passage: PASSAGE });
  });

  test("renders the gaps as inputs and scores a perfect answer at 100%", async ({ page, db }) => {
    await page.goto("/placement/c-test");

    const model = buildCTest(PASSAGE.split(/(?<=[.!؟،])\s+/));
    const inputs = page.getByRole("textbox", { name: /^Complete word/ });
    await expect(inputs).toHaveCount(model.items.length);

    for (let i = 0; i < model.items.length; i++) {
      await inputs.nth(i).fill(model.items[i].answer);
    }
    await page.getByRole("button", { name: "Check my answers" }).click();

    await expect(page.getByRole("status")).toContainText(`${model.items.length} of ${model.items.length} · 100%`);
    await expect.poll(() => db.rows("placement_results").length).toBe(1);
    const row = db.rows("placement_results")[0] as Record<string, unknown>;
    expect(row.instrument).toBe("c_test");
    expect(row.user_id).toBe(TEST_USER_ID);
    expect(row.score).toBe(100);
    expect(row.cefr_level).toBeNull();
  });

  test("scores what was actually typed", async ({ page }) => {
    await page.goto("/placement/c-test");
    const inputs = page.getByRole("textbox", { name: /^Complete word/ });
    await expect(inputs.first()).toBeVisible();
    await inputs.first().fill("xx");
    await page.getByRole("button", { name: "Check my answers" }).click();
    await expect(page.getByRole("status")).toContainText(/0 of \d+ · 0%/);
  });

  test("says so when no passage could be made", async ({ page, backend }) => {
    backend.stubFunction("reading-passage", { passage: "" });
    await page.goto("/placement/c-test");
    await expect(page.getByRole("alert")).toContainText(/too short|Could not/);
  });
});
