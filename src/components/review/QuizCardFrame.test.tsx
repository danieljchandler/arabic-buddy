import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, type HarnessOptions } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { PICTURE_DRAWING_WAIT_MS, QuizCardFrame, type QuizItem } from "./QuizCardFrame";

/**
 * The frame is where the ladder meets the cards. What it has to get right is
 * the hand-off: the question a card's memory state calls for, the fallback
 * when the material is missing, and one rating per card, delivered when the
 * learner moves on rather than the instant they answer.
 */

const tts = vi.hoisted(() => ({ urls: {} as Record<string, string> }));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean }) => ({
    ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
    isLoading: false,
    regenerate: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => ({ isPlaying: false, play: vi.fn(), stop: vi.fn() }),
}));

const recorder = vi.hoisted(() => ({ supported: true }));
vi.mock("@/hooks/useTakeRecorder", () => ({
  recordingSupported: () => recorder.supported,
  useTakeRecorder: () => ({ isRecording: false, start: vi.fn(async () => false), stop: vi.fn(), error: null, supported: recorder.supported }),
}));

const SENTENCE = "رحت السوق أمس";
const POOL = [
  { arabic: "بيت", english: "house", imageUrl: "https://img.test/house.png", audioUrl: "https://audio.test/house.mp3" },
  { arabic: "مدرسة", english: "school", imageUrl: "https://img.test/school.png" },
  { arabic: "مطعم", english: "restaurant", imageUrl: "https://img.test/restaurant.png" },
  { arabic: "سيارة", english: "car" },
];

const DIALOGUE = [
  { speaker: "Customer", arabic: "وين السوق؟", english: "Where is the market?" },
  { speaker: "Vendor", arabic: "السوق هناك", english: "The market is there" },
  { speaker: "Customer", arabic: "مشكور", english: "Thanks" },
  { speaker: "Vendor", arabic: "العفو", english: "You're welcome" },
  { speaker: "Customer", arabic: "مع السلامة", english: "Goodbye" },
];

const anItem = (over: Partial<QuizItem> = {}): QuizItem => ({
  id: "card-1",
  arabic: "السوق",
  english: "the market",
  sentence: { arabic: SENTENCE, english: "I went to the market yesterday" },
  direction: "recognition",
  memory: { stability: 0, repetitions: 0 },
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.urls = {};
  recorder.supported = true;
  (HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>).mockClear?.();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(
  item: QuizItem,
  over: Partial<Parameters<typeof QuizCardFrame>[0]> = {},
  harnessOptions: HarnessOptions = {},
) {
  const onGraded = vi.fn();
  const renderFlashcard = vi.fn(() => <div>the flip card</div>);
  const props = { pool: POOL, onGraded, renderFlashcard, ...over };
  const harness = renderWithProviders(<QuizCardFrame item={item} {...props} />, harnessOptions);
  cleanup = harness.cleanup;
  return {
    ...harness,
    onGraded,
    renderFlashcard,
    /** The same frame, handed the card again as the page would after a cache patch. */
    rerenderWith: (next: QuizItem) => harness.rerender(<QuizCardFrame item={next} {...props} />),
  };
}

const arabicChoices = () => screen.getAllByRole("button").filter((b) => b.getAttribute("dir") === "rtl");

describe("which question is asked", () => {
  it("asks a new word to fill the gap, with its meaning as a hint", () => {
    render(anItem());

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.getByText(/the missing word means/i)).toHaveTextContent("the market");
    expect(screen.getByRole("img", { name: /step 1 of 8/i })).toBeInTheDocument();
  });

  it("drops the hint once the word is young rather than new", () => {
    render(anItem({ memory: { stability: 3, repetitions: 1 } }));

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.queryByText(/the missing word means/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 2 of 8/i })).toBeInTheDocument();
  });

  it("asks for the meaning when there is no sentence to cut", () => {
    render(anItem({ sentence: null }));

    expect(screen.getByText("What does it mean?")).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.textContent?.trim())).toContain("the market");
  });

  it("treats a sentence without the word in it as no sentence", () => {
    render(anItem({ sentence: { arabic: "رحت المطعم أمس" } }));

    expect(screen.getByText("What does it mean?")).toBeInTheDocument();
  });

  it("plays the audio alone once the word is past the picture step", () => {
    render(anItem({ memory: { stability: 10, repetitions: 3 } }));

    expect(screen.getByText("What did you hear?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 4 of 8/i })).toBeInTheDocument();
  });

  it("asks for the picture once the word is a little settled, from the other words' pictures", () => {
    render(anItem({ imageUrl: "https://img.test/market.png", memory: { stability: 5, repetitions: 2 } }));

    expect(screen.getByText("Which picture?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 3 of 8/i })).toBeInTheDocument();
    const pictures = screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
    expect(pictures).toHaveLength(4);
    expect(pictures).toContain("the market");
    // Only words with a picture can be wrong pictures; the car has none.
    expect(pictures).not.toContain("car");
  });

  it("hears a word with no picture at the picture step", () => {
    render(anItem({ memory: { stability: 5, repetitions: 2 } }));

    expect(screen.getByText("What did you hear?")).toBeInTheDocument();
  });

  it("asks to pick the word, with its picture as the prompt, once it is heard reliably", () => {
    render(anItem({ imageUrl: "https://img.test/market.png", memory: { stability: 20, repetitions: 3 } }));

    expect(screen.getByText("Which word?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 5 of 8/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.textContent?.trim())).toContain("السوق");
  });

  it("asks for the reply from the lesson's dialogue once the word is settled", () => {
    render(anItem({ dialogue: DIALOGUE, memory: { stability: 40, repetitions: 5 } }));

    expect(screen.getByText("What would you say?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 6 of 8/i })).toBeInTheDocument();
    expect(screen.getByText("وين السوق؟")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "السوق هناك" })).toBeInTheDocument();
  });

  it("picks the word instead when the word has no dialogue", () => {
    render(anItem({ memory: { stability: 40, repetitions: 5 } }));

    expect(screen.getByText("Which word?")).toBeInTheDocument();
  });

  it("asks a production card to be said", () => {
    render(anItem({ direction: "production", memory: { stability: 2, repetitions: 1 } }));

    expect(screen.getByText("Say it in Arabic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 7 of 8/i })).toBeInTheDocument();
  });

  it("falls back to the flip card when there are too few other words", () => {
    const { renderFlashcard } = render(anItem(), { pool: POOL.slice(0, 2) });

    expect(renderFlashcard).toHaveBeenCalled();
    expect(screen.getByText("the flip card")).toBeInTheDocument();
    expect(screen.queryByText("Fill in the missing word")).not.toBeInTheDocument();
  });

  it("falls back to the flip card for a production card the device cannot record", () => {
    recorder.supported = false;
    render(anItem({ direction: "production", memory: { stability: 2, repetitions: 1 } }));

    expect(screen.getByText("the flip card")).toBeInTheDocument();
  });

  it("never offers the word itself, or a repeat, as a wrong option", () => {
    render(anItem(), { pool: [...POOL, { arabic: "السُّوق", english: "the market" }, { arabic: "بَيت", english: "a house" }] });

    const labels = arabicChoices().map((b) => b.textContent?.trim());
    expect(labels.filter((l) => l === "السوق")).toHaveLength(1);
    expect(labels).not.toContain("السُّوق");
    expect(labels.filter((l) => l === "بيت" || l === "بَيت")).toHaveLength(1);
  });
});

describe("turning an answer into a rating", () => {
  it("rates a right gap Good, once the learner moves on", () => {
    const { onGraded } = render(anItem());

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() === "السوق")!);
    expect(onGraded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onGraded).toHaveBeenCalledTimes(1);
    expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "cloze-hint", step: 1 });
  });

  it("rates a wrong gap Again", () => {
    const { onGraded } = render(anItem());

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() !== "السوق")!);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onGraded).toHaveBeenCalledWith(expect.objectContaining({ rating: "again", correct: false }));
  });

  it("rates a meaning picked with the sentence open Hard", () => {
    const { onGraded } = render(anItem({ sentence: null, memory: { stability: 10, repetitions: 3 } }), {
      pool: POOL,
    });
    // No sentence on the card means no hint to open; give it one via a
    // settled card instead.
    cleanup?.();
    const settled = render(
      anItem({ memory: { stability: 10, repetitions: 3 }, sentence: { arabic: "البيت كبير", english: "the house is big" }, arabic: "البيت", english: "the house" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /show the sentence/i }));
    fireEvent.click(screen.getAllByRole("radio").find((r) => r.textContent?.trim() === "the house")!);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(settled.onGraded).toHaveBeenCalledWith(expect.objectContaining({ rating: "hard", correct: true, format: "listen" }));
    expect(onGraded).not.toHaveBeenCalled();
  });

  it("moves on with Enter once answered, and not before", () => {
    const { onGraded } = render(anItem());

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onGraded).not.toHaveBeenCalled();

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() === "السوق")!);
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onGraded).toHaveBeenCalledTimes(1);
  });

  it("ignores the rating keys", () => {
    const { onGraded } = render(anItem());

    fireEvent.click(arabicChoices().find((b) => b.textContent?.trim() === "السوق")!);
    fireEvent.keyDown(window, { key: "3" });

    expect(onGraded).not.toHaveBeenCalled();
  });

  it("shows the combo beside the step", () => {
    render(anItem(), { combo: 4 });

    expect(screen.getByLabelText("4 in a row")).toBeInTheDocument();
  });
});

/**
 * Quiz Phase 3. "Pick the picture" (and the two later steps that show one)
 * only fire for a word that has a picture, and neither the authored tracks
 * nor a learner's saved words ship with one. The frame looks the shared store
 * up for a card that has none, and for a learner's own word at the picture
 * step has one made.
 *
 * What can go wrong here is all on the learner's side of the screen: a card
 * that hangs on a picture that never comes, a question that changes under
 * them when the picture lands, an allowance spent on a picture nobody can be
 * asked about, and a curriculum deck that starts drawing pictures it has no
 * row to keep them on.
 */
describe("a picture for a word that has none", () => {
  const STORED = "https://cdn.test/store/market-ink.png";
  const DRAWN = "https://cdn.test/drawn/market-ink.png";

  /** Settled enough for the picture step, with no picture of its own. */
  const atPictureStep = (over: Partial<QuizItem> = {}) =>
    anItem({ dialect: "Gulf", memory: { stability: 5, repetitions: 2 }, ...over });

  const filedMarket = (over: Record<string, unknown> = {}) => ({
    id: "asset-market",
    // `assetKey` for السوق / "the market": the article is folded off the sense.
    concept_key: "السوق|market",
    kind: "image",
    dialect: "Gulf",
    style_version: "ink-1",
    url: STORED,
    payload: null,
    meta: {},
    source: "authored",
    approved_at: null,
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  });

  const signedIn = (seed?: (backend: SupabaseBackend) => void): HarnessOptions => ({
    persona: "free",
    seed: (backend) => {
      backend.db.seed("word_assets", []);
      backend.stubFunction("word-asset", { asset: null, url: DRAWN, cached: false, stored: true });
      seed?.(backend);
    },
  });

  const pictures = () => screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
  const pictureOf = (label: string) =>
    screen.getByRole("radio", { name: label }).querySelector("img")?.getAttribute("src");

  describe("on the curriculum deck, which can only read", () => {
    it("shows the store's picture for a word whose row has none, and writes nothing", async () => {
      const { backend } = render(
        atPictureStep(),
        { sharedPictures: true },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(pictures()).toHaveLength(4);
      expect(pictureOf("the market")).toBe(STORED);
      // A free read of a public table: no function, no generation, no write.
      expect(backend.callsTo("word-asset")).toEqual([]);
      expect(backend.db.writes).toEqual([]);
    });

    it("hears the word instead when the store has none, and never has one drawn", async () => {
      const { backend } = render(atPictureStep(), { sharedPictures: true }, signedIn());

      expect(await screen.findByText("What did you hear?")).toBeInTheDocument();
      expect(backend.db.readsOf("word_assets")).toHaveLength(1);
      expect(backend.callsTo("word-asset")).toEqual([]);
    });

    it("uses the store's picture as the prompt on the later steps too", async () => {
      render(
        atPictureStep({ memory: { stability: 20, repetitions: 3 } }),
        { sharedPictures: true },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );

      expect(await screen.findByText("Which word?")).toBeInTheDocument();
      expect(document.querySelector(`img[src="${STORED}"]`)).not.toBeNull();
    });

    it("does not serve another dialect's picture", async () => {
      render(
        atPictureStep({ dialect: "Egyptian" }),
        { sharedPictures: true },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );
      expect(await screen.findByText("What did you hear?")).toBeInTheDocument();
    });

    it("is not held up while the store's table has not reached the live project", async () => {
      render(
        atPictureStep(),
        { sharedPictures: true },
        signedIn((b) =>
          b.db.failAlways("word_assets", 404, {
            code: "PGRST205",
            message: "Could not find the table 'public.word_assets' in the schema cache",
          }),
        ),
      );
      expect(await screen.findByText("What did you hear?")).toBeInTheDocument();
    });

    it("asks the store nothing for a card with a picture of its own, or on a step that shows none", async () => {
      const own = render(atPictureStep({ imageUrl: "https://img.test/market.png" }), { sharedPictures: true }, signedIn());
      expect(screen.getByText("Which picture?")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(own.backend.db.readsOf("word_assets")).toEqual([]);
      cleanup?.();

      // Step 1 is a gap: no picture in it, so nothing to look up.
      const gap = render(anItem({ dialect: "Gulf" }), { sharedPictures: true }, signedIn());
      expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(gap.backend.db.readsOf("word_assets")).toEqual([]);
    });

    it("never deals the word's own picture as a wrong one", async () => {
      // Another word in the pool carries the very picture the store holds.
      render(
        atPictureStep(),
        { sharedPictures: true, pool: [...POOL, { arabic: "دكان", english: "shop", imageUrl: STORED }, { arabic: "باب", english: "door", imageUrl: "https://img.test/door.png" }] },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );

      await screen.findByText("Which picture?");
      expect(pictures()).not.toContain("shop");
      expect(screen.getAllByRole("radio").filter((r) => r.querySelector(`img[src="${STORED}"]`))).toHaveLength(1);
    });
  });

  describe("on a learner's own words", () => {
    it("has the picture drawn, asks the picture question with it, and hands it over to be kept", async () => {
      const onPictureMade = vi.fn();
      const { backend } = render(
        atPictureStep(),
        { onPictureMade },
        signedIn((b) => b.db.delayFunction("word-asset", 40)),
      );

      // Said while it is drawn, since this wait is long enough to wonder about.
      expect(await screen.findByRole("status", { name: "Drawing a picture for this word" })).toBeInTheDocument();

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(pictureOf("the market")).toBe(DRAWN);
      expect(pictures()).toHaveLength(4);

      // Asked for by the word alone, once.
      expect(backend.callsTo("word-asset")).toHaveLength(1);
      expect(backend.lastCallTo("word-asset")?.body).toEqual({
        action: "ensure",
        kind: "image",
        word: "السوق",
        gloss: "the market",
        dialect: "Gulf",
      });
      expect(onPictureMade).toHaveBeenCalledTimes(1);
      expect(onPictureMade).toHaveBeenCalledWith(DRAWN);
    });

    it("rates the answer on the question it was asked", async () => {
      const { onGraded } = render(atPictureStep(), { onPictureMade: vi.fn() }, signedIn());

      fireEvent.click(await screen.findByRole("radio", { name: "the market" }));
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));

      expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "picture-choice", step: 3 });
    });

    it("takes the store's picture when there is one, for nothing, and keeps it on the row", async () => {
      const onPictureMade = vi.fn();
      const { backend } = render(
        atPictureStep(),
        { onPictureMade },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(pictureOf("the market")).toBe(STORED);
      expect(backend.callsTo("word-asset")).toEqual([]);
      await waitFor(() => expect(onPictureMade).toHaveBeenCalledWith(STORED));
      expect(onPictureMade).toHaveBeenCalledTimes(1);
    });

    it("does not hold the card for a picture it could not ask about, but still has it drawn", async () => {
      // Two other words with pictures: no four to deal. The learner is asked
      // the fallback at once; the picture lands for next time.
      const onPictureMade = vi.fn();
      const { backend } = render(
        atPictureStep(),
        { onPictureMade, pool: POOL.filter((w) => w.arabic !== "مطعم") },
        signedIn((b) => b.db.delayFunction("word-asset", 40)),
      );

      expect(await screen.findByText("What did you hear?")).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: /drawing a picture/i })).not.toBeInTheDocument();

      await waitFor(() => expect(onPictureMade).toHaveBeenCalledWith(DRAWN));
      expect(backend.callsTo("word-asset")).toHaveLength(1);
      // And the question on screen is still the one that was asked.
      expect(screen.getByText("What did you hear?")).toBeInTheDocument();
      expect(screen.queryByText("Which picture?")).not.toBeInTheDocument();
    });

    it("only has a picture drawn at the picture step", async () => {
      // "Pick the word" and "say it" show a picture when there is one, and
      // do not spend the learner's allowance to get one.
      const onPictureMade = vi.fn();
      const { backend } = render(
        atPictureStep({ memory: { stability: 20, repetitions: 3 } }),
        { onPictureMade },
        signedIn(),
      );

      expect(await screen.findByText("Which word?")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(backend.callsTo("word-asset")).toEqual([]);
      expect(onPictureMade).not.toHaveBeenCalled();
    });

    it("goes on without a picture, quietly, when the day's allowance is spent", async () => {
      const onPictureMade = vi.fn();
      render(atPictureStep(), { onPictureMade }, signedIn((b) => b.stubFunctionCapped("word-asset")));

      expect(await screen.findByText("What did you hear?")).toBeInTheDocument();
      expect(onPictureMade).not.toHaveBeenCalled();
      // The learner asked for nothing, so nothing tells them a limit was hit.
      expect(screen.queryByText(/limit/i)).not.toBeInTheDocument();
    });

    it("goes on without a picture when none could be drawn, or the function is not deployed", async () => {
      for (const seed of [
        (b: SupabaseBackend) => b.stubFunction("word-asset", { error: "IMAGE_GENERATION_FAILED", fallback: true, message: "no" }),
        (b: SupabaseBackend) => b.stubFunctionFailure("word-asset", 404),
        (b: SupabaseBackend) => b.stubFunctionFailure("word-asset", 500),
      ]) {
        const onPictureMade = vi.fn();
        render(atPictureStep(), { onPictureMade }, signedIn(seed));
        expect(await screen.findByText("What did you hear?")).toBeInTheDocument();
        expect(onPictureMade).not.toHaveBeenCalled();
        cleanup?.();
        cleanup = undefined;
      }
    });

    it("keeps the question it asked when the picture reaches the card afterwards", async () => {
      // The page patches the deck once the picture is saved, so the same card
      // comes back with a picture while its fallback question is on screen.
      // Here the first drawing failed and the fallback was asked; with four
      // pictures to deal, a card that re-read its picture would now turn
      // into the picture question under the learner's finger.
      const item = atPictureStep();
      const { rerenderWith } = render(
        item,
        { onPictureMade: vi.fn() },
        signedIn((b) => b.stubFunctionFailure("word-asset", 500)),
      );
      expect(await screen.findByText("What did you hear?")).toBeInTheDocument();

      rerenderWith({ ...item, imageUrl: DRAWN });

      expect(screen.getByText("What did you hear?")).toBeInTheDocument();
      expect(screen.queryByText("Which picture?")).not.toBeInTheDocument();
    });

    it("deals the next card with the picture it has by then", async () => {
      const item = atPictureStep();
      const { rerenderWith, backend } = render(item, { onPictureMade: vi.fn() }, signedIn());
      await screen.findByText("Which picture?");

      // A different card, with its own picture: asked at once, nothing drawn.
      rerenderWith(atPictureStep({ id: "card-2", arabic: "الباب", english: "the door", imageUrl: "https://img.test/door.png" }));

      expect(screen.getByText("Which picture?")).toBeInTheDocument();
      expect(pictureOf("the door")).toBe("https://img.test/door.png");
      expect(backend.callsTo("word-asset")).toHaveLength(1);
    });

    it("waits for the pool before deciding there is nothing to ask the picture about", async () => {
      // An empty pool while it loads must not read as "no four to deal".
      const onPictureMade = vi.fn();
      const item = atPictureStep();
      const onGraded = vi.fn();
      const flip = () => <div>the flip card</div>;
      const harness = renderWithProviders(
        <QuizCardFrame item={item} pool={[]} ready={false} onGraded={onGraded} renderFlashcard={flip} onPictureMade={onPictureMade} />,
        signedIn(),
      );
      cleanup = harness.cleanup;

      await waitFor(() => expect(onPictureMade).toHaveBeenCalledWith(DRAWN));
      expect(screen.getByRole("status")).toBeInTheDocument();

      harness.rerender(
        <QuizCardFrame item={item} pool={POOL} ready onGraded={onGraded} renderFlashcard={flip} onPictureMade={onPictureMade} />,
      );

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(pictureOf("the market")).toBe(DRAWN);
    });

    it("gives up waiting on a slow drawing, asks the fallback, and still keeps the picture when it comes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const onPictureMade = vi.fn();
        render(
          atPictureStep(),
          { onPictureMade },
          signedIn((b) => b.db.delayFunction("word-asset", PICTURE_DRAWING_WAIT_MS + 5_000)),
        );
        expect(await screen.findByRole("status", { name: "Drawing a picture for this word" })).toBeInTheDocument();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(PICTURE_DRAWING_WAIT_MS + 100);
        });
        expect(screen.getByText("What did you hear?")).toBeInTheDocument();
        expect(onPictureMade).not.toHaveBeenCalled();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(6_000);
        });
        expect(onPictureMade).toHaveBeenCalledWith(DRAWN);
        // Not swapped in under the learner.
        expect(screen.getByText("What did you hear?")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("looks nothing up, and has nothing drawn, on a deck that did not ask for pictures", async () => {
    // The phrase deck: a phrase has no picture to find.
    const { backend } = render(atPictureStep(), {}, signedIn());

    expect(screen.getByText("What did you hear?")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.db.readsOf("word_assets")).toEqual([]);
    expect(backend.callsTo("word-asset")).toEqual([]);
  });
});
