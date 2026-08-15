import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { TutorMemoryCard } from "./TutorMemoryCard";

/**
 * What the AI tutor remembers about a learner, shown to that learner.
 *
 * The notes are written by a model after conversations and carried into every
 * later session — a record of someone's own confusions, kept about them. Two
 * things follow, and both are tested here: they must be able to read it, and
 * they must be able to erase it without asking anyone.
 *
 * Read and delete only. The card never writes: a learner-supplied "here is
 * what you remember about me" would be a prompt-injection surface with a
 * database behind it, which is why the table carries no INSERT or UPDATE
 * policy either.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const aMemory = (over: Record<string, unknown> = {}) => ({
  user_id: USER,
  dialect: "Gulf",
  summary: "Prefers examples before rules; keeps mixing up بـ and راح.",
  open_questions: ["when do you drop the ال?"],
  turns_seen: 8,
  updated_at: "2026-08-10T09:00:00Z",
  ...over,
});

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(rows: Record<string, unknown>[]) {
  localStorage.setItem("hakiya_dialect_module", "Gulf");
  const harness = renderWithProviders(<TutorMemoryCard />, {
    persona: "free",
    seed: (backend: SupabaseBackend) => backend.db.seed("learner_ai_memory", rows),
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("what the tutor remembers", () => {
  it("shows the learner the notes kept about them", async () => {
    render([aMemory()]);

    expect(await screen.findByText(/keeps mixing up/)).toBeInTheDocument();
    expect(screen.getByText(/when do you drop the ال\?/)).toBeInTheDocument();
    expect(screen.getByText(/last updated 2026-08-10/)).toBeInTheDocument();
  });

  it("explains itself when there is nothing yet", async () => {
    render([]);

    // A learner who has never used Ask AI should learn what this is, not stare
    // at an empty box.
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  });

  it("shows only the dialect they are studying", async () => {
    // A learner studying two dialects is two conversations; showing the
    // Egyptian notes during a Gulf session would be as wrong here as it is in
    // the prompt.
    render([aMemory({ dialect: "Egyptian", summary: "Egyptian-only note." })]);

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByText("Egyptian-only note.")).toBeNull();
  });

  it("lets them erase it", async () => {
    const { backend } = render([aMemory()]);
    await screen.findByText(/keeps mixing up/);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Clear the tutor's notes/ }));
    });

    await waitFor(() => expect(screen.getByText(/Nothing yet/)).toBeInTheDocument());
    // Gone from the database, not just from the screen.
    expect(backend.db.rows("learner_ai_memory")).toHaveLength(0);
  });
});
