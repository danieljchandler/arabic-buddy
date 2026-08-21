import { expect, test } from "./support/fixtures";

/**
 * The placement quiz — the one assessment that anchors everything else.
 *
 * Its level is written to the profile and then read by Discover's default
 * difficulty filter, by grammar drills and by every i+1 content choice, so an
 * over-placed learner is handed material above their head everywhere at once
 * and has no way to tell why.
 *
 * Two properties are pinned here because both were once wrong in the same
 * direction — flattering the learner:
 *
 *  1. A listening item is *heard*. The test used to have no listening item at
 *     all, in an app whose premise is spoken dialect, so it measured the eye
 *     and called it proficiency.
 *  2. English is feedback, not a hint. The "Show English" toggle used to
 *     reveal the question and all four choices while they were still being
 *     answered, which lets a learner answer from the translation.
 */

const A_LISTENING_QUESTION = {
  question_arabic: "وين رايح بكرة؟",
  question_english: "Where are you going tomorrow?",
  skill_type: "listening",
  difficulty: "A2",
  choices: [
    // Distinct from the prompt on purpose: the choices are meanings, and a
    // choice that echoes the spoken line verbatim would put the answer back on
    // screen — which is what this test is checking never happens.
    { text: "Where are you going tomorrow?", text_arabic: "إلى أين تذهب غدا؟" },
    { text: "What did you eat?", text_arabic: "وش أكلت؟" },
    { text: "How much does it cost?", text_arabic: "بكم؟" },
    { text: "Who is that?", text_arabic: "منو ذا؟" },
  ],
  correct_index: 0,
};

test.describe("a listening item", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("free");
    backend.stubFunction("placement-quiz", {
      questions: [A_LISTENING_QUESTION],
      suggested_difficulty: "A2",
    });
  });

  test("is spoken rather than shown", async ({ page }) => {
    await page.goto("/placement");
    await page.getByRole("button", { name: /start quiz/i }).click();

    // Printing the line beside the audio would turn a listening item back into
    // a reading item with a sound effect.
    await expect(page.getByRole("button", { name: /play the line again/i })).toBeVisible();
    await expect(page.getByText("وين رايح بكرة؟")).toHaveCount(0);
    await expect(page.getByText(/listen, then choose the meaning/i)).toBeVisible();
  });

  test("reveals the line only once it has been answered", async ({ page }) => {
    await page.goto("/placement");
    await page.getByRole("button", { name: /start quiz/i }).click();
    await expect(page.getByRole("button", { name: /play the line again/i })).toBeVisible();

    // Choices are labelled by their Arabic while the item is live — their
    // English is part of the feedback, not a crib to answer from.
    await page.getByRole("button", { name: "إلى أين تذهب غدا؟" }).click();

    // Now it is worth reading: the learner has committed, and seeing what they
    // heard is how the item teaches rather than just measures.
    await expect(page.getByText("وين رايح بكرة؟").first()).toBeVisible();
  });
});

test.describe("the English toggle", () => {
  test("holds the translation back until the answer is in", async ({ page, signInAs, backend }) => {
    await signInAs("free");
    backend.stubFunction("placement-quiz", {
      questions: [
        {
          question_arabic: "شنو معنى «وايد»؟",
          question_english: "What does «wayed» mean?",
          skill_type: "vocabulary",
          difficulty: "A2",
          choices: [
            { text: "a lot", text_arabic: "كثير" },
            { text: "a little", text_arabic: "شوي" },
            { text: "never", text_arabic: "أبدا" },
            { text: "maybe", text_arabic: "يمكن" },
          ],
          correct_index: 0,
        },
      ],
      suggested_difficulty: "A2",
    });

    await page.goto("/placement");
    await page.getByRole("button", { name: /start quiz/i }).click();

    await page.getByRole("switch", { name: /show english/i }).click();

    // With it on mid-question, the learner could read the answer off the
    // translation — and a test answered in English measures nothing about
    // their Arabic. Neither the question nor the choices give it away.
    await expect(page.getByText("What does «wayed» mean?")).toHaveCount(0);
    await expect(page.getByText("a lot", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "كثير" }).click();
    await expect(page.getByText("What does «wayed» mean?")).toBeVisible();
  });
});
