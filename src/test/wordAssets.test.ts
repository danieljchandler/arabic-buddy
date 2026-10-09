import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { normalizeArabicWord } from "@/lib/arabicWord";
import { installSupabaseFetch } from "./support/transports/vitest";
import { SUPABASE_URL, type SupabaseBackend } from "./support/server/handler";
import {
  ASSET_KINDS,
  INK_PICTURE_STYLE,
  STYLE_VERSIONS,
  assetKey,
  assetObjectPath,
  getAsset,
  inkPicturePrompt,
  normaliseAssetWord,
  normaliseGloss,
  putAsset,
  type AssetKey,
  type WordAssetClient,
} from "../../supabase/functions/_shared/wordAssets";

/**
 * The shared asset store's key, its picture style, and its two store calls
 * (`supabase/functions/_shared/wordAssets.ts`).
 *
 * The key is the part that decides what every learner is shown, so it gets
 * most of the cases: a key too coarse serves one word's picture for another,
 * and a key too fine only costs a second generation — so every judgement call
 * here leans fine. The store calls run against the in-memory PostgREST
 * emulator, which rejects an unknown column the way PostgREST does, so a
 * misspelt column in either query fails here rather than as a silent miss in
 * production.
 */

describe("assetKey", () => {
  it("folds the Arabic exactly as a saved word is folded", () => {
    // Two copies of one rule (the edge bundle cannot import src/lib), held to
    // one answer here.
    for (const word of ["بَيْت", "أكل،", "«مستشفى»", "مدرسة؟", "إبرة", "  قهوة  ", "على"]) {
      expect(normaliseAssetWord(word)).toBe(normalizeArabicWord(word));
    }
  });

  it("gives a vocalised word and its bare spelling one key", () => {
    // Enrichment returns بَيْت; a transcript holds بيت. Same word, same picture.
    const vocalised = assetKey({ kind: "image", word: "بَيْت", gloss: "house", dialect: "Gulf" });
    const bare = assetKey({ kind: "image", word: "بيت", gloss: "house", dialect: "Gulf" });
    expect(vocalised).not.toBeNull();
    expect(vocalised).toEqual(bare);
  });

  it("keeps homographs apart by their sense", () => {
    // The folding removes exactly the harakat that tell حَب from حُب, so the
    // English sense is what stops "love" being shown a picture of seeds.
    const seeds = assetKey({ kind: "image", word: "حَب", gloss: "seeds", dialect: "Gulf" });
    const love = assetKey({ kind: "image", word: "حُب", gloss: "love", dialect: "Gulf" });
    expect(seeds?.conceptKey).toBe("حب|seeds");
    expect(love?.conceptKey).toBe("حب|love");
  });

  it("treats small differences in how a gloss is typed as one sense", () => {
    const keys = ["eat", "To eat", "EAT.", "  to   eat "].map(
      (gloss) => assetKey({ kind: "image", word: "ياكل", gloss, dialect: "Gulf" })?.conceptKey,
    );
    expect(new Set(keys)).toEqual(new Set(["ياكل|eat"]));
  });

  it("keeps a qualified sense apart from the bare one", () => {
    expect(normaliseGloss("eye (body part)")).toBe("eye body part");
    expect(normaliseGloss("eye")).toBe("eye");
    // An article on its own is a gloss, not a prefix to drop.
    expect(normaliseGloss("the")).toBe("the");
  });

  it("files a word per dialect, folding every label the app uses onto three", () => {
    const dialectOf = (dialect: string | null | undefined) =>
      assetKey({ kind: "image", word: "قهوة", gloss: "coffee", dialect })?.dialect;
    expect(dialectOf("Gulf")).toBe("Gulf");
    expect(dialectOf("Saudi")).toBe("Gulf");
    expect(dialectOf("khaleeji")).toBe("Gulf");
    expect(dialectOf("masri")).toBe("Egyptian");
    expect(dialectOf("Yemeni")).toBe("Yemeni");
    // The same default every voice and generator already applies.
    expect(dialectOf(undefined)).toBe("Gulf");
  });

  it("refuses Fusha: the store holds nothing a dialect learner should not be shown", () => {
    expect(assetKey({ kind: "image", word: "قهوة", gloss: "coffee", dialect: "MSA" })).toBeNull();
    expect(assetKey({ kind: "word_audio", word: "قهوة", dialect: "fusha" })).toBeNull();
  });

  it("refuses a word with no Arabic in it, and a kind it does not know", () => {
    expect(assetKey({ kind: "image", word: "coffee", gloss: "coffee" })).toBeNull();
    expect(assetKey({ kind: "image", word: "...", gloss: "coffee" })).toBeNull();
    expect(assetKey({ kind: "poster", word: "قهوة", gloss: "coffee" })).toBeNull();
  });

  it("keys a language-neutral kind on the English concept alone", () => {
    // Every dialect's "jump" shares one animation.
    const gulf = assetKey({ kind: "animation", word: "ينط", gloss: "to jump", dialect: "Gulf" });
    const egyptian = assetKey({ kind: "animation", word: "ينط", gloss: "jump", dialect: "Egyptian" });
    expect(gulf).toEqual({ conceptKey: "jump", kind: "animation", dialect: null, styleVersion: "ink-1" });
    expect(egyptian).toEqual(gulf);
    expect(assetKey({ kind: "animation", word: "ينط" })).toBeNull();
  });

  it("carries the kind's current style, so a brand refresh misses rather than mixes", () => {
    for (const kind of ASSET_KINDS) {
      const key = assetKey({ kind, word: "قهوة", gloss: "coffee", dialect: "Gulf" });
      expect(key?.styleVersion).toBe(STYLE_VERSIONS[kind]);
    }
    expect(STYLE_VERSIONS.image).toBe("ink-1");
  });

  it("refuses a key longer than anything worth filing", () => {
    expect(assetKey({ kind: "sentence_audio", word: "كلمة ".repeat(80) })).toBeNull();
  });
});

describe("assetObjectPath", () => {
  const key = assetKey({ kind: "image", word: "قهوة", gloss: "coffee", dialect: "Gulf" }) as AssetKey;

  it("is stable, so two learners who miss at once overwrite one object", async () => {
    expect(await assetObjectPath(key, "png")).toBe(await assetObjectPath({ ...key }, "png"));
  });

  it("never carries the Arabic or the gloss", async () => {
    const path = await assetObjectPath(key, "png");
    expect(path).toMatch(/^word-assets\/image\/ink-1\/gulf\/[0-9a-f]{32}\.png$/);
  });

  it("differs per dialect and per word", async () => {
    const egyptian = { ...key, dialect: "Egyptian" as const };
    const tea = assetKey({ kind: "image", word: "شاي", gloss: "tea", dialect: "Gulf" }) as AssetKey;
    const paths = await Promise.all([key, egyptian, tea].map((k) => assetObjectPath(k, "png")));
    expect(new Set(paths).size).toBe(3);
  });

  it("does not let an extension escape the folder", async () => {
    expect(await assetObjectPath(key, "../../x")).toMatch(/\.bin$/);
  });
});

describe("the Ink picture style", () => {
  it("is the Ink palette, flat, and never a photograph", () => {
    // docs/brand-refresh.md: the owner has ruled out photography, and Ink is
    // oxblood and mustard on cream with a near-black.
    for (const ink of ["#6B1F1F", "#E2B65C", "#1A1C17", "#EFE6CF"]) {
      expect(INK_PICTURE_STYLE).toContain(ink);
    }
    expect(INK_PICTURE_STYLE).toMatch(/Not a photograph, not photo-realistic/);
    expect(INK_PICTURE_STYLE).toMatch(/never by gradients/);
    expect(INK_PICTURE_STYLE).not.toMatch(/watercolou?r illustration/i);
  });

  it("asks for no text at all, which is also what keeps a picture out of Fusha", () => {
    expect(INK_PICTURE_STYLE).toMatch(/No text of any kind/);
    expect(INK_PICTURE_STYLE).toMatch(/no Arabic or English words/);
  });

  it("builds the prompt from the sense and the dialect", () => {
    const prompt = inkPicturePrompt({ gloss: "coffee", dialect: "Egyptian" });
    expect(prompt).toContain('the meaning "coffee"');
    expect(prompt).toContain(INK_PICTURE_STYLE);
    expect(prompt).toMatch(/from Egypt today/);
    expect(prompt).not.toMatch(/Arabian Gulf/);
  });

  it("leaves the setting out of a language-neutral picture", () => {
    expect(inkPicturePrompt({ gloss: "jump", dialect: null })).not.toMatch(/If people or places appear/);
  });

  it("takes an authored scene when there is one", () => {
    const prompt = inkPicturePrompt({
      gloss: "coffee",
      dialect: "Gulf",
      scene: "a brass dallah pouring into a small finjan",
    });
    expect(prompt).toContain("Scene: a brass dallah pouring into a small finjan");
  });

  it("keeps a learner's gloss short and unable to close the quote", () => {
    const prompt = inkPicturePrompt({ gloss: `coffee" and also a ${"very ".repeat(40)}long note`, dialect: "Gulf" });
    const line = prompt.split("\n")[0];
    expect(line).toMatch(/^A picture that shows, unmistakably and on its own, the meaning "coffee' and also a very/);
    expect(line.length).toBeLessThan(160);
  });
});

describe("the store", () => {
  let backend: SupabaseBackend;
  let restore: () => void;
  let client: WordAssetClient;
  let clientCount = 0;

  beforeEach(() => {
    const installed = installSupabaseFetch();
    backend = installed.backend;
    restore = installed.restore;
    // The service-role client in production; any client against the emulator,
    // which checks the columns and filters and not who is asking.
    client = createClient(SUPABASE_URL, "e2e-anon-key-not-a-real-secret", {
      auth: { storageKey: `sb-word-assets-test-${++clientCount}` },
    }) as unknown as WordAssetClient;
    backend.db.seed("word_assets", []);
  });

  afterEach(() => restore());

  const coffee = () => assetKey({ kind: "image", word: "قهوة", gloss: "coffee", dialect: "Gulf" }) as AssetKey;

  it("misses when nothing has been made", async () => {
    expect(await getAsset(client, coffee())).toBeNull();
  });

  it("files an asset and finds it again for the next learner", async () => {
    const put = await putAsset(client, coffee(), {
      url: "https://cdn.test/coffee.png",
      meta: { model: "test-model" },
    });
    expect(put.status).toBe("stored");

    const found = await getAsset(client, coffee());
    expect(found).toMatchObject({
      conceptKey: "قهوه|coffee",
      kind: "image",
      dialect: "Gulf",
      styleVersion: "ink-1",
      url: "https://cdn.test/coffee.png",
      meta: { model: "test-model" },
      source: "generated",
    });
  });

  it("does not serve another dialect's asset, or another style's", async () => {
    await putAsset(client, coffee(), { url: "https://cdn.test/coffee.png" });

    expect(await getAsset(client, { ...coffee(), dialect: "Egyptian" })).toBeNull();
    expect(await getAsset(client, { ...coffee(), styleVersion: "ink-0" })).toBeNull();
    expect(await getAsset(client, { ...coffee(), kind: "jingle" })).toBeNull();
  });

  it("finds a language-neutral asset by its null dialect", async () => {
    const jump = assetKey({ kind: "animation", gloss: "jump" }) as AssetKey;
    await putAsset(client, jump, { url: "https://cdn.test/jump.webm" });

    expect((await getAsset(client, jump))?.url).toBe("https://cdn.test/jump.webm");
  });

  it("keeps a text asset's payload", async () => {
    const lyrics = assetKey({ kind: "jingle", word: "قهوة", gloss: "coffee" }) as AssetKey;
    await putAsset(client, lyrics, { url: "https://cdn.test/j.wav", payload: { lyrics: "قهوة قهوة" } });

    expect((await getAsset(client, lyrics))?.payload).toEqual({ lyrics: "قهوة قهوة" });
  });

  it("refuses to file an asset with nothing in it, without asking the database", async () => {
    const before = backend.db.raw("word_assets").length;
    expect(await putAsset(client, coffee(), {})).toEqual({ status: "failed", error: "nothing to store" });
    expect(backend.db.raw("word_assets")).toHaveLength(before);
  });

  it("serves the winner when another learner filed one first", async () => {
    // The unique index is what decides a race; the loser is served the
    // winner's picture so every learner sees the same one.
    backend.db.seed("word_assets", [
      {
        id: "a1",
        concept_key: "قهوه|coffee",
        kind: "image",
        dialect: "Gulf",
        style_version: "ink-1",
        url: "https://cdn.test/first.png",
        payload: null,
        meta: {},
        source: "generated",
        approved_at: null,
        created_at: "2026-10-09T00:00:00Z",
      },
    ]);
    backend.db.failNextWrite("word_assets", 409, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "word_assets_one_per_key"',
    });

    const put = await putAsset(client, coffee(), { url: "https://cdn.test/second.png" });

    expect(put.status).toBe("taken");
    expect(put.status === "taken" && put.asset?.url).toBe("https://cdn.test/first.png");
  });

  describe("before the migration is applied to the live project", () => {
    const missingTable = {
      code: "PGRST205",
      message: "Could not find the table 'public.word_assets' in the schema cache",
    };

    it("misses rather than failing", async () => {
      backend.db.failAlways("word_assets", 404, missingTable);
      expect(await getAsset(client, coffee())).toBeNull();
    });

    it("declines to file rather than throwing", async () => {
      backend.db.failAlways("word_assets", 404, missingTable);
      const put = await putAsset(client, coffee(), { url: "https://cdn.test/coffee.png" });
      expect(put.status).toBe("failed");
    });
  });
});
