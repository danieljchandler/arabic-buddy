import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { GenerateImageDialog, type GenerateImageWord } from "./GenerateImageDialog";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Generating the picture on a flashcard.
 *
 * A picture is what lets a card be answered without translating through
 * English, so it is worth a dialog of its own rather than a single button. The
 * two controls do different jobs: the free-text box describes *this* picture,
 * and the style lock describes *every* picture — a signature look plus a fixed
 * seed, so a deck of forty cards does not look like forty different apps.
 *
 * Generation is metered, so a refusal for being over the daily cap is not an
 * error to report but a limit to explain, and it is handled before anything
 * else in the response is looked at.
 *
 * A word's first picture comes from the shared asset store (`word-asset`):
 * the picture another learner already has for the word, or a new one drawn in
 * the Ink style and filed for the next learner. A picture the learner
 * describes, draws in their locked style, or asks for again is their own, and
 * goes to the illustrator (`generate-flashcard-image`) as it always did — as
 * does a first picture while the store cannot answer.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

const cap = vi.hoisted(() => ({
  showCapToastIfLimited: vi.fn((..._args: unknown[]) => false),
}));
vi.mock("@/lib/handleCapResponse", () => ({
  showCapToastIfLimited: (...a: unknown[]) => cap.showCapToastIfLimited(...a),
}));

const SHARED_URL =
  "https://e2e.supabase.co/storage/v1/object/public/flashcard-images/word-assets/image/ink-1/gulf/abc/1.png";

const A_WORD: GenerateImageWord = {
  id: "word-1",
  word_arabic: "تفاحة",
  word_english: "apple",
  image_url: null,
};

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  cap.showCapToastIfLimited.mockReset().mockReturnValue(false);
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

interface Options {
  word?: GenerateImageWord | null;
  seed?: (backend: SupabaseBackend) => void;
}

function render({ word = A_WORD, seed }: Options = {}) {
  const onOpenChange = vi.fn();
  const onImageSaved = vi.fn();
  const harness = renderWithProviders(
    <GenerateImageDialog
      word={word}
      open
      onOpenChange={onOpenChange}
      onImageSaved={onImageSaved}
    />,
    {
      persona: "free",
      seed: (backend) => {
        backend.stubFunction("word-asset", {
          asset: { id: "asset-1", kind: "image", url: SHARED_URL },
          url: SHARED_URL,
          cached: true,
          stored: true,
        });
        backend.stubFunction("generate-flashcard-image", {
          imageUrl: "https://images.test/apple.png",
        });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return { ...harness, onOpenChange, onImageSaved };
}

const generateButton = () =>
  screen.getByRole("button", { name: /generate image|regenerate image/i });

const generate = async () => {
  await act(async () => {
    fireEvent.click(generateButton());
  });
};

const instructionsBox = () => screen.getByPlaceholderText(/a red apple on a wooden table/);

describe("setting up the picture", () => {
  it("shows the word the picture is for", () => {
    render();

    expect(screen.getByText("تفاحة")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("apple")).toBeInTheDocument();
  });

  it("offers to generate when the card has no picture", () => {
    render();

    expect(screen.getByRole("button", { name: /^Generate Image$/ })).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the existing picture and offers to replace it", () => {
    render({ word: { ...A_WORD, image_url: "https://images.test/old.png" } });

    // Regenerating is the common case — the first picture is often nearly right.
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.test/old.png");
    expect(screen.getByRole("button", { name: /regenerate image/i })).toBeInTheDocument();
  });
});

describe("a word's first picture", () => {
  it("comes from the shared store, keyed on the word, its sense and its dialect", async () => {
    const { backend } = render({ word: { ...A_WORD, dialect: "Egyptian" } });

    await generate();

    expect(backend.lastCallTo("word-asset")?.body).toEqual({
      action: "ensure",
      kind: "image",
      word: "تفاحة",
      gloss: "apple",
      dialect: "Egyptian",
    });
    expect(backend.callsTo("generate-flashcard-image")).toEqual([]);
  });

  it("names a curriculum word's dialect from its module", async () => {
    const { backend } = render({ word: { ...A_WORD, dialect_module: "Yemeni" } });

    await generate();

    expect((backend.lastCallTo("word-asset")?.body as { dialect: string }).dialect).toBe("Yemeni");
  });

  it("shows the shared picture and tells the deck about it, as it is", async () => {
    const { onImageSaved } = render();

    await generate();

    await waitFor(() => expect(onImageSaved).toHaveBeenCalledWith("word-1", SHARED_URL));
    // Not cache-busted: a shared url is never overwritten, and every learner
    // loading the same one is what lets the browser cache it.
    expect(screen.getByRole("img")).toHaveAttribute("src", SHARED_URL);
    expect(toasts.success).toHaveBeenCalledWith("Image generated!");
  });

  it("falls back to the illustrator while the store cannot answer", async () => {
    // The function not deployed yet, or a word it cannot file: the dialog
    // behaves exactly as it did before the store.
    const { backend, onImageSaved } = render({ seed: (b) => b.stubFunctionFailure("word-asset", 404) });

    await generate();

    await waitFor(() => expect(onImageSaved).toHaveBeenCalled());
    expect(backend.lastCallTo("generate-flashcard-image")?.body).toMatchObject({
      word_arabic: "تفاحة",
      word_english: "apple",
    });
    expect(onImageSaved.mock.calls[0][1]).toMatch(/^https:\/\/images\.test\/apple\.png\?t=\d+$/);
  });

  it("says so when the store's model drew nothing, without asking a second one", async () => {
    const { backend } = render({
      seed: (b) =>
        b.stubFunction("word-asset", {
          error: "IMAGE_GENERATION_FAILED",
          fallback: true,
          message: "Could not make a picture for \"apple\" — please try again.",
        }),
    });

    await generate();

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith('Could not make a picture for "apple" — please try again.'),
    );
    expect(backend.callsTo("generate-flashcard-image")).toEqual([]);
  });

  it("explains a daily limit rather than reporting it as an error", async () => {
    cap.showCapToastIfLimited.mockReturnValue(true);
    const { backend, onImageSaved } = render();

    await generate();

    // Being over the cap is a fact about the plan, not a fault. It is checked
    // before anything else in the response so the generic error path never runs.
    await waitFor(() => expect(cap.showCapToastIfLimited).toHaveBeenCalled());
    expect(toasts.error).not.toHaveBeenCalled();
    expect(onImageSaved).not.toHaveBeenCalled();
    // The store's cap is the illustrator's: a refusal there is not a reason to
    // try the other door.
    expect(backend.callsTo("generate-flashcard-image")).toEqual([]);
  });

  it("does nothing at all without a word", async () => {
    const { backend } = render({ word: null });

    await generate();

    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(backend.callsTo("generate-flashcard-image")).toEqual([]);
  });
});

describe("a picture of the learner's own", () => {
  const HAS_PICTURE = { ...A_WORD, image_url: "https://images.test/old.png" };

  it("is what a regeneration asks for: a different picture, not the shared one again", async () => {
    const { backend } = render({ word: HAS_PICTURE });

    await generate();

    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(backend.lastCallTo("generate-flashcard-image")?.body).toMatchObject({
      word_arabic: "تفاحة",
      word_english: "apple",
    });
  });

  it("is what a described picture is, and carries what the learner asked for", async () => {
    const { backend } = render();

    fireEvent.change(instructionsBox(), { target: { value: "on a wooden table, close up" } });
    await generate();

    // Never filed under the word: the next learner did not ask for a table.
    expect(backend.callsTo("word-asset")).toEqual([]);
    expect(
      (backend.lastCallTo("generate-flashcard-image")?.body as { custom_instructions: string })
        .custom_instructions,
    ).toContain("on a wooden table, close up");
  });

  it("shows the new picture and tells the deck about it", async () => {
    const { onImageSaved } = render({ word: HAS_PICTURE });

    await generate();

    await waitFor(() => expect(onImageSaved).toHaveBeenCalled());
    const [wordId, url] = onImageSaved.mock.calls[0];
    expect(wordId).toBe("word-1");
    // Cache-busted, or the browser shows the picture this one replaced.
    expect(url).toMatch(/^https:\/\/images\.test\/apple\.png\?t=\d+$/);
    expect(screen.getByRole("img")).toHaveAttribute("src", url);
    expect(toasts.success).toHaveBeenCalledWith("Image generated!");
  });

  it("says so when the generator declined", async () => {
    render({
      word: HAS_PICTURE,
      seed: (b) =>
        b.stubFunction("generate-flashcard-image", {
          fallback: true,
          message: "Image generation is resting.",
        }),
    });

    await generate();

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("Image generation is resting."),
    );
  });

  it("treats a reply with no picture in it as a failure", async () => {
    render({ word: HAS_PICTURE, seed: (b) => b.stubFunction("generate-flashcard-image", {}) });

    await generate();

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.test/old.png");
  });

  it("reports a call that failed outright", async () => {
    const { onImageSaved } = render({
      word: HAS_PICTURE,
      seed: (b) => b.stubFunctionFailure("generate-flashcard-image", 500),
    });

    await generate();

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(onImageSaved).not.toHaveBeenCalled();
  });
});

describe("the style lock", () => {
  it("explains itself before it is switched on", () => {
    render();

    // Forty cards that each look like a different app is the thing this exists
    // to prevent, and the switch alone does not say that.
    expect(
      screen.getByText(/Keep a consistent look across all your flashcard images/),
    ).toBeInTheDocument();
  });

  it("offers a style and a seed once it is on", () => {
    render();

    fireEvent.click(screen.getByRole("switch"));

    // The seed is the half that makes it a *lock*: the same description with a
    // different seed still drifts.
    expect(screen.getByPlaceholderText(/Your signature style/)).toBeInTheDocument();
    expect(screen.getByText(/Seed:/)).toBeInTheDocument();
  });

  it("folds the learner's style into what it asks for", async () => {
    const { backend } = render();
    fireEvent.click(screen.getByRole("switch"));

    fireEvent.change(screen.getByPlaceholderText(/Your signature style/), {
      target: { value: "flat pastel illustration, soft light" },
    });
    fireEvent.change(instructionsBox(), { target: { value: "on a table" } });
    await generate();

    // A locked style is the learner's look, not the deck's: never filed.
    expect(backend.callsTo("word-asset")).toEqual([]);
    const body = backend.lastCallTo("generate-flashcard-image")?.body as {
      custom_instructions: string;
    };
    expect(body.custom_instructions).toContain("on a table");
    expect(body.custom_instructions).toContain("flat pastel illustration, soft light");
  });

  it("can be given a different seed", () => {
    render();
    fireEvent.click(screen.getByRole("switch"));
    const before = screen.getByText(/Seed:/).textContent;

    fireEvent.click(screen.getByRole("button", { name: /new seed/i }));

    // A learner who dislikes the look their seed produces needs a way out of it
    // that is not "turn the whole thing off".
    expect(screen.getByText(/Seed:/).textContent).not.toBe(before);
  });

  it("remembers the style for the next card", () => {
    render();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByPlaceholderText(/Your signature style/), {
      target: { value: "flat pastel illustration" },
    });

    // Persisted rather than held in the dialog: a signature look retyped for
    // every card is not a signature look. (Asserted at the store rather than by
    // reopening, because the test harness clears storage between mounts.)
    const stored = JSON.parse(localStorage.getItem("hakiya:imageStyleLock:v1")!);
    expect(stored).toMatchObject({ enabled: true, description: "flat pastel illustration" });
    expect(stored.seed).toBeTruthy();
  });
});
