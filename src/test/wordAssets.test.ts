import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { normalizeArabicWord } from "@/lib/arabicWord";
import { installSupabaseFetch } from "./support/transports/vitest";
import { SUPABASE_URL, type SupabaseBackend } from "./support/server/handler";
import {
  ASSET_KINDS,
  INK_PICTURE_STYLE,
  MAX_SCENE_LENGTH,
  PICTURE_DISTINCT_LINE,
  STYLE_VERSIONS,
  assetKey,
  assetObjectPath,
  fileNewAsset,
  getAsset,
  inkPicturePrompt,
  isReplaceable,
  kindNeedsSense,
  normaliseAssetWord,
  normaliseGloss,
  putAsset,
  replaceAsset,
  type AssetKey,
  type AssetStorage,
  type WordAsset,
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
    expect(gulf).toEqual({ conceptKey: "jump", kind: "animation", dialect: null, styleVersion: "ink-1", sense: "jump" });
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

  it("needs a meaning for anything that shows or sings one", () => {
    // Without the sense the key is the bare folded word, which is exactly the
    // key a homograph shares. A gloss of nothing but emoji or punctuation
    // folds to no sense at all, so it is no gloss.
    expect(kindNeedsSense("image")).toBe(true);
    expect(kindNeedsSense("jingle")).toBe(true);
    expect(kindNeedsSense("word_audio")).toBe(false);
    expect(assetKey({ kind: "image", word: "حب", dialect: "Gulf" })).toBeNull();
    expect(assetKey({ kind: "image", word: "حب", gloss: "💀🔥 !!", dialect: "Gulf" })).toBeNull();
    expect(assetKey({ kind: "jingle", word: "حب", gloss: "", dialect: "Gulf" })).toBeNull();
  });

  it("carries the folded sense, which is what a shared prompt is built from", () => {
    // The emoji is not in the key, so it must not be in the picture either.
    const key = assetKey({ kind: "image", word: "بيت", gloss: "House 💀🔥", dialect: "Gulf" });
    expect(key?.conceptKey).toBe("بيت|house");
    expect(key?.sense).toBe("house");
  });

  it("refuses a word carrying the separator, so it cannot pose as another word's sense", () => {
    // "بيت|house" with a gloss that folds away would otherwise land on the
    // real بيت's "house" key.
    expect(assetKey({ kind: "image", word: "بيت|house", gloss: "door", dialect: "Gulf" })).toBeNull();
  });

  it("keys a recording on exactly what is read, harakat and all", () => {
    // The voice reads the harakat, so a word re-vowelled to fix how it is
    // said is a new recording; the sense plays no part, since two homographs
    // written alike are read alike.
    const seeds = assetKey({ kind: "word_audio", word: "حَبّ", dialect: "Gulf" });
    const love = assetKey({ kind: "word_audio", word: "حُبّ", dialect: "Gulf" });
    expect(seeds?.conceptKey).toBe("حَبّ");
    expect(love?.conceptKey).not.toBe(seeds?.conceptKey);
    expect(assetKey({ kind: "word_audio", word: "  بيت  ", gloss: "house", dialect: "Gulf" })).toMatchObject({
      conceptKey: "بيت",
      sense: "",
    });
  });

  it("does not take a run of tatweel for a word", () => {
    expect(assetKey({ kind: "image", word: "ـــ", gloss: "line", dialect: "Gulf" })).toBeNull();
    expect(assetKey({ kind: "word_audio", word: "ـــ", dialect: "Gulf" })).toBeNull();
  });

  it("files an unreadable dialect label as Gulf rather than throwing", () => {
    const dialect = 7 as unknown as string;
    expect(assetKey({ kind: "image", word: "قهوة", gloss: "coffee", dialect })?.dialect).toBe("Gulf");
  });

  it("refuses a key longer than anything worth filing", () => {
    expect(assetKey({ kind: "sentence_audio", word: "كلمة ".repeat(80) })).toBeNull();
  });
});

describe("assetObjectPath", () => {
  const key = assetKey({ kind: "image", word: "قهوة", gloss: "coffee", dialect: "Gulf" }) as AssetKey;
  const folder = (path: string) => path.slice(0, path.lastIndexOf("/"));

  it("files every object for a word in one folder", async () => {
    expect(folder(await assetObjectPath(key, "png"))).toBe(folder(await assetObjectPath({ ...key }, "png")));
  });

  it("never reuses an object, so a url a learner was given keeps playing what they got", async () => {
    // Two learners who miss at once each get their own object; only the one
    // the table files is ever served to a third.
    expect(await assetObjectPath(key, "png")).not.toBe(await assetObjectPath(key, "png"));
  });

  it("never carries the Arabic or the gloss", async () => {
    const path = await assetObjectPath(key, "png");
    expect(path).toMatch(/^word-assets\/image\/ink-1\/gulf\/[0-9a-f]{32}\/[0-9a-f-]{36}\.png$/);
  });

  it("differs per dialect and per word", async () => {
    const egyptian = { ...key, dialect: "Egyptian" as const };
    const tea = assetKey({ kind: "image", word: "شاي", gloss: "tea", dialect: "Gulf" }) as AssetKey;
    const folders = await Promise.all([key, egyptian, tea].map(async (k) => folder(await assetObjectPath(k, "png"))));
    expect(new Set(folders).size).toBe(3);
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

  it("keeps an authored scene to a sentence or two", () => {
    const prompt = inkPicturePrompt({ gloss: "coffee", dialect: "Gulf", scene: "steam ".repeat(200) });
    const line = prompt.split("\n").find((l) => l.startsWith("Scene: ")) ?? "";
    expect(line.length).toBeLessThanOrEqual("Scene: ".length + MAX_SCENE_LENGTH);
  });

  it("asks for a picture that can be told from three others", () => {
    // The quiz's picture step deals four pictures, one per word. A template
    // that lets every word be "a person in a room" makes four right answers.
    for (const scene of [null, "a brass dallah pouring into a small finjan"]) {
      const prompt = inkPicturePrompt({ gloss: "coffee", dialect: "Gulf", scene });
      expect(prompt).toContain(PICTURE_DISTINCT_LINE);
    }
    expect(PICTURE_DISTINCT_LINE).toMatch(/beside the pictures of three other words/);
    expect(PICTURE_DISTINCT_LINE).toMatch(/particular to\s+this meaning/);
    // Part of the template, not of the look: the look is what a style-version
    // bump is for, and this must not need one.
    expect(INK_PICTURE_STYLE).not.toContain("three other words");
    expect(STYLE_VERSIONS.image).toBe("ink-1");
  });

  it("keeps a learner's gloss short and unable to close the quote", () => {
    const prompt = inkPicturePrompt({ gloss: `coffee" and also a ${"very ".repeat(40)}long note`, dialect: "Gulf" });
    const line = prompt.split("\n")[0];
    expect(line).toMatch(/^A picture that shows, unmistakably and on its own, the meaning "coffee' and also a very/);
    expect(line.length).toBeLessThan(200);
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

  describe("fileNewAsset", () => {
    /** A bucket that records what was put in it and can be told to refuse. */
    function aBucket(refuse?: string) {
      const uploads: Array<{ bucket: string; path: string; upsert: boolean; contentType: string }> = [];
      const storage: AssetStorage = {
        storage: {
          from: (bucket) => ({
            upload: async (path, _body, options) => {
              uploads.push({ bucket, path, upsert: options.upsert, contentType: options.contentType });
              return { error: refuse ? { message: refuse } : null };
            },
            getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
          }),
        },
      };
      return { storage, uploads };
    }
    const file = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", extension: "png" };

    it("uploads under a fresh name, never over another object, and files it", async () => {
      const bucket = aBucket();
      const result = await fileNewAsset(bucket.storage, client, coffee(), file, { meta: { model: "m" } });

      expect(bucket.uploads).toHaveLength(1);
      expect(bucket.uploads[0]).toMatchObject({ bucket: "flashcard-images", upsert: false, contentType: "image/png" });
      expect(bucket.uploads[0].path).toMatch(/^word-assets\/image\/ink-1\/gulf\/[0-9a-f]{32}\/[0-9a-f-]{36}\.png$/);
      expect(result).toMatchObject({ url: `https://cdn.test/flashcard-images/${bucket.uploads[0].path}`, filed: { status: "stored" } });
      expect((await getAsset(client, coffee()))?.url).toBe("https://cdn.test/flashcard-images/" + bucket.uploads[0].path);
    });

    it("files nothing when the upload is refused", async () => {
      const result = await fileNewAsset(aBucket("bucket full").storage, client, coffee(), file, {});
      expect(result).toEqual({ error: "bucket full" });
      expect(await getAsset(client, coffee())).toBeNull();
    });

    it("hands back its own url, and says another learner filed first, on a race", async () => {
      await putAsset(client, coffee(), { url: "https://cdn.test/first.png" });
      backend.db.failNextWrite("word_assets", 409, { code: "23505", message: "duplicate key" });

      const result = await fileNewAsset(aBucket().storage, client, coffee(), file, {});

      expect("url" in result && result.url).toMatch(/^https:\/\/cdn\.test\/flashcard-images\/word-assets\//);
      expect("filed" in result && result.filed.status).toBe("taken");
    });

    it("refuses a kind that has no file", async () => {
      const dialogue = assetKey({ kind: "dialogue", word: "قهوة", gloss: "coffee" }) as AssetKey;
      const bucket = aBucket();
      expect(await fileNewAsset(bucket.storage, client, dialogue, file, {})).toEqual({
        error: "dialogue assets have no file",
      });
      expect(bucket.uploads).toEqual([]);
    });
  });

  describe("replacing a picture drawn from the gloss alone", () => {
    // Curriculum words and learners' words share keys, and whichever is made
    // first is filed. The script's authored scene takes the place of what a
    // learner's miss drew — and of nothing a person authored or passed.
    const AUTHORED = { url: "https://cdn.test/authored.png", source: "authored" as const, meta: { scene: "a dallah" } };

    async function filed(over: Record<string, unknown> = {}): Promise<WordAsset> {
      backend.db.seed("word_assets", [
        {
          id: "a1",
          concept_key: "قهوه|coffee",
          kind: "image",
          dialect: "Gulf",
          style_version: "ink-1",
          url: "https://cdn.test/gloss-only.png",
          payload: null,
          meta: { model: "m" },
          source: "generated",
          approved_at: null,
          created_at: "2026-10-09T00:00:00Z",
          ...over,
        },
      ]);
      return (await getAsset(client, coffee())) as WordAsset;
    }

    it("is only ever an unapproved generated asset that gives way", async () => {
      expect(isReplaceable(await filed())).toBe(true);
      expect(isReplaceable(await filed({ source: "authored" }))).toBe(false);
      expect(isReplaceable(await filed({ source: "reviewed" }))).toBe(false);
      expect(isReplaceable(await filed({ approved_at: "2026-10-09T10:00:00Z" }))).toBe(false);
    });

    it("points the same row at the authored picture, and records what it took the place of", async () => {
      const existing = await filed();
      const outcome = await replaceAsset(client, coffee(), existing, AUTHORED);

      expect(outcome).toMatchObject({
        status: "replaced",
        previousUrl: "https://cdn.test/gloss-only.png",
        asset: { id: "a1", url: "https://cdn.test/authored.png", source: "authored" },
      });
      // One row for the key still, and it is what the next learner is served.
      expect(backend.db.raw("word_assets")).toHaveLength(1);
      expect(await getAsset(client, coffee())).toMatchObject({
        url: "https://cdn.test/authored.png",
        meta: { scene: "a dallah", replaces: "https://cdn.test/gloss-only.png" },
      });
    });

    it("refuses anything that is not authored or reviewed, without asking the database", async () => {
      // What a learner's generation holds. Nothing it has is accepted here.
      const existing = await filed();
      for (const source of ["generated", undefined] as const) {
        expect(await replaceAsset(client, coffee(), existing, { url: "https://cdn.test/mine.png", source })).toEqual({
          status: "failed",
          error: "only an authored or reviewed asset replaces a filed one",
        });
      }
      expect(await replaceAsset(client, coffee(), existing, { source: "authored" })).toEqual({
        status: "failed",
        error: "nothing to store",
      });
      expect((await getAsset(client, coffee()))?.url).toBe("https://cdn.test/gloss-only.png");
    });

    it("leaves an authored, reviewed or approved asset where it is", async () => {
      for (const over of [{ source: "authored" }, { source: "reviewed" }, { approved_at: "2026-10-09T10:00:00Z" }]) {
        const existing = await filed(over);
        const outcome = await replaceAsset(client, coffee(), existing, AUTHORED);
        expect(outcome).toMatchObject({ status: "taken", asset: { url: "https://cdn.test/gloss-only.png" } });
        expect((await getAsset(client, coffee()))?.url).toBe("https://cdn.test/gloss-only.png");
      }
    });

    it("does not overwrite a picture approved between the read and the write", async () => {
      // Read as replaceable; a reviewer approved it before the update landed.
      // The update is conditional, so it matches nothing.
      const stale = await filed();
      await filed({ approved_at: "2026-10-09T10:00:00Z" });

      const outcome = await replaceAsset(client, coffee(), stale, AUTHORED);

      expect(outcome).toMatchObject({
        status: "taken",
        asset: { url: "https://cdn.test/gloss-only.png", approvedAt: "2026-10-09T10:00:00Z" },
      });
    });

    it("uploads the replacement as a new object and never over the old one", async () => {
      const existing = await filed();
      const uploads: Array<{ path: string; upsert: boolean }> = [];
      const storage: AssetStorage = {
        storage: {
          from: (bucket) => ({
            upload: async (path, _body, options) => {
              uploads.push({ path, upsert: options.upsert });
              return { error: null };
            },
            getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
          }),
        },
      };

      const result = await fileNewAsset(
        storage,
        client,
        coffee(),
        { bytes: new Uint8Array([1]), contentType: "image/png", extension: "png" },
        { source: "authored", meta: { scene: "a dallah" } },
        { replace: existing },
      );

      expect(uploads).toHaveLength(1);
      expect(uploads[0].upsert).toBe(false);
      expect(uploads[0].path).toMatch(/^word-assets\/image\/ink-1\/gulf\/[0-9a-f]{32}\/[0-9a-f-]{36}\.png$/);
      expect(result).toMatchObject({
        url: `https://cdn.test/flashcard-images/${uploads[0].path}`,
        filed: { status: "replaced", previousUrl: "https://cdn.test/gloss-only.png" },
      });
      expect(backend.db.raw("word_assets")).toHaveLength(1);
    });

    it("declines rather than throwing while the table is not there", async () => {
      const existing = await filed();
      backend.db.failAlways("word_assets", 404, {
        code: "PGRST205",
        message: "Could not find the table 'public.word_assets' in the schema cache",
      });
      expect((await replaceAsset(client, coffee(), existing, AUTHORED)).status).toBe("failed");
    });
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
