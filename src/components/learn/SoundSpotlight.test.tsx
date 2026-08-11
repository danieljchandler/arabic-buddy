import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoundSpotlightEntry } from "@/hooks/useTopic";
import { renderWithProviders } from "@/test/support/react/harness";
import { SoundSpotlight } from "./SoundSpotlight";

/**
 * The lesson's pronunciation notes.
 *
 * Authored in the lesson spreadsheet's "SOUND SPOTLIGHT" column and, for a long
 * time, dropped on the floor at import — this is the surface that finally
 * renders them. Each row is a sound, an Arabic example, and a sentence about
 * what an English speaker gets wrong; any of the three can be missing, because
 * the spreadsheet lets an author fill in only what they had to say.
 */

const tts = vi.hoisted(() => ({
  asked: [] as Array<{ text: string; skip?: boolean; dialect?: string }>,
  url: "blob:sound" as string | null,
}));
vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean; dialect?: string }) => {
    tts.asked.push(options);
    return { ttsUrl: options.skip ? null : tts.url, isLoading: false, regenerate: vi.fn() };
  },
}));

const play = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => ({ play, stop: vi.fn(), isPlaying: false }),
}));

beforeEach(() => {
  tts.asked = [];
  tts.url = "blob:sound";
  play.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

const entries: SoundSpotlightEntry[] = [
  { sound: "ع", example: "عين", explanation: "A constriction deep in the throat." },
  { sound: "ح", example: "حار", explanation: "Breathy, not the English h." },
];

let cleanup: (() => void) | undefined;

function renderSpotlight(list: SoundSpotlightEntry[] = entries, dialect = "Gulf") {
  localStorage.setItem("hakiya_dialect_module", dialect);
  const harness = renderWithProviders(<SoundSpotlight entries={list} />);
  cleanup = harness.cleanup;
  return harness;
}

const toggle = () => screen.getByRole("button", { name: /Sounds in this lesson/ });

describe("SoundSpotlight — deciding whether to appear", () => {
  it("renders nothing when the lesson has no notes", () => {
    const { container } = renderSpotlight([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every row is blank", () => {
    // The parser emits a row per spreadsheet line, including the empty ones
    // left behind by an author's spacing.
    const { container } = renderSpotlight([{}, { sound: "", example: "", explanation: "" }]);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears for a row with only an explanation", () => {
    renderSpotlight([{ explanation: "Arabic has no p." }]);
    expect(screen.getByText("Arabic has no p.")).toBeInTheDocument();
  });

  it("appears for a row with only a sound", () => {
    renderSpotlight([{ sound: "ق" }]);
    expect(screen.getByText("ق")).toBeInTheDocument();
  });

  it("drops the blank rows and keeps the rest", () => {
    renderSpotlight([{}, entries[0], {}]);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("SoundSpotlight — the rows", () => {
  it("shows the sound, the example and the explanation", () => {
    renderSpotlight();
    expect(screen.getByText("ع")).toBeInTheDocument();
    expect(screen.getByText("عين")).toBeInTheDocument();
    expect(screen.getByText("A constriction deep in the throat.")).toBeInTheDocument();
  });

  it("keeps every row the lesson authored", () => {
    renderSpotlight();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks the Arabic right-to-left", () => {
    renderSpotlight();
    expect(screen.getByText("عين")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("ع")).toHaveAttribute("dir", "rtl");
  });

  it("leaves the example out when there is none", () => {
    renderSpotlight([{ sound: "ق", explanation: "Further back than k." }]);
    expect(screen.queryByRole("button", { name: /^Play/ })).not.toBeInTheDocument();
  });

  it("keeps two rows apart even when they name the same sound", () => {
    // The key is built from the sound, so a lesson covering ع twice — initial
    // and medial, say — would collide without the index.
    renderSpotlight([
      { sound: "ع", example: "عين" },
      { sound: "ع", example: "سعيد" },
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("SoundSpotlight — hearing an example", () => {
  it("offers to play each example", () => {
    renderSpotlight();
    expect(screen.getByRole("button", { name: "Play عين" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play حار" })).toBeInTheDocument();
  });

  it("plays the clip that was made for that example", () => {
    renderSpotlight();
    fireEvent.click(screen.getByRole("button", { name: "Play عين" }));
    expect(play).toHaveBeenCalledWith("blob:sound");
  });

  it("synthesises in the dialect the learner is studying", () => {
    // ع and ح are pronounced differently across the modules, so a Gulf clip on
    // an Egyptian lesson would be teaching the wrong sound.
    renderSpotlight(entries, "Egyptian");
    expect(tts.asked.every((ask) => ask.dialect === "Egyptian")).toBe(true);
  });

  it("asks for nothing when a row has no example", () => {
    renderSpotlight([{ sound: "ق", explanation: "Further back than k." }]);
    expect(tts.asked[0]).toMatchObject({ skip: true });
  });

  it("treats a whitespace-only example as no example", () => {
    renderSpotlight([{ sound: "ق", example: "   " }]);
    expect(tts.asked[0]).toMatchObject({ skip: true });
  });

  it("offers no button while the clip is still being made", () => {
    tts.url = null;
    renderSpotlight();
    expect(screen.queryByRole("button", { name: /^Play/ })).not.toBeInTheDocument();
  });
});

describe("SoundSpotlight — collapsing", () => {
  it("starts open, because the notes are the point", () => {
    renderSpotlight();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("عين")).toBeInTheDocument();
  });

  it("closes on a tap", () => {
    renderSpotlight();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("عين")).not.toBeInTheDocument();
  });

  it("opens again", () => {
    renderSpotlight();
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(screen.getByText("عين")).toBeInTheDocument();
  });

  it("turns the chevron over when open", () => {
    const { container } = renderSpotlight();
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("rotate-180");
    fireEvent.click(toggle());
    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain("rotate-180");
  });

  /**
   * FINDING — collapsing throws the audio away and reopening pays for it again.
   *
   * The rows are unmounted rather than hidden, so each one's `useAzureTTS` tears
   * down and revokes its blob. Reopening remounts them and every example is
   * synthesised from scratch: a learner who folds the panel away to see the
   * vocabulary and then folds it back has cost a full round of TTS calls, twice
   * over for a two-sound lesson. Hiding the list with CSS, or lifting the
   * synthesis above the toggle, would keep the clips.
   */
  it("re-synthesises every example on reopening", () => {
    renderSpotlight();
    const afterFirstOpen = tts.asked.filter((a) => !a.skip).length;

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(tts.asked.filter((a) => !a.skip).length).toBeGreaterThan(afterFirstOpen);
  });

  /**
   * FINDING — the notes synthesise on arrival, not on demand.
   *
   * The panel is open by default and each row asks for its clip immediately, so
   * loading a lesson fires a TTS request per sound whether or not the learner
   * ever taps a speaker. It is the same eager pattern as the alphabet trainer's
   * button, and the opposite of the Bible reader's, which arms on first tap.
   */
  it("requests every clip before anything is tapped", () => {
    renderSpotlight();
    expect(tts.asked.filter((a) => !a.skip)).toHaveLength(2);
    expect(play).not.toHaveBeenCalled();
  });
});
