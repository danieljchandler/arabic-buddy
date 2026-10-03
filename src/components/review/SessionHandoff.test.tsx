import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewDeckId, ReviewDeckInfo, ReviewSession } from "@/hooks/useReviewSession";
import { subscribeCelebrations, type CelebrationEvent } from "@/lib/celebrations";
import { SessionHandoff } from "./SessionHandoff";

/**
 * What a learner sees at the end of a review deck.
 *
 * The daily session spans three separate decks, and the failure this component
 * exists to prevent is dead-ending: finishing the curriculum deck, being told
 * "All caught up!", and leaving twenty mined words due in a deck the learner
 * would have to remember to visit. So the end of one deck is the offer to start
 * the next, and the celebration is held back until there is genuinely nothing
 * left anywhere.
 */

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

beforeEach(() => navigate.mockReset());
afterEach(() => vi.clearAllMocks());

const aDeck = (over: Partial<ReviewDeckInfo> = {}): ReviewDeckInfo => ({
  id: "my-words",
  label: "My Words",
  cardNoun: "word",
  route: "/review/my-words",
  due: 3,
  ...over,
});

const aSession = (next: ReviewDeckInfo | null): ReviewSession => ({
  decks: [],
  totalDue: next?.due ?? 0,
  isLoading: false,
  nextDeck: () => next,
  dueElsewhere: () => next?.due ?? 0,
});

interface Options {
  next?: ReviewDeckInfo | null;
  deckId?: ReviewDeckId;
  message?: string;
  children?: React.ReactNode;
  reviewed?: number;
  isLoading?: boolean;
}

function renderHandoff({
  next = null,
  deckId = "curriculum",
  message = "Nothing left in the curriculum deck.",
  children,
  reviewed,
  isLoading = false,
}: Options = {}) {
  return render(
    <MemoryRouter>
      <SessionHandoff
        deckId={deckId}
        session={{ ...aSession(next), isLoading }}
        message={message}
        reviewed={reviewed}
        fallbackLabel="Back to review"
        fallbackRoute="/review"
      >
        {children}
      </SessionHandoff>
    </MemoryRouter>,
  );
}

describe("SessionHandoff — when everything is done", () => {
  it("celebrates", () => {
    renderHandoff({ next: null });
    expect(screen.getByRole("heading", { name: "All caught up!" })).toBeInTheDocument();
  });

  it("shows the caller's own message unchanged", () => {
    renderHandoff({ next: null, message: "Nothing left in the curriculum deck." });
    expect(screen.getByText("Nothing left in the curriculum deck.")).toBeInTheDocument();
  });

  it("offers the caller's way out", () => {
    renderHandoff({ next: null });
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(navigate).toHaveBeenCalledWith("/review");
  });
});

describe("SessionHandoff — when another deck still has cards", () => {
  it("holds the celebration back", () => {
    // "All caught up" over twenty due cards is the exact mistake this avoids.
    renderHandoff({ next: aDeck() });
    expect(screen.getByRole("heading", { name: "Deck complete" })).toBeInTheDocument();
    expect(screen.queryByText("All caught up!")).not.toBeInTheDocument();
  });

  it("says how many are left and where", () => {
    renderHandoff({ next: aDeck({ due: 3, label: "My Words", cardNoun: "word" }) });
    expect(
      screen.getByText("Nothing left in the curriculum deck. 3 words still due in My Words."),
    ).toBeInTheDocument();
  });

  it("offers to carry straight on", () => {
    renderHandoff({ next: aDeck({ due: 3, cardNoun: "word" }) });
    expect(screen.getByRole("button", { name: "Continue with 3 words" })).toBeInTheDocument();
  });

  it("goes to that deck", () => {
    renderHandoff({ next: aDeck({ route: "/review/my-phrases" }) });
    fireEvent.click(screen.getByRole("button", { name: /^Continue with/ }));
    expect(navigate).toHaveBeenCalledWith("/review/my-phrases");
  });

  it("offers no way out of the session while cards remain", () => {
    renderHandoff({ next: aDeck() });
    expect(screen.queryByRole("button", { name: "Back to review" })).not.toBeInTheDocument();
  });

  it("counts one card in the singular", () => {
    renderHandoff({ next: aDeck({ due: 1, cardNoun: "word" }) });
    expect(screen.getByRole("button", { name: "Continue with 1 word" })).toBeInTheDocument();
    expect(screen.getByText(/1 word still due/)).toBeInTheDocument();
  });

  it("uses each deck's own noun", () => {
    // "3 phrases" rather than "3 cards" — the decks hold different things and
    // the learner thinks in those terms.
    renderHandoff({ next: aDeck({ due: 3, cardNoun: "phrase", label: "My Phrases" }) });
    expect(screen.getByRole("button", { name: "Continue with 3 phrases" })).toBeInTheDocument();
  });

  it("asks the session what comes after this deck", () => {
    const nextDeck = vi.fn(() => aDeck());
    render(
      <MemoryRouter>
        <SessionHandoff
          deckId="my-words"
          session={{ ...aSession(aDeck()), nextDeck }}
          message="done"
          fallbackLabel="Back"
          fallbackRoute="/review"
        />
      </MemoryRouter>,
    );
    expect(nextDeck).toHaveBeenCalledWith("my-words");
  });
});

describe("SessionHandoff — the caller's extra content", () => {
  it("shows per-deck stats above the button", () => {
    renderHandoff({ next: null, children: <p>You reviewed 20 cards.</p> });
    expect(screen.getByText("You reviewed 20 cards.")).toBeInTheDocument();
  });

  it("shows them on the hand-off screen too", () => {
    renderHandoff({ next: aDeck(), children: <p>You reviewed 20 cards.</p> });
    expect(screen.getByText("You reviewed 20 cards.")).toBeInTheDocument();
  });

  it("renders without any", () => {
    renderHandoff({ next: null });
    expect(screen.getByRole("heading", { name: "All caught up!" })).toBeInTheDocument();
  });
});

describe("SessionHandoff — the celebration screen", () => {
  let events: CelebrationEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    events = [];
    unsubscribe = subscribeCelebrations((event) => events.push(event));
  });
  afterEach(() => unsubscribe());

  it("fires once the last due deck is cleared in this sitting", () => {
    const { rerender } = renderHandoff({ next: null, reviewed: 12 });
    expect(events).toEqual([{ kind: "deck", detail: 12 }]);

    // A re-render of the same screen is the same moment.
    rerender(
      <MemoryRouter>
        <SessionHandoff
          deckId="curriculum"
          session={aSession(null)}
          message="done"
          fallbackLabel="Back"
          fallbackRoute="/review"
          reviewed={12}
        />
      </MemoryRouter>,
    );
    expect(events).toHaveLength(1);
  });

  it("does not fire for a learner who arrived with nothing due", () => {
    renderHandoff({ next: null, reviewed: 0 });
    renderHandoff({ next: null });
    expect(events).toEqual([]);
  });

  it("waits while another deck still has cards", () => {
    renderHandoff({ next: aDeck(), reviewed: 12 });
    expect(events).toEqual([]);
  });

  it("waits until the other decks' counts have loaded", () => {
    // Mid-load, "no next deck" only means "not known yet".
    renderHandoff({ next: null, reviewed: 12, isLoading: true });
    expect(events).toEqual([]);
  });
});
