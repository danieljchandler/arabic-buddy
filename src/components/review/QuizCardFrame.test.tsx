import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, type HarnessOptions } from "@/test/support/react/harness";
import type { QuizPoolEntry } from "@/hooks/useQuizPool";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import {
  ANIMATION_LOOKUP_WAIT_MS,
  DIALOGUE_WRITING_WAIT_MS,
  PICTURE_DRAWING_WAIT_MS,
  PICTURE_LOOKUP_WAIT_MS,
  QuizCardFrame,
  STORY_LINE_WRITING_WAIT_MS,
  type QuizItem,
} from "./QuizCardFrame";

/**
 * The frame is where the ladder meets the cards. What it has to get right is
 * the hand-off: the question a card's memory state calls for, the fallback
 * when the material is missing, and one rating per card, delivered when the
 * learner moves on rather than the instant they answer.
 */

const tts = vi.hoisted(() => ({
  urls: {} as Record<string, string>,
  asked: [] as Array<{ text: string; skip?: boolean; dialect?: string }>,
}));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean; dialect?: string }) => {
    tts.asked.push(options);
    return {
      ttsUrl: options.skip ? null : (tts.urls[options.text] ?? null),
      isLoading: false,
      regenerate: vi.fn(),
    };
  },
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

// The line said before the word's line does not say the word: one that did
// ("وين السوق؟") would hand the learner the answer, and is never asked.
const DIALOGUE = [
  { speaker: "Customer", arabic: "وين نشتري خضار؟", english: "Where do we buy vegetables?" },
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
  tts.asked = [];
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
    /** The same frame, handed the card (and the pool) again as the page would after a cache patch. */
    rerenderWith: (next: QuizItem, nextProps: Partial<Parameters<typeof QuizCardFrame>[0]> = {}) =>
      harness.rerender(<QuizCardFrame item={next} {...props} {...nextProps} />),
  };
}

const arabicChoices = () => screen.getAllByRole("button").filter((b) => b.getAttribute("dir") === "rtl");

describe("which question is asked", () => {
  it("asks a new word to fill the gap, with its meaning as a hint", () => {
    render(anItem());

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.getByText(/the missing word means/i)).toHaveTextContent("the market");
    expect(screen.getByRole("img", { name: /step 1 of 10/i })).toBeInTheDocument();
  });

  it("drops the hint once the word is young rather than new", () => {
    render(anItem({ memory: { stability: 3, repetitions: 1 } }));

    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.queryByText(/the missing word means/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 2 of 10/i })).toBeInTheDocument();
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
    expect(screen.getByRole("img", { name: /step 4 of 10/i })).toBeInTheDocument();
  });

  it("asks for the picture once the word is a little settled, from the other words' pictures", () => {
    render(anItem({ imageUrl: "https://img.test/market.png", memory: { stability: 5, repetitions: 2 } }));

    expect(screen.getByText("Which picture?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 3 of 10/i })).toBeInTheDocument();
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
    expect(screen.getByRole("img", { name: /step 5 of 10/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.textContent?.trim())).toContain("السوق");
  });

  it("asks for the reply from the lesson's dialogue once the word is settled", () => {
    render(anItem({ dialogue: DIALOGUE, memory: { stability: 40, repetitions: 5 } }));

    expect(screen.getByText("What would you say?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 6 of 10/i })).toBeInTheDocument();
    expect(screen.getByText("وين نشتري خضار؟")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "السوق هناك" })).toBeInTheDocument();
  });

  it("picks the word instead when the word has no dialogue", () => {
    render(anItem({ memory: { stability: 40, repetitions: 5 } }));

    expect(screen.getByText("Which word?")).toBeInTheDocument();
  });

  it("asks no reply after a line that already says the word, bare or with something attached", () => {
    for (const opener of ["وين السوق؟", "رحنا للسوق؟"]) {
      const { unmount } = render(
        anItem({
          dialogue: [{ speaker: "Customer", arabic: opener, english: "x" }, ...DIALOGUE.slice(1)],
          memory: { stability: 40, repetitions: 5 },
        }),
      );
      expect(screen.queryByText("What would you say?"), opener).not.toBeInTheDocument();
      expect(screen.getByText("Which word?")).toBeInTheDocument();
      unmount();
      cleanup?.();
      cleanup = undefined;
    }
  });

  it("asks a production card to be said", () => {
    render(anItem({ direction: "production", memory: { stability: 2, repetitions: 1 } }));

    expect(screen.getByText("Say it in Arabic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 7 of 10/i })).toBeInTheDocument();
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
    expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "cloze-hint", step: 1, item: expect.objectContaining({ id: "card-1" }) });
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
 * "Why not this one?" (quiz Phase 7). The cards build the question; what the
 * frame owes them is the other half of the pair the learner never saw: the
 * word a wrong meaning belongs to, and the word behind a wrong picture.
 */
describe("why not this one?", () => {
  function AskedProbe() {
    const { pendingAsk } = useAiAssistant();
    return <div data-testid="asked">{pendingAsk?.text ?? ""}</div>;
  }

  function renderAsking(item: QuizItem, pool: ReadonlyArray<QuizPoolEntry> = POOL) {
    const onGraded = vi.fn();
    const harness = renderWithProviders(
      <>
        <QuizCardFrame item={item} pool={pool} onGraded={onGraded} renderFlashcard={() => <div>the flip card</div>} />
        <AskedProbe />
      </>,
    );
    cleanup = harness.cleanup;
  }

  const WORDS: Record<string, string> = { house: "بيت", school: "مدرسة", restaurant: "مطعم", car: "سيارة" };
  const askWhy = () => fireEvent.click(screen.getByRole("button", { name: /why not this one/i }));

  it("names the word a wrong meaning belongs to", () => {
    renderAsking(anItem({ sentence: null, memory: { stability: 10, repetitions: 3 } }));
    expect(screen.getByText("What did you hear?")).toBeInTheDocument();
    const wrong = screen.getAllByRole("radio").map((r) => r.textContent!.trim()).find((m) => m !== "the market")!;
    fireEvent.click(screen.getByRole("radio", { name: wrong }));

    askWhy();
    expect(screen.getByTestId("asked")).toHaveTextContent(`picked "${wrong}" (that's «${WORDS[wrong]}»)`);
  });

  // Three other meanings, so all three are dealt and "house" can be picked.
  it("names neither word when two of the others share the meaning picked", () => {
    const pool = [
      { arabic: "بيت", english: "house" },
      { arabic: "دار", english: "house" },
      { arabic: "مدرسة", english: "school" },
      { arabic: "سيارة", english: "car" },
    ];
    renderAsking(anItem({ sentence: null }), pool);
    fireEvent.click(screen.getByRole("radio", { name: "house" }));

    askWhy();
    expect(screen.getByTestId("asked")).toHaveTextContent('I picked "house" for «السوق»');
    expect(screen.getByTestId("asked")).not.toHaveTextContent("that's");
  });

  it("names the word when the meaning's two words are one word spelled two ways", () => {
    const pool = [
      { arabic: "بيت", english: "house" },
      { arabic: "بَيْت", english: "house" },
      { arabic: "مدرسة", english: "school" },
      { arabic: "سيارة", english: "car" },
    ];
    renderAsking(anItem({ sentence: null }), pool);
    fireEvent.click(screen.getByRole("radio", { name: "house" }));

    askWhy();
    expect(screen.getByTestId("asked")).toHaveTextContent(`I picked "house" (that's «بيت») for «السوق»`);
  });

  it("never deals another gloss of the word itself as a wrong meaning, nor names the word as the other one", () => {
    // A mixed deck holds the word more than once, under other glosses:
    // picking one would be a right answer graded Again. Five of them beside
    // three other words, so a deal that let them in would deal some.
    const OWN = ["the souq", "souq", "bazaar", "marketplace", "the bazaar"];
    const pool = [
      ...OWN.map((english, i) => ({ arabic: i % 2 ? "السُّوق" : "السوق", english })),
      { arabic: "بيت", english: "house" },
      { arabic: "مدرسة", english: "school" },
      { arabic: "سيارة", english: "car" },
    ];
    renderAsking(anItem({ sentence: null }), pool);
    const options = screen.getAllByRole("radio").map((r) => r.textContent!.trim());
    expect(options).toHaveLength(4);
    for (const gloss of OWN) expect(options).not.toContain(gloss);

    const wrong = options.find((m) => m !== "the market")!;
    fireEvent.click(screen.getByRole("radio", { name: wrong }));
    askWhy();
    expect(screen.getByTestId("asked")).not.toHaveTextContent("that's «السوق»");
    expect(screen.getByTestId("asked")).not.toHaveTextContent("that's «السُّوق»");
    expect(screen.getByTestId("asked")).toHaveTextContent(`(that's «${WORDS[wrong]}»)`);
  });

  it("names the word behind a wrong picture", () => {
    renderAsking(anItem({ imageUrl: "https://img.test/market.png", memory: { stability: 5, repetitions: 2 } }));
    expect(screen.getByText("Which picture?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "house" }));

    askWhy();
    expect(screen.getByTestId("asked")).toHaveTextContent(
      'I picked the picture of "house" (that\'s «بيت») for «السوق», but «السوق» means "the market".',
    );
  });
});

/**
 * The boss card (quiz Phase 7). The page marks the session's first card when
 * it is the recognition leech with the most lapses; the frame asks it as a
 * first look whatever its memory, shows its picture and keeps its memory hook
 * a tap away, grades it as any first look (the hook, opened first, is help),
 * reports its own step rather than the first look's, and celebrates a win as
 * the learner moves on.
 */
describe("the boss card", () => {
  const HOOK = "Picture a souq stall selling socks";
  // Settled enough to be heard alone (step 4) if it were not the boss.
  const aBoss = (over: Partial<QuizItem> = {}) =>
    anItem({
      memory: { stability: 10, repetitions: 4 },
      imageUrl: "https://img.test/market.png",
      boss: { lapses: 7, mnemonic: HOOK, pictureUrl: "https://img.test/hook.png" },
      ...over,
    });
  const continueOn = () => fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  const pick = (right: boolean) =>
    fireEvent.click(arabicChoices().find((b) => (b.textContent?.trim() === "السوق") === right)!);
  const RESCUE = <div>the rescue panel</div>;

  it("opens on a first look, whatever its memory, with its hook and picture behind one tap", () => {
    const { container } = render(aBoss());

    expect(screen.getByRole("region", { name: "Boss card" })).toHaveTextContent("missed 7 times");
    expect(screen.getByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.getByText(/the missing word means/i)).toHaveTextContent("the market");
    expect(screen.getByRole("img", { name: /step 1 of 10/i })).toBeInTheDocument();
    // Neither the hook nor its picture is in view before the answer.
    expect(screen.queryByText(HOOK)).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://img.test/hook.png"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show your memory hook/i }));
    expect(screen.getByText(HOOK)).toBeInTheDocument();
    // The hook's picture, not the word's.
    expect(container.querySelector('img[src="https://img.test/hook.png"]')).not.toBeNull();
  });

  it("never shows the picture beside the meaning question, where it would be the answer", () => {
    const { container } = render(aBoss({ sentence: null, boss: { lapses: 3, mnemonic: null, pictureUrl: null } }));

    expect(screen.getByText("What does it mean?")).toBeInTheDocument();
    expect(container.querySelector('img[src="https://img.test/market.png"]')).toBeNull();
    expect(screen.getByRole("button", { name: /show its picture/i })).toBeInTheDocument();
  });

  it("is Good when beaten and reports its own step, with the boss on the card for the page to celebrate", () => {
    const { onGraded, container } = render(aBoss());
    pick(true);

    // The hook and its picture are the lesson once the answer is in.
    expect(screen.getByText(HOOK)).toBeInTheDocument();
    expect(container.querySelector('img[src="https://img.test/hook.png"]')).not.toBeNull();
    continueOn();

    expect(onGraded).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: "good",
        correct: true,
        format: "cloze-hint",
        step: 4,
        item: expect.objectContaining({ boss: expect.objectContaining({ lapses: 7 }) }),
      }),
    );
  });

  it("counts the hook, opened before the answer, as help: Hard", () => {
    const { onGraded } = render(aBoss());
    fireEvent.click(screen.getByRole("button", { name: /show your memory hook/i }));
    pick(true);
    continueOn();

    expect(onGraded).toHaveBeenCalledWith(expect.objectContaining({ rating: "hard", correct: true }));
  });

  it("is Again when it wins", () => {
    const { onGraded } = render(aBoss());
    pick(false);
    continueOn();

    expect(onGraded).toHaveBeenCalledWith(expect.objectContaining({ rating: "again", correct: false }));
  });

  it("holds the rescue panel back until the boss is answered, since it prints the hook", () => {
    render(aBoss(), { leechPanel: RESCUE });
    expect(screen.queryByText("the rescue panel")).not.toBeInTheDocument();
    pick(true);
    expect(screen.getByText("the rescue panel")).toBeInTheDocument();
  });

  it("shows the rescue panel from the start on any other card, and on the flip card", () => {
    const { unmount } = render(anItem(), { leechPanel: RESCUE });
    expect(screen.getByText("the rescue panel")).toBeInTheDocument();
    unmount();
    cleanup?.();
    // Too few other words for a question: the flip card, no boss, the panel.
    render(aBoss(), { leechPanel: RESCUE, pool: POOL.slice(0, 1) });
    expect(screen.getByText("the flip card")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Boss card" })).not.toBeInTheDocument();
    expect(screen.getByText("the rescue panel")).toBeInTheDocument();
  });

  it("offers no tap when there is neither hook nor picture", () => {
    render(aBoss({ imageUrl: null, boss: { lapses: 1, mnemonic: null, pictureUrl: null } }));
    expect(screen.getByRole("region", { name: "Boss card" })).toHaveTextContent("missed once");
    expect(screen.queryByRole("button", { name: /memory hook|its picture/i })).not.toBeInTheDocument();
  });

  it("is never a production card: that one is asked as itself", () => {
    render(aBoss({ direction: "production", memory: { stability: 5, repetitions: 2 } }));
    expect(screen.queryByRole("region", { name: "Boss card" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 7 of 10/i })).toBeInTheDocument();
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

    it("looks the store up on the steps that fall back onto a picture as well", async () => {
      // Step 6 with no dialogue is "pick the word", from the picture.
      render(
        atPictureStep({ memory: { stability: 40, repetitions: 5 } }),
        { sharedPictures: true },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );
      expect(await screen.findByText("Which word?")).toBeInTheDocument();
      expect(document.querySelector(`img[src="${STORED}"]`)).not.toBeNull();
      cleanup?.();

      // With a dialogue the step is the reply, which shows no picture: nothing to look up.
      const reply = render(
        atPictureStep({ dialogue: DIALOGUE, memory: { stability: 40, repetitions: 5 } }),
        { sharedPictures: true },
        signedIn(),
      );
      expect(screen.getByText("What would you say?")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(reply.backend.db.readsOf("word_assets")).toEqual([]);
    });

    it("does not wait on a store that does not answer", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(
          atPictureStep(),
          { sharedPictures: true },
          signedIn((b) => {
            b.db.seed("word_assets", [filedMarket()]);
            b.db.delay("word_assets", PICTURE_LOOKUP_WAIT_MS + 3_000);
          }),
        );
        expect(screen.getByRole("status", { name: "Preparing the question" })).toBeInTheDocument();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(PICTURE_LOOKUP_WAIT_MS + 100);
        });
        expect(screen.getByText("What did you hear?")).toBeInTheDocument();

        // The answer that comes too late is for the next time the card is dealt.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4_000);
        });
        expect(screen.getByText("What did you hear?")).toBeInTheDocument();
        expect(screen.queryByText("Which picture?")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
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

    it("hands the picture over once, though the store's lookup finds it again once it is filed", async () => {
      // The real function files what it draws. The ask invalidates the
      // lookup, the lookup then finds the new row, and that is the same
      // picture arriving a second way.
      const onPictureMade = vi.fn();
      const { backend } = render(
        atPictureStep(),
        { onPictureMade },
        signedIn((b) =>
          b.stubFunction("word-asset", ({ db }) => {
            db.add("word_assets", filedMarket({ url: DRAWN, source: "generated" }));
            return { asset: { id: "asset-market" }, url: DRAWN, cached: false, stored: true };
          }),
        ),
      );

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      await waitFor(() => expect(backend.db.readsOf("word_assets").length).toBeGreaterThan(1));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(onPictureMade).toHaveBeenCalledTimes(1);
      expect(onPictureMade).toHaveBeenCalledWith(DRAWN);
    });

    it("rates the answer on the question it was asked", async () => {
      const { onGraded } = render(atPictureStep(), { onPictureMade: vi.fn() }, signedIn());

      fireEvent.click(await screen.findByRole("radio", { name: "the market" }));
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));

      expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "picture-choice", step: 3, item: expect.objectContaining({ id: "card-1" }) });
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

    it("keeps the question, and the pictures beside it, when another word's picture lands in the pool", async () => {
      // The page patches the pool when it saves a picture, so the next card
      // can deal it. A card already on screen must not be re-dealt from it.
      const thin = POOL.filter((w) => w.arabic !== "مطعم");
      const item = atPictureStep({ imageUrl: "https://img.test/market.png" });
      const { rerenderWith, onGraded } = render(item, { pool: thin });
      // Two other pictures: not enough for the picture question.
      expect(screen.getByText("What did you hear?")).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("radio").find((r) => r.textContent?.trim() === "the market")!);

      // A third picture arrives while the answered card waits for Continue.
      rerenderWith(item, { pool: POOL });

      expect(screen.getByText("What did you hear?")).toBeInTheDocument();
      expect(screen.queryByText("Which picture?")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
      expect(onGraded).toHaveBeenCalledWith(expect.objectContaining({ format: "listen", rating: "good" }));
    });

    it("does not swap the wrong pictures of a question already on screen", async () => {
      const item = atPictureStep({ imageUrl: "https://img.test/market.png" });
      const { rerenderWith } = render(item);
      const before = pictures();
      expect(before).toHaveLength(4);

      rerenderWith(item, {
        pool: [
          { arabic: "باب", english: "door", imageUrl: "https://img.test/door.png" },
          { arabic: "شباك", english: "window", imageUrl: "https://img.test/window.png" },
          { arabic: "كرسي", english: "chair", imageUrl: "https://img.test/chair.png" },
          ...POOL,
        ],
      });

      expect(pictures()).toEqual(before);
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

    it("waits for the pool before deciding whether a picture is worth drawing", async () => {
      // An empty pool while it loads is not yet "too few words", either way:
      // nothing is drawn on the strength of it, and nothing is given up on.
      const onPictureMade = vi.fn();
      const item = atPictureStep();
      const onGraded = vi.fn();
      const flip = () => <div>the flip card</div>;
      const harness = renderWithProviders(
        <QuizCardFrame item={item} pool={[]} ready={false} onGraded={onGraded} renderFlashcard={flip} onPictureMade={onPictureMade} />,
        signedIn(),
      );
      cleanup = harness.cleanup;

      await waitFor(() => expect(harness.backend.db.readsOf("word_assets")).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(harness.backend.callsTo("word-asset")).toEqual([]);

      harness.rerender(
        <QuizCardFrame item={item} pool={POOL} ready onGraded={onGraded} renderFlashcard={flip} onPictureMade={onPictureMade} />,
      );

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(pictureOf("the market")).toBe(DRAWN);
      expect(onPictureMade).toHaveBeenCalledWith(DRAWN);
    });

    it("has nothing drawn for a deck too thin for the quiz to ask anything", async () => {
      // Two other words: every card is the flip card. A picture nobody is
      // about to be asked about is not worth the learner's allowance yet,
      // and must not pop onto the flip card either.
      const onPictureMade = vi.fn();
      const { backend, renderFlashcard } = render(
        atPictureStep(),
        { onPictureMade, pool: POOL.slice(0, 2) },
        signedIn(),
      );

      expect(await screen.findByText("the flip card")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(renderFlashcard).toHaveBeenCalled();
      expect(backend.callsTo("word-asset")).toEqual([]);
      expect(onPictureMade).not.toHaveBeenCalled();
    });

    it("still keeps a picture the store already had, on a deck too thin to ask about it", async () => {
      // A free read; the learner's word list shows it from now on.
      const onPictureMade = vi.fn();
      const { backend } = render(
        atPictureStep(),
        { onPictureMade, pool: POOL.slice(0, 2) },
        signedIn((b) => b.db.seed("word_assets", [filedMarket()])),
      );

      expect(await screen.findByText("the flip card")).toBeInTheDocument();
      await waitFor(() => expect(onPictureMade).toHaveBeenCalledWith(STORED));
      expect(backend.callsTo("word-asset")).toEqual([]);
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

describe("an exchange for a word its lesson has no line for", () => {
  // Steps 6 and 9 ask from a dialogue. A word its lesson's dialogue never
  // uses gets the shared store's exchange for it (two lines, the second
  // using the word), or one written for it; the wrong replies on step 6 are
  // the other words' stored replies.
  const EXCHANGE = {
    lines: [
      { speaker: "Friend", arabic: "وين رحت أمس؟", english: "Where did you go yesterday?", transliteration: "" },
      { speaker: "You", arabic: "رحت السوق مع أخوي", english: "I went to the market with my brother", transliteration: "" },
    ],
  };
  const OTHER_REPLIES = ["ايه، البيت قريب", "المدرسة بعيدة شوي", "المطعم سكر بدري"];
  /** The pool, with three other words' stored replies. */
  const REPLY_POOL = POOL.map((entry, i) =>
    i < OTHER_REPLIES.length ? { ...entry, dialogueLine: { speaker: "Friend", arabic: OTHER_REPLIES[i], english: "" } } : entry,
  );

  const filedExchange = (over: Record<string, unknown> = {}) => ({
    id: "talk-market",
    concept_key: "السوق|market",
    kind: "dialogue",
    dialect: "Gulf",
    style_version: "text-1",
    url: null,
    payload: EXCHANGE,
    meta: {},
    source: "generated",
    approved_at: null,
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  });
  const WRITTEN = { asset: { id: "talk-market", payload: EXCHANGE }, url: null, cached: false, stored: true };

  /** Settled past the word step, on recognition: "answer the line". */
  const atReplyStep = (over: Partial<QuizItem> = {}) => anItem({ dialect: "Gulf", memory: { stability: 40, repetitions: 6 }, ...over });
  /** Settled past the line step, on production: "say the reply". */
  const atSayReplyStep = (over: Partial<QuizItem> = {}) =>
    anItem({ dialect: "Gulf", direction: "production", memory: { stability: 40, repetitions: 6 }, ...over });

  const signedIn = (seed?: (backend: SupabaseBackend) => void): HarnessOptions => ({
    persona: "free",
    seed: (backend) => {
      backend.db.seed("word_assets", []);
      backend.stubFunction("word-asset", WRITTEN);
      seed?.(backend);
    },
  });

  const replies = () => screen.getAllByRole("radio").map((r) => r.textContent ?? "");

  it("asks the reply from the store's exchange, with the other words' stored replies as the wrong ones", async () => {
    const { backend, onGraded } = render(
      atReplyStep(),
      { pool: REPLY_POOL, storedDialogues: true },
      signedIn((b) => b.db.seed("word_assets", [filedExchange()])),
    );

    expect(await screen.findByText("What would you say?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 6 of 10/i })).toBeInTheDocument();
    expect(screen.getByText("وين رحت أمس؟")).toBeInTheDocument();
    expect(replies()).toHaveLength(4);
    expect(replies().some((text) => text.includes("رحت السوق مع أخوي"))).toBe(true);
    for (const wrong of OTHER_REPLIES) expect(replies().some((text) => text.includes(wrong))).toBe(true);
    // Found in the store: a free read, nothing written.
    expect(backend.callsTo("word-asset")).toEqual([]);

    fireEvent.click(screen.getByRole("radio", { name: /رحت السوق مع أخوي/ }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "reply-choice", step: 6, item: expect.objectContaining({ id: "card-1" }) });
  });

  it("has an exchange written for a word with none, waits for it, and asks with it", async () => {
    const { backend } = render(
      atReplyStep(),
      { pool: REPLY_POOL, storedDialogues: true },
      signedIn((b) => b.db.delayFunction("word-asset", 200)),
    );

    expect(await screen.findByRole("status", { name: "Writing a line for this word" })).toBeInTheDocument();
    expect(await screen.findByText("What would you say?")).toBeInTheDocument();
    expect(screen.getByText("وين رحت أمس؟")).toBeInTheDocument();

    // Asked for once, by the word alone: never the sentence it was saved
    // from, which is the learner's own text.
    expect(backend.callsTo("word-asset")).toHaveLength(1);
    expect(backend.lastCallTo("word-asset")?.body).toEqual({
      action: "ensure",
      kind: "dialogue",
      word: "السوق",
      gloss: "the market",
      dialect: "Gulf",
    });
  });

  it("picks the word instead when no exchange can be had, quietly", async () => {
    for (const seed of [
      (b: SupabaseBackend) => b.stubFunctionCapped("word-asset"),
      (b: SupabaseBackend) => b.stubFunction("word-asset", { error: "msa_leak", fallback: true, message: "no" }),
      (b: SupabaseBackend) => b.stubFunctionFailure("word-asset", 503, { error: "store_not_ready", fallback: true }),
      (b: SupabaseBackend) => b.stubFunctionFailure("word-asset", 500),
    ]) {
      const { unmount } = render(atReplyStep(), { pool: REPLY_POOL, storedDialogues: true }, signedIn(seed));
      expect(await screen.findByText("Which word?")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // Unmounted, so the next pass cannot find this one's question instead of its own.
      unmount();
      cleanup?.();
      cleanup = undefined;
    }
  });

  it("picks the word while the store's table has not reached the live project, and writes nothing", async () => {
    // The real function makes no exchange then, and charges nothing; the
    // lookup reads the missing table as a miss.
    const { backend } = render(
      atReplyStep(),
      { pool: REPLY_POOL, storedDialogues: true },
      signedIn((b) => {
        b.db.failAlways("word_assets", 404, {
          code: "PGRST205",
          message: "Could not find the table 'public.word_assets' in the schema cache",
        });
        b.stubFunctionFailure("word-asset", 503, { error: "store_not_ready", fallback: true });
      }),
    );
    expect(await screen.findByText("Which word?")).toBeInTheDocument();
    expect(backend.db.writes).toEqual([]);
  });

  it("asks pick-the-word at once while too few other words have stored replies, and writes the exchange behind it", async () => {
    const { backend } = render(
      atReplyStep(),
      { pool: POOL, storedDialogues: true },
      signedIn((b) => b.db.delayFunction("word-asset", 200)),
    );

    expect(await screen.findByText("Which word?")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Writing a line for this word" })).not.toBeInTheDocument();
    await waitFor(() => expect(backend.callsTo("word-asset")).toHaveLength(1));
  });

  it("keeps the question it asked when the exchange arrives after it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        atReplyStep(),
        { pool: REPLY_POOL, storedDialogues: true },
        signedIn((b) => b.db.delayFunction("word-asset", DIALOGUE_WRITING_WAIT_MS + 5_000)),
      );
      expect(await screen.findByRole("status", { name: "Writing a line for this word" })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(DIALOGUE_WRITING_WAIT_MS + 100);
      });
      expect(screen.getByText("Which word?")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      // Not swapped in under the learner: it is for the next time.
      expect(screen.getByText("Which word?")).toBeInTheDocument();
      expect(screen.queryByText("What would you say?")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the lesson's own dialogue when a line of it uses the word, and nothing of the store", async () => {
    const { backend } = render(
      atReplyStep({ dialogue: DIALOGUE }),
      { pool: REPLY_POOL, storedDialogues: true },
      signedIn((b) => b.db.seed("word_assets", [filedExchange()])),
    );

    expect(screen.getByText("What would you say?")).toBeInTheDocument();
    expect(screen.getByText("وين نشتري خضار؟")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.db.readsOf("word_assets")).toEqual([]);
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("ignores a stored exchange whose reply does not use the word", async () => {
    const other = { lines: [EXCHANGE.lines[0], { ...EXCHANGE.lines[1], arabic: "رحت المطعم مع أخوي" }] };
    render(
      atReplyStep(),
      { pool: REPLY_POOL, storedDialogues: true },
      signedIn((b) => {
        b.db.seed("word_assets", [filedExchange({ payload: other })]);
        b.stubFunction("word-asset", { asset: { id: "talk-market", payload: other }, url: null, cached: true, stored: true });
      }),
    );
    expect(await screen.findByText("Which word?")).toBeInTheDocument();
  });

  it("asks a well-settled production card to say the reply from the store's exchange", async () => {
    const { backend } = render(
      atSayReplyStep(),
      { pool: POOL, storedDialogues: true },
      signedIn((b) => b.db.seed("word_assets", [filedExchange()])),
    );

    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 9 of 10/i })).toBeInTheDocument();
    expect(screen.getByText("وين رحت أمس؟")).toBeInTheDocument();
    expect(screen.getByText("I went to the market with my brother")).toBeInTheDocument();
    // The reply is the answer: not on screen before the take.
    expect(screen.queryByText("رحت السوق مع أخوي")).not.toBeInTheDocument();
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("asks the reply from the lesson's dialogue too", async () => {
    render(atSayReplyStep({ dialogue: DIALOGUE }), { storedDialogues: true }, signedIn());
    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(screen.getByText("وين نشتري خضار؟")).toBeInTheDocument();
  });

  it("says the line instead when no reply can be had", async () => {
    render(
      atSayReplyStep(),
      { storedDialogues: true },
      signedIn((b) => b.stubFunction("word-asset", { error: "msa_leak", fallback: true, message: "no" })),
    );
    expect(await screen.findByText("Say the line in Arabic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 9 of 10/i })).toBeInTheDocument();
  });

  it("writes the exchange for the spoken reply, which needs no wrong replies", async () => {
    const { backend } = render(atSayReplyStep(), { pool: POOL, storedDialogues: true }, signedIn());
    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(backend.callsTo("word-asset")).toHaveLength(1);
  });

  it("serves the flip card, and has nothing written, when the device cannot record", async () => {
    recorder.supported = false;
    const { backend } = render(atSayReplyStep(), { storedDialogues: true }, signedIn());
    await waitFor(() => expect(screen.getByText("the flip card")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("looks nothing up, and has nothing written, on a deck that did not ask for exchanges", async () => {
    const { backend } = render(atReplyStep(), { pool: REPLY_POOL }, signedIn());

    expect(screen.getByText("Which word?")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.db.readsOf("word_assets")).toEqual([]);
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("asks from a stored exchange for an item of two words", async () => {
    // A fifth of the curriculum's items are phrases; the store files their
    // exchanges, so the quiz must be able to ask from them.
    const PHRASE = {
      lines: [
        { speaker: "Friend", arabic: "متى تروح السوق؟", english: "When do you go to the market?", transliteration: "" },
        { speaker: "You", arabic: "اروح السوق كل يوم", english: "I go to the market every day", transliteration: "" },
      ],
    };
    const { backend } = render(
      atSayReplyStep({ arabic: "كل يوم", english: "every day" }),
      { pool: POOL, storedDialogues: true },
      signedIn((b) => b.db.seed("word_assets", [filedExchange({ concept_key: "كل يوم|every day", payload: PHRASE })])),
    );

    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(screen.getByText("متى تروح السوق؟")).toBeInTheDocument();
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("deals no other dialect's stored reply as a wrong one", async () => {
    // A mixed session's pool holds every dialect's stored replies.
    const egyptian: QuizPoolEntry[] = REPLY_POOL.map((entry: QuizPoolEntry) =>
      entry.dialogueLine ? { ...entry, dialogueDialect: "Egyptian" } : entry,
    );
    render(
      atReplyStep(),
      { pool: egyptian, storedDialogues: true },
      signedIn((b) => b.db.seed("word_assets", [filedExchange()])),
    );
    // Without this dialect's three, there are not enough wrong replies: the word is picked.
    expect(await screen.findByText("Which word?")).toBeInTheDocument();
  });

  it("says nothing but a spinner while the pool is still loading", () => {
    render(atReplyStep(), { pool: REPLY_POOL, storedDialogues: true, ready: false }, signedIn());
    expect(screen.getByRole("status", { name: "Preparing the question" })).toHaveTextContent("");
  });

  it("looks a word's picture and its exchange up side by side, and asks with whichever it gets", async () => {
    // At step 6 a word with no lesson line may end up picked from four with
    // its picture as the prompt: both are looked up at once.
    const { backend } = render(
      atReplyStep(),
      { pool: REPLY_POOL, storedDialogues: true, sharedPictures: true },
      signedIn((b) => {
        b.db.seed("word_assets", [
          {
            ...filedExchange(),
            id: "asset-market",
            kind: "image",
            style_version: "ink-1",
            url: "https://cdn.test/store/market-ink.png",
            payload: null,
          },
        ]);
        b.stubFunctionFailure("word-asset", 500);
      }),
    );

    expect(await screen.findByText("Which word?")).toBeInTheDocument();
    expect(document.querySelector('img[src="https://cdn.test/store/market-ink.png"]')).not.toBeNull();
    expect(backend.db.readsOf("word_assets").length).toBeGreaterThanOrEqual(2);
  });
});

describe("an animation for an action word", () => {
  const CLIP = "https://cdn.test/word-animations/eat.mp4";
  const POSTER = "https://cdn.test/word-animations/eat.png";
  const PICTURE = "https://img.test/eat.png";

  /** "I eat", a curriculum verb, on "say it" (production, under 14 days). */
  const eat = (over: Partial<QuizItem> = {}) =>
    anItem({
      id: "eat-1",
      arabic: "آكل",
      english: "I eat",
      category: "Verb — routine",
      dialect: "Gulf",
      sentence: null,
      direction: "production",
      memory: { stability: 3, repetitions: 2 },
      ...over,
    });

  const filedClip = (over: Record<string, unknown> = {}) => ({
    id: "asset-eat",
    // `assetKey` for "I eat": the action alone, no Arabic, no dialect.
    concept_key: "eat",
    kind: "animation",
    dialect: null,
    style_version: "ink-1",
    url: CLIP,
    payload: { poster: POSTER, seconds: 4, aspect: "16:9" },
    meta: {},
    source: "generated",
    approved_at: null,
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  });

  const withClips = (rows: unknown[] = [filedClip()], more?: (backend: SupabaseBackend) => void): HarnessOptions => ({
    persona: "free",
    seed: (backend) => {
      backend.db.seed("word_assets", rows as Array<Record<string, unknown>>);
      more?.(backend);
    },
  });

  const clipReads = (backend: SupabaseBackend) =>
    backend.db.readsOf("word_assets").filter((read) => read.search.includes("kind=eq.animation"));

  /** The browser asks for less motion. */
  const reduceMotion = () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query.includes("prefers-reduced-motion"),
    })) as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  };

  describe("on \"say it\"", () => {
    it("shows the clip where the picture would be, muted, looped and inline, and asks from it alone", async () => {
      const { backend } = render(eat({ imageUrl: PICTURE }), { animations: true }, withClips());

      expect(await screen.findByText("Say it in Arabic")).toBeInTheDocument();
      const video = screen.getByTestId("quiz-animation") as HTMLVideoElement;
      expect(video.getAttribute("src")).toBe(CLIP);
      expect(video.getAttribute("poster")).toBe(POSTER);
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(true);
      expect(video.hasAttribute("playsinline")).toBe(true);
      expect(video.hasAttribute("controls")).toBe(false);
      // In the picture's place, never beside it.
      expect(document.querySelector(`img[src="${PICTURE}"]`)).toBeNull();
      // The meaning is withheld, as it is behind a picture.
      expect(screen.getByRole("button", { name: /show meaning/i })).toBeInTheDocument();
      expect(screen.queryByText("I eat")).not.toBeInTheDocument();
      // A read, and nothing else: clips are never made from the quiz.
      expect(clipReads(backend)).toHaveLength(1);
      expect(backend.callsTo("word-asset")).toEqual([]);
      expect(backend.db.writes).toEqual([]);
    });

    it("shows the poster instead of playing it when the learner asked for reduced motion", async () => {
      const restoreMotion = reduceMotion();
      try {
        render(eat(), { animations: true }, withClips());
        expect(await screen.findByText("Say it in Arabic")).toBeInTheDocument();
        expect(screen.getByTestId("quiz-animation-still").getAttribute("src")).toBe(POSTER);
        expect(screen.queryByTestId("quiz-animation")).toBeNull();
      } finally {
        restoreMotion();
      }
    });

    it("asks with the picture, else the meaning, when the store has no clip", async () => {
      const first = render(eat({ imageUrl: PICTURE }), { animations: true }, withClips([]));
      expect(await screen.findByText("Say it in Arabic")).toBeInTheDocument();
      expect(document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull();
      expect(screen.queryByTestId("quiz-animation")).toBeNull();
      first.unmount();
      cleanup?.();

      render(eat(), { animations: true }, withClips([]));
      expect(await screen.findByText("Say it in Arabic")).toBeInTheDocument();
      expect(screen.getByText("I eat")).toBeInTheDocument();
    });

    it("is not held up while the store's table has not reached the live project", async () => {
      render(
        eat({ imageUrl: PICTURE }),
        { animations: true },
        withClips([], (b) =>
          b.db.failAlways("word_assets", 404, {
            code: "PGRST205",
            message: "Could not find the table 'public.word_assets' in the schema cache",
          }),
        ),
      );
      expect(await screen.findByText("Say it in Arabic")).toBeInTheDocument();
      expect(document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull();
    });

    it("keeps the question it put on screen: a clip that arrives late is for next time", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(
          eat({ imageUrl: PICTURE }),
          { animations: true },
          withClips([filedClip()], (b) => b.db.delay("word_assets", ANIMATION_LOOKUP_WAIT_MS + 3_000)),
        );
        expect(screen.getByRole("status", { name: "Preparing the question" })).toBeInTheDocument();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(ANIMATION_LOOKUP_WAIT_MS + 100);
        });
        expect(screen.getByText("Say it in Arabic")).toBeInTheDocument();
        expect(document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(4_000);
        });
        expect(document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull();
        expect(screen.queryByTestId("quiz-animation")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("looks nothing up for a word that is not an action, or on a deck that does not show clips", async () => {
      for (const [item, props] of [
        [eat({ category: "Noun", imageUrl: PICTURE }), { animations: true }],
        [eat({ english: "I want", category: "Verb", imageUrl: PICTURE }), { animations: true }],
        [eat({ category: null, imageUrl: PICTURE }), { animations: true }],
        [eat({ imageUrl: PICTURE }), {}],
      ] as const) {
        const { backend, unmount } = render(item, props, withClips());
        expect(await screen.findByText("Say it in Arabic")).toBeInTheDocument();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(clipReads(backend)).toEqual([]);
        expect(screen.queryByTestId("quiz-animation")).toBeNull();
        unmount();
        cleanup?.();
      }
    });

    it("shows no clip on the line or the reply, which are asked from words", async () => {
      // Step 8 with a sentence is "say the line": nothing to show a clip in.
      const { backend } = render(
        eat({ sentence: { arabic: "آكل عيش", english: "I eat bread" }, memory: { stability: 20, repetitions: 4 } }),
        { animations: true },
        withClips(),
      );
      expect(await screen.findByText("Say the line in Arabic")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(clipReads(backend)).toEqual([]);
    });
  });

  describe("on the picture question", () => {
    /** Recognition, at the picture step, with a picture of its own. */
    const atPicture = (over: Partial<QuizItem> = {}) =>
      eat({ direction: "recognition", memory: { stability: 5, repetitions: 2 }, imageUrl: PICTURE, ...over });

    const answerTile = () => screen.getByRole("radio", { name: "I eat" });

    it("deals the clip as the word's option, held still when it would be the only one moving", async () => {
      render(atPicture(), { animations: true }, withClips());

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(4);
      // The word is dealt once: its clip, as its poster, and not its picture.
      expect(answerTile().querySelector('[data-testid="quiz-animation-still"]')?.getAttribute("src")).toBe(POSTER);
      expect(document.querySelector(`img[src="${PICTURE}"]`)).toBeNull();
      expect(screen.queryAllByTestId("quiz-animation")).toHaveLength(0);
    });

    it("plays the clips when more than one option moves, so motion is no tell", async () => {
      const pool: QuizPoolEntry[] = [
        { arabic: "أشرب", english: "I drink", animation: { clip: "https://cdn.test/drink.mp4", poster: "https://cdn.test/drink.png" } },
        { arabic: "أنام", english: "I sleep", animation: { clip: "https://cdn.test/sleep.mp4", poster: "https://cdn.test/sleep.png" } },
        { arabic: "بيت", english: "house", imageUrl: "https://img.test/house.png" },
        { arabic: "مدرسة", english: "school", imageUrl: "https://img.test/school.png" },
      ];
      render(atPicture(), { animations: true, pool }, withClips());

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      const moving = screen.getAllByTestId("quiz-animation").map((v) => v.getAttribute("src"));
      expect(moving).toContain(CLIP);
      expect(moving.length).toBeGreaterThanOrEqual(2);
      expect(screen.queryAllByTestId("quiz-animation-still")).toHaveLength(0);
    });

    it("never deals another word for the same action, nor a word's clip beside its picture", async () => {
      const pool: QuizPoolEntry[] = [
        // Egyptian "eat" glossed without the pronoun: the same action, a second right answer.
        { arabic: "باكل", english: "eat", imageUrl: "https://img.test/also-eating.png" },
        // One alternative in common is the same motion too.
        { arabic: "ياكل", english: "eat / have a meal", imageUrl: "https://img.test/meal.png" },
        // A word with both: one tile, its clip.
        {
          arabic: "أشرب",
          english: "I drink",
          imageUrl: "https://img.test/drink-picture.png",
          animation: { clip: "https://cdn.test/drink.mp4", poster: "https://cdn.test/drink.png" },
        },
        ...POOL,
      ];
      render(atPicture(), { animations: true, pool }, withClips());

      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(document.querySelector('img[src="https://img.test/also-eating.png"]')).toBeNull();
      expect(document.querySelector('img[src="https://img.test/meal.png"]')).toBeNull();
      expect(document.querySelector('img[src="https://img.test/drink-picture.png"]')).toBeNull();
      expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).not.toContain("eat");
    });

    it("asks with the picture as before when the store has no clip", async () => {
      render(atPicture(), { animations: true }, withClips([]));
      expect(await screen.findByText("Which picture?")).toBeInTheDocument();
      expect(answerTile().querySelector("img")?.getAttribute("src")).toBe(PICTURE);
    });
  });
});

describe("a word in a story", () => {
  // The top step: a mature production card is asked its word in two
  // sentences of a story, read aloud with the word muted. The passage is the
  // store's (`kind: "story_line"`), or one found in a published story or
  // written for the word on a miss; with none, the step below.
  const PASSAGE = {
    sentences: [
      { arabic: "كان الجو حار وايد.", english: "It was very hot." },
      { arabic: "رحنا السوق بدري.", english: "We went to the market early." },
    ],
    story: { id: "story-1", title: "A hot day", titleArabic: "" },
  };
  const MUTED = "كان الجو حار وايد. رحنا ... بدري.";
  const EXCHANGE = {
    lines: [
      { speaker: "Friend", arabic: "وين رحت أمس؟", english: "Where did you go yesterday?", transliteration: "" },
      { speaker: "You", arabic: "رحت السوق مع أخوي", english: "I went to the market with my brother", transliteration: "" },
    ],
  };
  const filed = (kind: string, payload: unknown) => ({
    id: `${kind}-market`,
    concept_key: "السوق|market",
    kind,
    dialect: "Gulf",
    style_version: "text-1",
    url: null,
    payload,
    meta: {},
    source: "generated",
    approved_at: null,
    created_at: "2026-10-09T00:00:00Z",
  });
  const FOUND = { asset: { id: "story_line-market", payload: PASSAGE }, url: null, cached: false, stored: true };

  /** Settled past the reply step, on production: "in a story". */
  const atStoryStep = (over: Partial<QuizItem> = {}) =>
    anItem({ dialect: "Gulf", direction: "production", memory: { stability: 70, repetitions: 7 }, ...over });

  const signedIn = (seed?: (backend: SupabaseBackend) => void): HarnessOptions => ({
    persona: "free",
    seed: (backend) => {
      backend.db.seed("word_assets", []);
      backend.stubFunction("word-asset", FOUND);
      seed?.(backend);
    },
  });
  const storyCalls = (backend: SupabaseBackend) =>
    backend.callsTo("word-asset").filter((call) => (call.body as { kind?: string }).kind === "story_line");

  it("asks the word in its story, the gap muted in the passage's dialect, from the store for nothing", async () => {
    const { backend } = render(
      atStoryStep(),
      { storedDialogues: true, storyLines: true },
      signedIn((b) => b.db.seed("word_assets", [filed("story_line", PASSAGE)])),
    );

    expect(await screen.findByText("Say the missing word")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 10 of 10: in a story/i })).toBeInTheDocument();
    const passage = screen.getByTestId("story-passage");
    expect(passage).toHaveTextContent("كان الجو حار وايد.");
    expect(passage).toHaveTextContent("رحنا");
    expect(passage).not.toHaveTextContent("السوق");
    expect(screen.getByText(/From the story “A hot day”/)).toBeInTheDocument();
    // Read with the word muted, in the card's dialect: the word is not in what
    // the voice is given.
    const read = tts.asked.filter((a) => !a.skip && a.text.includes("كان الجو"));
    expect(read.map((a) => a.text)).toEqual([MUTED]);
    expect(read[0].dialect).toBe("Gulf");
    expect(backend.callsTo("word-asset")).toEqual([]);
  });

  it("has a passage found or written for a word with none, waits for it, and asks with it", async () => {
    const { backend } = render(
      atStoryStep(),
      { storedDialogues: true, storyLines: true },
      signedIn((b) => b.db.delayFunction("word-asset", 200)),
    );

    expect(await screen.findByRole("status", { name: "Finding a story for this word" })).toBeInTheDocument();
    expect(await screen.findByText("Say the missing word")).toBeInTheDocument();
    // Asked for once, by the word alone.
    expect(storyCalls(backend)).toHaveLength(1);
    expect(storyCalls(backend)[0].body).toEqual({
      action: "ensure",
      kind: "story_line",
      word: "السوق",
      gloss: "the market",
      dialect: "Gulf",
    });
    // Its fallback's exchange is looked up, never written: one card is not
    // charged for two things.
    expect(backend.callsTo("word-asset").filter((call) => (call.body as { kind?: string }).kind === "dialogue")).toEqual([]);
  });

  it("asks the reply instead when no passage can be had, quietly, and the line when there is no reply either", async () => {
    for (const seed of [
      (b: SupabaseBackend) => b.stubFunctionCapped("word-asset"),
      (b: SupabaseBackend) => b.stubFunction("word-asset", { error: "msa_leak", fallback: true, message: "no" }),
      (b: SupabaseBackend) => b.stubFunctionFailure("word-asset", 503, { error: "store_not_ready", fallback: true }),
      (b: SupabaseBackend) => b.stubFunctionFailure("word-asset", 500),
    ]) {
      const { unmount } = render(
        atStoryStep(),
        { storedDialogues: true, storyLines: true },
        signedIn((b) => {
          b.db.seed("word_assets", [filed("dialogue", EXCHANGE)]);
          seed(b);
        }),
      );
      expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: /step 10 of 10/i })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // The harness's cleanup hands fetch back; the card itself goes with unmount.
      unmount();
      cleanup?.();
      cleanup = undefined;
    }

    render(
      atStoryStep(),
      { storedDialogues: true, storyLines: true },
      signedIn((b) => b.stubFunction("word-asset", { error: "msa_leak", fallback: true, message: "no" })),
    );
    expect(await screen.findByText("Say the line in Arabic")).toBeInTheDocument();
  });

  it("asks the reply while the store's table has not reached the live project, and writes nothing", async () => {
    const { backend } = render(
      atStoryStep({ dialogue: DIALOGUE }),
      { storedDialogues: true, storyLines: true },
      signedIn((b) => {
        b.db.failAlways("word_assets", 404, {
          code: "PGRST205",
          message: "Could not find the table 'public.word_assets' in the schema cache",
        });
        b.stubFunctionFailure("word-asset", 503, { error: "store_not_ready", fallback: true });
      }),
    );
    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(screen.getByText("وين نشتري خضار؟")).toBeInTheDocument();
    expect(backend.db.writes).toEqual([]);
  });

  it("asks the gap with four options on a device that cannot record, graded as a choice", async () => {
    recorder.supported = false;
    const { onGraded } = render(
      atStoryStep(),
      { storedDialogues: true, storyLines: true },
      signedIn((b) => b.db.seed("word_assets", [filed("story_line", PASSAGE)])),
    );

    expect(await screen.findByText("Fill in the missing word")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /choose the missing word/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("img", { name: /step 10 of 10/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "السوق" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    // A choice is never better than Good, on the production schedule it was served on.
    expect(onGraded).toHaveBeenCalledWith({ rating: "good", correct: true, format: "story-choice", step: 10, item: expect.objectContaining({ id: "card-1" }) });
  });

  it("serves the flip card on a device that cannot record with too few other words, and asks the store nothing", async () => {
    recorder.supported = false;
    const { backend } = render(
      atStoryStep(),
      { pool: POOL.slice(0, 2), storedDialogues: true, storyLines: true },
      signedIn(),
    );
    expect(await screen.findByText("the flip card")).toBeInTheDocument();
    // No question could be asked from a passage, so none is written for it.
    expect(storyCalls(backend)).toEqual([]);
  });

  it("keeps the question it asked when the passage arrives after it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        atStoryStep(),
        { storedDialogues: true, storyLines: true },
        signedIn((b) => {
          b.db.seed("word_assets", [filed("dialogue", EXCHANGE)]);
          b.db.delayFunction("word-asset", STORY_LINE_WRITING_WAIT_MS + 5_000);
        }),
      );
      expect(await screen.findByRole("status", { name: "Finding a story for this word" })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STORY_LINE_WRITING_WAIT_MS + 100);
      });
      expect(screen.getByText("Say the reply in Arabic")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      // Not swapped in under the learner: it is for the next time.
      expect(screen.getByText("Say the reply in Arabic")).toBeInTheDocument();
      expect(screen.queryByText("Say the missing word")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a stored passage the word is not in", async () => {
    const other = { sentences: [PASSAGE.sentences[0], { arabic: "رحنا المطعم بدري.", english: "We went to the restaurant early." }] };
    render(
      atStoryStep({ dialogue: DIALOGUE }),
      { storedDialogues: true, storyLines: true },
      signedIn((b) => {
        b.db.seed("word_assets", [filed("story_line", other)]);
        b.stubFunction("word-asset", { asset: { id: "story_line-market", payload: other }, url: null, cached: true, stored: true });
      }),
    );
    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
  });

  it("asks a deck that did not ask for passages the step below, and looks nothing up", async () => {
    const { backend } = render(atStoryStep({ dialogue: DIALOGUE }), { storedDialogues: true }, signedIn());
    expect(await screen.findByText("Say the reply in Arabic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /step 10 of 10/i })).toBeInTheDocument();
    expect(storyCalls(backend)).toEqual([]);
  });
});

