import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import {
  aUserPhrase,
  aUserVocabulary,
  aWordReview,
  phraseId,
  reviewId,
  TEST_USER_ID,
  vocabId,
} from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { LeechHelperPanel, type LeechKind } from "./LeechHelperPanel";

/**
 * The rescue offered on a card the learner keeps failing.
 *
 * A leech is the failure mode that quietly ruins a spaced-repetition deck: one
 * card that will not stick comes back every day, costs a review slot every
 * time, and teaches nothing. The two ways out are a memory hook or an admission
 * that the card is not worth the fight — so the panel offers exactly those two,
 * and nothing else.
 *
 * The awkward part is that "the card" is three different rows depending on which
 * deck it came from, and a mnemonic is personal, so a curriculum word's hook is
 * written to the learner's own review row rather than to the shared word.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

const ROW_ID: Record<LeechKind, string> = {
  word: vocabId(0),
  phrase: phraseId(0),
  curriculum: reviewId(0),
};

interface Options {
  kind?: LeechKind;
  mnemonic?: string | null;
  mnemonicImageUrl?: string | null;
  seed?: (backend: SupabaseBackend) => void;
}

/** The panel as the review screens mount it, for one deck's row. */
const panel = (
  kind: LeechKind,
  mnemonic: string | null = null,
  mnemonicImageUrl: string | null = null,
) => (
  <LeechHelperPanel
    kind={kind}
    rowId={ROW_ID[kind]}
    arabic="مطعم"
    english="restaurant"
    transliteration="mat'am"
    dialect="Gulf"
    mnemonic={mnemonic}
    mnemonicImageUrl={mnemonicImageUrl}
    invalidateKeys={[["due-words"]]}
  />
);

function render({ kind = "word", mnemonic = null, mnemonicImageUrl = null, seed }: Options = {}) {
  const harness = renderWithProviders(
    panel(kind, mnemonic, mnemonicImageUrl),
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, is_leech: true, lapses: 7 }),
        ]);
        backend.db.seed("user_phrases", [
          aUserPhrase({ id: phraseId(0), user_id: TEST_USER_ID, is_leech: true, lapses: 7 }),
        ]);
        backend.db.seed("word_reviews", [
          aWordReview({ id: reviewId(0), user_id: TEST_USER_ID, is_leech: true, lapses: 7 }),
        ]);
        backend.stubFunction("generate-mnemonic", {
          mnemonic: "مطعم sounds like 'mat' — picture a welcome mat outside a restaurant.",
        });
        backend.stubFunction("generate-mnemonic-image", {
          success: true,
          imageUrl: "https://cdn.test/mnemonic-scene.png",
        });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

/** `useAuth` resolves the session on a macrotask. */
const settleAuth = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const generateButton = () => screen.getByRole("button", { name: /Generate AI mnemonic/ });
const regenerateButton = () => screen.getByRole("button", { name: "Regenerate mnemonic" });
const clearButton = () => screen.getByRole("button", { name: /clear leech flag/ });
const pictureButton = () => screen.getByRole("button", { name: /Picture this mnemonic/ });
const redrawButton = () => screen.getByRole("button", { name: /Redraw picture/ });
const adjustButton = () => screen.getByRole("button", { name: /Adjust/ });
const mnemonicImage = () => screen.getByRole("img", { name: /Mnemonic picture/ });

const click = async (button: HTMLElement) => {
  await settleAuth();
  await act(async () => {
    fireEvent.click(button);
  });
};

const updatesTo = (backend: SupabaseBackend, table: string) =>
  backend.db.writesTo(table).flatMap((w) => w.payload);

describe("what the panel says", () => {
  it("names the problem without blaming the learner", async () => {
    render();
    await settleAuth();

    // A learner who has failed the same card seven times is already frustrated;
    // the copy has to read as an offer of help rather than a scolding.
    expect(screen.getByText("Stuck on this one?")).toBeInTheDocument();
    expect(screen.getByText(/Let AI help you lock it in/)).toBeInTheDocument();
  });

  it("offers to make a memory hook when there is none", async () => {
    render();
    await settleAuth();

    expect(generateButton()).toBeInTheDocument();
    expect(screen.queryByText("Mnemonic")).toBeNull();
  });

  it("shows the hook the card already has", async () => {
    render({ mnemonic: "picture a welcome mat" });
    await settleAuth();

    // Once there is a hook, the panel's job is to keep it in front of the
    // learner on every failed attempt.
    expect(screen.getByText("picture a welcome mat")).toBeInTheDocument();
    expect(screen.getByText("Mnemonic")).toBeInTheDocument();
    expect(regenerateButton()).toBeInTheDocument();
  });

  it("follows the card when the deck moves on", async () => {
    const { rerender } = render({ mnemonic: "picture a welcome mat" });
    await settleAuth();

    act(() => {
      rerender(
        <LeechHelperPanel
          kind="word"
          rowId={vocabId(1)}
          arabic="قائمة"
          english="menu"
          dialect="Gulf"
          mnemonic="think of a queue"
        />,
      );
    });

    // The panel is rendered inside the review card, which is reused between
    // cards. A stale mnemonic would be attached to the wrong word.
    expect(screen.getByText("think of a queue")).toBeInTheDocument();
    expect(screen.queryByText("picture a welcome mat")).toBeNull();
  });
});

describe("making a memory hook", () => {
  it("sends the word with everything needed to hook it", async () => {
    const { backend } = render();

    await click(generateButton());

    // The transliteration is what most English-language mnemonics are built on —
    // "mat'am sounds like mat" only works if the model is given it.
    expect(backend.lastCallTo("generate-mnemonic")?.body).toMatchObject({
      arabic: "مطعم",
      english: "restaurant",
      transliteration: "mat'am",
      dialect: "Gulf",
      kind: "word",
    });
  });

  it("calls a curriculum card a word", async () => {
    const { backend } = render({ kind: "curriculum" });

    await click(generateButton());

    // The function interpolates this into its prompt. "curriculum" would ask
    // for a mnemonic for an Arabic curriculums, which is not a thing.
    expect(backend.lastCallTo("generate-mnemonic")?.body).toMatchObject({ kind: "word" });
  });

  it("calls a phrase a phrase", async () => {
    const { backend } = render({ kind: "phrase" });

    await click(generateButton());

    expect(backend.lastCallTo("generate-mnemonic")?.body).toMatchObject({ kind: "phrase" });
  });

  it("shows the hook and keeps it", async () => {
    const { backend } = render();

    await click(generateButton());

    await waitFor(() => expect(screen.getByText(/welcome mat/)).toBeInTheDocument());
    // Kept, or the learner pays for a fresh generation on every failed attempt.
    expect(updatesTo(backend, "user_vocabulary")[0]).toMatchObject({
      mnemonic: expect.stringContaining("welcome mat"),
    });
    expect(toasts.success).toHaveBeenCalledWith("Mnemonic ready!");
  });

  it("keeps a curriculum hook on the learner's own row", async () => {
    const { backend } = render({ kind: "curriculum" });

    await click(generateButton());

    // A memory hook is personal. Writing it to vocabulary_words would put one
    // learner's association in front of everybody.
    await waitFor(() => expect(updatesTo(backend, "word_reviews")).toHaveLength(1));
    expect(backend.db.writesTo("vocabulary_words")).toHaveLength(0);
  });

  it("keeps a phrase's hook on the phrase", async () => {
    const { backend } = render({ kind: "phrase" });

    await click(generateButton());

    await waitFor(() => expect(updatesTo(backend, "user_phrases")).toHaveLength(1));
  });

  it("can be asked for a different one", async () => {
    const { backend } = render({ mnemonic: "a hook that never helped" });

    await click(regenerateButton());

    // A mnemonic that does not land for this learner is worse than none — it is
    // a second thing to remember.
    await waitFor(() => expect(screen.getByText(/welcome mat/)).toBeInTheDocument());
    expect(backend.callsTo("generate-mnemonic")).toHaveLength(1);
  });

  it("says it is working", async () => {
    render();
    await settleAuth();

    // The backend's function handlers are synchronous, so the request is held
    // open at the transport instead. `inner` is read after render, or it would
    // be the real fetch rather than the harness backend.
    let release: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-mnemonic")) await held;
      return inner(input as RequestInfo, init);
    });

    await act(async () => {
      fireEvent.click(generateButton());
    });

    expect(screen.getByRole("button", { name: /Crafting mnemonic/ })).toBeDisabled();

    await act(async () => {
      release!();
      await held;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.unstubAllGlobals();
  });

  it.each([429, 402])("reports a %i as a generic failure", async (status) => {
    render({ seed: (b) => b.stubFunctionFailure("generate-mnemonic", status) });

    await click(generateButton());

    // Pinned: the handler branches on `err.message.includes("429")` and
    // `("402")`, but supabase-js raises a FunctionsHttpError whose message is
    // the fixed "Edge Function returned a non-2xx status code" — the status is
    // on `error.context`, not in the text. So both branches are unreachable
    // through the real client and a rate limit reads as a fault, which is the
    // one case where "try again shortly" would have been the right advice.
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("Failed to generate mnemonic"),
    );
    expect(toasts.error).not.toHaveBeenCalledWith("Rate limited — try again shortly");
    expect(toasts.error).not.toHaveBeenCalledWith("AI credits exhausted");
  });

  it("falls back to a plain failure", async () => {
    render({ seed: (b) => b.stubFunctionFailure("generate-mnemonic", 500) });

    await click(generateButton());

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("Failed to generate mnemonic"),
    );
  });

  it("treats an empty answer as a failure", async () => {
    const { backend } = render({ seed: (b) => b.stubFunction("generate-mnemonic", {}) });

    await click(generateButton());

    // Saving an empty mnemonic would replace the offer to make one with a blank
    // box that cannot be regenerated from.
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(updatesTo(backend, "user_vocabulary")).toHaveLength(0);
    expect(generateButton()).toBeInTheDocument();
  });

  it("can be tried again after a failure", async () => {
    render({ seed: (b) => b.stubFunctionFailure("generate-mnemonic", 500) });

    await click(generateButton());

    await waitFor(() => expect(generateButton()).toBeEnabled());
  });
});

describe("picturing the memory hook", () => {
  it("offers a picture only once there is a hook to draw", async () => {
    render();
    await settleAuth();

    // Nothing to illustrate. The word's own photo is a different feature, on a
    // different button, and drawing one here would quietly substitute it.
    expect(screen.queryByRole("button", { name: /Picture this mnemonic/ })).toBeNull();
  });

  it("draws the hook the learner is looking at", async () => {
    const { backend } = render({ mnemonic: "picture a welcome mat" });

    await click(pictureButton());

    // The mnemonic is the subject; the word rides along so the scene still
    // shows the meaning the learner has to recall from it.
    expect(backend.lastCallTo("generate-mnemonic-image")?.body).toMatchObject({
      mnemonic: "picture a welcome mat",
      word_arabic: "مطعم",
      word_english: "restaurant",
    });
  });

  it("shows the picture and keeps it on the card", async () => {
    const { backend } = render({ mnemonic: "picture a welcome mat" });

    await click(pictureButton());

    await waitFor(() => expect(mnemonicImage()).toBeInTheDocument());
    expect(mnemonicImage().getAttribute("src")).toContain("https://cdn.test/mnemonic-scene.png");
    // Kept, or the learner pays for the same picture on every failed attempt.
    expect(updatesTo(backend, "user_vocabulary")[0]).toMatchObject({
      mnemonic_image_url: expect.stringContaining("mnemonic-scene.png"),
    });
    expect(toasts.success).toHaveBeenCalledWith("Picture ready!");
  });

  it("keeps a curriculum card's picture on the learner's own row", async () => {
    const { backend } = render({ kind: "curriculum", mnemonic: "picture a welcome mat" });

    await click(pictureButton());

    // Same reason as the mnemonic itself: the picture illustrates one
    // learner's association, and vocabulary_words is everybody's.
    await waitFor(() => expect(updatesTo(backend, "word_reviews")).toHaveLength(1));
    expect(backend.db.writesTo("vocabulary_words")).toHaveLength(0);
  });

  it("shows the picture the card already has, and offers a redraw", async () => {
    render({ mnemonic: "picture a welcome mat", mnemonicImageUrl: "https://cdn.test/kept.png" });
    await settleAuth();

    expect(mnemonicImage().getAttribute("src")).toBe("https://cdn.test/kept.png");
    expect(redrawButton()).toBeInTheDocument();
  });

  it("sends the learner's adjustment with the redraw", async () => {
    const { backend } = render({
      mnemonic: "picture a welcome mat",
      mnemonicImageUrl: "https://cdn.test/kept.png",
    });

    await click(adjustButton());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Adjust the picture"), {
        target: { value: "make it a cartoon, in a desert doorway" },
      });
    });
    await click(redrawButton());

    // The whole point of the control: the first attempt routinely illustrates
    // the pun and drops the meaning, and the learner is the only one who knows
    // which half is missing.
    expect(backend.lastCallTo("generate-mnemonic-image")?.body).toMatchObject({
      custom_instructions: "make it a cartoon, in a desert doorway",
    });
  });

  it("leaves the adjustment on screen, since it still applies", async () => {
    render({ mnemonic: "picture a welcome mat", mnemonicImageUrl: "https://cdn.test/kept.png" });

    await click(adjustButton());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Adjust the picture"), {
        target: { value: "make it a cartoon" },
      });
    });
    await click(redrawButton());

    // The instructions stay in force for the next redraw, so hiding them would
    // leave the learner adjusting against a note they can no longer see.
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Picture ready!"));
    expect(screen.getByLabelText("Adjust the picture")).toHaveValue("make it a cartoon");
  });

  it("does not carry an adjustment onto the next card", async () => {
    const { rerender } = render({ mnemonic: "picture a welcome mat" });

    await click(adjustButton());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Adjust the picture"), {
        target: { value: "make it a cartoon" },
      });
    });

    act(() => {
      rerender(panel("phrase", "think of a queue"));
    });

    // "Make it a cartoon" was about a welcome mat. Carried onto the next card
    // it would silently reshape a picture of something else.
    expect(screen.queryByLabelText("Adjust the picture")).toBeNull();
  });

  it("busts the cache so a redraw is visible", async () => {
    render({ mnemonic: "picture a welcome mat", mnemonicImageUrl: "https://cdn.test/kept.png" });

    await click(redrawButton());

    // A regeneration can land on the same storage path, and a browser showing
    // the cached copy reads as "the button did nothing".
    await waitFor(() =>
      expect(mnemonicImage().getAttribute("src")).toMatch(/mnemonic-scene\.png\?t=\d+/),
    );
  });

  it("throws the old picture away with the hook it illustrated", async () => {
    const { backend } = render({
      mnemonic: "a hook that never helped",
      mnemonicImageUrl: "https://cdn.test/kept.png",
    });

    await click(regenerateButton());

    // The scene belongs to the sentence it was drawn from. Left up, it shows
    // the learner a picture that contradicts the mnemonic under it.
    await waitFor(() => expect(screen.getByText(/welcome mat/)).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: /Mnemonic picture/ })).toBeNull();
    expect(updatesTo(backend, "user_vocabulary")[0]).toMatchObject({ mnemonic_image_url: null });
  });

  it("says it is working", async () => {
    render({ mnemonic: "picture a welcome mat" });
    await settleAuth();

    let release: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-mnemonic-image")) await held;
      return inner(input as RequestInfo, init);
    });

    await act(async () => {
      fireEvent.click(pictureButton());
    });

    // Image generation takes tens of seconds — far longer than the mnemonic —
    // so an unlabelled wait reads as a dead button and gets clicked again.
    expect(screen.getByRole("button", { name: /Drawing it/ })).toBeDisabled();

    await act(async () => {
      release!();
      await held;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.unstubAllGlobals();
  });

  it("reports a refusal in the words the function sent", async () => {
    render({
      mnemonic: "picture a welcome mat",
      seed: (b) =>
        b.stubFunction("generate-mnemonic-image", {
          success: false,
          fallback: true,
          message: "Could not picture that mnemonic — try again, or reword the hook.",
        }),
    });

    await click(pictureButton());

    // The function answers a refusal as a 200, so a caller that only checked
    // `error` would save `undefined` as the picture URL and call it a success.
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Could not picture that mnemonic — try again, or reword the hook.",
      ),
    );
    expect(pictureButton()).toBeEnabled();
  });

  it("does not claim a picture it could not keep", async () => {
    render({
      mnemonic: "picture a welcome mat",
      seed: (b) => b.db.failNextWrite("user_vocabulary", 500),
    });

    await click(pictureButton());

    // The save is what makes the picture survive the card. Toasting success
    // over a rejected write would tell the learner it is kept when the next
    // review shows an empty panel.
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(toasts.success).not.toHaveBeenCalledWith("Picture ready!");
  });

  it("can be tried again after a failure", async () => {
    render({
      mnemonic: "picture a welcome mat",
      seed: (b) => b.stubFunctionFailure("generate-mnemonic-image", 500),
    });

    await click(pictureButton());

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(pictureButton()).toBeEnabled();
  });
});

describe("saying the card is not stuck after all", () => {
  it("clears the flag and the failure count", async () => {
    const { backend } = render();

    await click(clearButton());

    // Resetting the count matters as much as the flag: leaving lapses at seven
    // would re-flag the card on the very next miss.
    await waitFor(() => expect(updatesTo(backend, "user_vocabulary")).toHaveLength(1));
    expect(updatesTo(backend, "user_vocabulary")[0]).toMatchObject({
      is_leech: false,
      lapses: 0,
      production_lapses: 0,
    });
    expect(toasts.success).toHaveBeenCalledWith("Cleared — we'll stop flagging this card.");
  });

  it("clears the production count on a curriculum card too", async () => {
    const { backend } = render({ kind: "curriculum" });

    await click(clearButton());

    await waitFor(() => expect(updatesTo(backend, "word_reviews")).toHaveLength(1));
    expect(updatesTo(backend, "word_reviews")[0]).toMatchObject({ production_lapses: 0 });
  });

  it("leaves the production count alone on a phrase", async () => {
    const { backend } = render({ kind: "phrase" });

    await click(clearButton());

    // Phrases are only ever recognised, never produced — the column does not
    // exist on that table and writing it would fail the whole update.
    await waitFor(() => expect(updatesTo(backend, "user_phrases")).toHaveLength(1));
    expect(updatesTo(backend, "user_phrases")[0]).not.toHaveProperty("production_lapses");
  });

  it("takes the panel off screen once the flag is cleared", async () => {
    render();

    await click(clearButton());

    // The parent renders this panel off a cached row, so waiting for its
    // refetch would leave the learner staring at the same "Stuck on this one?"
    // prompt they just dismissed — for the rest of the session on a screen
    // whose query does not refetch mid-review.
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(screen.queryByText("Stuck on this one?")).not.toBeInTheDocument();
  });

  it("keeps the panel on screen when the write is rejected", async () => {
    render({ seed: (b) => b.db.failNextWrite("user_vocabulary", 500) });

    await click(clearButton());

    // A rejected update comes back on PostgREST's `error` channel rather than
    // as a throw, so a panel that hid on the attempt would tell the learner
    // the card was cleared while the row is still flagged — and hide the only
    // control that could try again.
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Couldn't clear leech status"));
    expect(toasts.success).not.toHaveBeenCalled();
    expect(screen.getByText("Stuck on this one?")).toBeInTheDocument();
  });

  it("offers the panel again on the next stuck card", async () => {
    const { rerender } = render();

    await click(clearButton());
    await waitFor(() => expect(screen.queryByText("Stuck on this one?")).not.toBeInTheDocument());

    // The review screens swap the row under one mounted panel rather than
    // remounting it, so a dismissal that outlived its card would silence the
    // rescue for every leech after the first.
    rerender(panel("phrase"));

    expect(screen.getByText("Stuck on this one?")).toBeInTheDocument();
  });
});
