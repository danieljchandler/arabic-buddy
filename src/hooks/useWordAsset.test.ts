import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { AssetKeyInput } from "../../supabase/functions/_shared/wordAssets";
import { useWordAsset } from "./useWordAsset";

/**
 * Reading a word's shared asset from the browser.
 *
 * The hook folds the word with the edge functions' own module and reads the
 * public table, so these cases are about the two ways that can go wrong for a
 * learner: being shown another word's picture (a key that matches too much),
 * and a card that breaks because the store is not there yet (the migration not
 * applied to the live project). The emulator checks every column and filter
 * the query names, as PostgREST would.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const coffeePicture = (over: Record<string, unknown> = {}) => ({
  id: "asset-coffee",
  concept_key: "قهوه|coffee",
  kind: "image",
  dialect: "Gulf",
  style_version: "ink-1",
  url: "https://cdn.test/coffee-ink.png",
  payload: null,
  meta: {},
  source: "generated",
  approved_at: null,
  created_at: "2026-10-09T00:00:00Z",
  ...over,
});

function render(input: AssetKeyInput | null, seed?: (backend: SupabaseBackend) => void) {
  const rendered = renderHookWithProviders(() => useWordAsset(input), {
    persona: "free",
    seed: (backend) => {
      backend.db.seed("word_assets", [coffeePicture()]);
      seed?.(backend);
    },
  });
  cleanup = rendered.cleanup;
  return rendered;
}

const COFFEE: AssetKeyInput = { kind: "image", word: "قَهْوَة", gloss: "Coffee", dialect: "Gulf" };

describe("useWordAsset", () => {
  it("finds the picture filed for the word, however the word was spelt", async () => {
    // Vowelled here, bare in the store; "Coffee" here, "coffee" there.
    const { result, backend } = render(COFFEE);

    await waitFor(() => expect(result.current.url).toBe("https://cdn.test/coffee-ink.png"));
    expect(backend.db.reads.some((read) => read.table === "word_assets")).toBe(true);
    expect(result.current.asset).toMatchObject({ kind: "image", dialect: "Gulf", styleVersion: "ink-1" });
    expect(result.current.isLoading).toBe(false);
  });

  it("does not hand one dialect another dialect's picture", async () => {
    const { result } = render({ ...COFFEE, dialect: "Egyptian" });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.asset).toBeNull();
  });

  it("does not hand a homograph the other sense's picture", async () => {
    const { result } = render({ ...COFFEE, gloss: "café" });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.url).toBeNull();
  });

  it("asks nothing for a word the store cannot file", async () => {
    const { result, backend } = render({ ...COFFEE, dialect: "MSA" });

    expect(result.current).toEqual({ asset: null, url: null, isLoading: false });
    // Nothing queried at all, not a query that came back empty.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.db.reads.filter((read) => read.table === "word_assets")).toEqual([]);
  });

  it("is quiet with no word", () => {
    const { result } = render(null);
    expect(result.current).toEqual({ asset: null, url: null, isLoading: false });
  });

  it("reads as none while the table has not reached the live project", async () => {
    const { result } = render(COFFEE, (backend) =>
      backend.db.failAlways("word_assets", 404, {
        code: "PGRST205",
        message: "Could not find the table 'public.word_assets' in the schema cache",
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.asset).toBeNull();
  });
});
