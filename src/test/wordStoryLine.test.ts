import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { findPhraseSpan } from "@/lib/quizDialogue";
import { installSupabaseFetch } from "./support/transports/vitest";
import { SUPABASE_URL, type SupabaseBackend } from "./support/server/handler";
import { anAuthenticStory, anAuthenticStoryLine, storyId, storyLineId } from "./support/factories";
import type { Database } from "@/integrations/supabase/types";
import { assetKey, type AssetKey } from "../../supabase/functions/_shared/wordAssets";
import { detectMsaLeaks } from "../../supabase/functions/_shared/msaLeakDetector";
import {
  asStoredStoryLine,
  englishNamesSense,
  findStoryPassage,
  inCurrentRendering,
  MAX_STORY_SENTENCE_LENGTH,
  splitSentences,
  storyDialect,
  storyLicenseShareable,
  storyLinePayload,
  storyLinePrompt,
  storyLineProblem,
  storyLineSentencesForScan,
  storyPassageAsset,
  storyPassages,
  storyPassageStillLent,
  storySourceProblem,
  type StoryClient,
  type StoryLineRow,
  type StoryRow,
} from "../../supabase/functions/_shared/wordStoryLine";

/**
 * A word in a story (`supabase/functions/_shared/wordStoryLine.ts`, quiz
 * Phase 6): the passage the quiz's top step asks from, and the rule for what
 * a published story may lend it.
 *
 * The rule is what this file is for. A story carries every sentence twice —
 * the fusha it was imported from and the dialect rendering — under a licence
 * and a status, and the store files what it takes in a public table where it
 * is shown out of its story, so a passage that took the wrong half, or from
 * the wrong story, would teach every later learner of the word fusha, or show
 * a text its licence does not let us show uncredited. The search is run
 * against the in-memory project with rows built by the factories that mirror
 * the generated types, so a column the search names wrongly fails here.
 */

const morning = { arabic: "كان الصبح بارد وايد.", english: "The morning was very cold." };
const ordered = { arabic: "طلب الريال قهوة حارة.", english: "The man ordered hot coffee." };
const sat = { arabic: "بعدين قعد مع ربعه.", english: "Then he sat with his friends." };

describe("asStoredStoryLine", () => {
  it("reads two sentences, one of them using the word, and says which", () => {
    const line = asStoredStoryLine({ sentences: [morning, ordered] }, "قهوة");
    expect(line?.sentences).toEqual([morning, ordered]);
    expect(line?.gap).toBe(1);
    expect(line?.story).toBeNull();
    expect(asStoredStoryLine({ sentences: [ordered, sat] }, "قهوة")?.gap).toBe(0);
  });

  it("matches the word as the store folds it: harakat, ة and hamza seats", () => {
    expect(asStoredStoryLine({ sentences: [morning, ordered] }, "قَهْوَه")?.gap).toBe(1);
  });

  it("is not a passage with anything but exactly two sentences", () => {
    expect(asStoredStoryLine({ sentences: [ordered] }, "قهوة")).toBeNull();
    expect(asStoredStoryLine({ sentences: [morning, ordered, sat] }, "قهوة")).toBeNull();
    expect(asStoredStoryLine(null, "قهوة")).toBeNull();
    expect(asStoredStoryLine("طلب قهوة", "قهوة")).toBeNull();
  });

  it("needs Arabic and English in each sentence, short enough to follow by ear", () => {
    expect(asStoredStoryLine({ sentences: [{ ...morning, english: "" }, ordered] }, "قهوة")).toBeNull();
    expect(asStoredStoryLine({ sentences: [{ arabic: "The morning", english: "x" }, ordered] }, "قهوة")).toBeNull();
    const long = { arabic: `${"كلام ".repeat(MAX_STORY_SENTENCE_LENGTH / 4)}قهوة`, english: "Talk." };
    expect(asStoredStoryLine({ sentences: [morning, long] }, "قهوة")).toBeNull();
  });

  it("is no gap when neither sentence uses the word, or both do", () => {
    expect(asStoredStoryLine({ sentences: [morning, sat] }, "قهوة")).toBeNull();
    expect(asStoredStoryLine({ sentences: [{ arabic: "حب قهوة الصبح.", english: "x" }, ordered] }, "قهوة")).toBeNull();
  });

  it("is no gap when an attached و, ب or ال says the word a second time", () => {
    for (const other of ["كانت القهوة باردة.", "شرب وقهوة.", "جاء بقهوة."]) {
      expect(asStoredStoryLine({ sentences: [{ arabic: other, english: "x" }, ordered] }, "قهوة"), other).toBeNull();
    }
  });

  it("does not take a word with something attached for the gap itself", () => {
    // The gap is cut on a whole word; بالسوق alone is no place to cut سوق from.
    expect(asStoredStoryLine({ sentences: [morning, { arabic: "رحنا بالسوق.", english: "x" }] }, "سوق")).toBeNull();
  });

  it("holds a word of three letters or fewer to itself: وين is not زين", () => {
    const where = { arabic: "وين رحت أمس؟", english: "Where did you go yesterday?" };
    const fine = { arabic: "الجو زين اليوم.", english: "The weather is nice today." };
    expect(asStoredStoryLine({ sentences: [where, morning] }, "زين")).toBeNull();
    expect(asStoredStoryLine({ sentences: [where, fine] }, "زين")?.gap).toBe(1);
  });

  it("counts a phrase as one use, and cuts its gap as the quiz does", () => {
    const daily = { arabic: "نشرب قهوة كل يوم.", english: "We drink coffee every day." };
    const line = asStoredStoryLine({ sentences: [morning, daily] }, "كل يوم");
    expect(line?.gap).toBe(1);
    expect(findPhraseSpan(line!.sentences[1].arabic, "كل يوم")).not.toBeNull();
  });

  it("keeps the story a passage came from, and stores nothing it reads off the sentences", () => {
    const story = { id: "s1", title: "The cold morning", titleArabic: "الصبح البارد" };
    const line = asStoredStoryLine({ sentences: [morning, ordered], story }, "قهوة");
    expect(line?.story).toEqual(story);
    expect(storyLinePayload(line!)).toEqual({ sentences: [morning, ordered], story });
    expect(storyLinePayload({ sentences: [morning, ordered], story: null })).toEqual({ sentences: [morning, ordered] });
  });

  it("tells the critic what to fix, and nothing when there is nothing to", () => {
    expect(storyLineProblem({ sentences: [morning, ordered] }, "قهوة")).toBeNull();
    expect(storyLineProblem({ sentences: [morning, sat] }, "قهوة")).toMatch(/exactly two sentences/);
  });

  it("shows the leak detector quoted speech as the passage it is", () => {
    const quoted = { arabic: "قال «لماذا» وطلب قهوة.", english: "x" };
    const [, scanned] = storyLineSentencesForScan({ sentences: [morning, quoted] });
    expect(detectMsaLeaks(scanned, "Gulf").leaks).toContain("لماذا");
  });
});

describe("storyLinePrompt", () => {
  it("is built from the key's word, sense and dialect, and an authored example when there is one", () => {
    const prompt = storyLinePrompt({ word: "قهوه", sense: "coffee", dialect: "Egyptian" });
    expect(prompt).toContain("قهوه");
    expect(prompt).toContain('"coffee"');
    expect(prompt).toContain("Egyptian Arabic");
    expect(prompt).toContain("only once");
    expect(prompt).not.toContain("the course uses the word");
    expect(storyLinePrompt({ word: "قهوه", sense: "coffee", dialect: "Gulf", example: "ابي قهوة الحين" })).toContain(
      "'ابي قهوة الحين'",
    );
  });
});

describe("englishNamesSense", () => {
  it("finds every word of the sense, as itself or inflected", () => {
    expect(englishNamesSense("The man ordered hot coffee.", "coffee")).toBe(true);
    expect(englishNamesSense("We went to the market early.", "market")).toBe(true);
    expect(englishNamesSense("He eats bread every morning.", "eat")).toBe(true);
    expect(englishNamesSense("She was making tea.", "make")).toBe(true);
    expect(englishNamesSense("They were running late.", "run")).toBe(true);
    expect(englishNamesSense("Two cities.", "city")).toBe(true);
    expect(englishNamesSense("We drink coffee every day.", "every day")).toBe(true);
    expect(englishNamesSense("He runs a business in town.", "run a business")).toBe(true);
  });

  it("is strict: another sense, or a sense it cannot find, names nothing", () => {
    expect(englishNamesSense("A spring of cold water.", "eye body part")).toBe(false);
    expect(englishNamesSense("He ran home.", "run a business")).toBe(false);
    // An irregular past is not found, and the passage is written instead.
    expect(englishNamesSense("We went to the market.", "go")).toBe(false);
    // "go" is not "good".
    expect(englishNamesSense("A good day.", "go")).toBe(false);
    // A sense of nothing but small words says nothing to look for.
    expect(englishNamesSense("You are here.", "you m")).toBe(false);
  });
});

describe("the source rule", () => {
  it("lends from published stories only", () => {
    const story = { status: "published", license: "public_domain", dialect: "Gulf" };
    expect(storySourceProblem(story, "Gulf")).toBeNull();
    expect(storySourceProblem({ ...story, status: "draft" }, "Gulf")).toBe("not_published");
    expect(storySourceProblem({ ...story, status: "content_approved" }, "Gulf")).toBe("not_published");
  });

  it("lends under a licence that asks for no credit: public domain and CC0, however written", () => {
    for (const license of ["public_domain", "Public Domain", "public-domain", "CC0", "cc0", "CC-0"]) {
      expect(storyLicenseShareable(license), license).toBe(true);
    }
    for (const license of ["CC-BY", "CC-BY-SA", "cc by", "", null, undefined, "all rights reserved"]) {
      expect(storyLicenseShareable(license), String(license)).toBe(false);
    }
  });

  it("lends in the story's own dialect, and takes no label it does not know for Gulf", () => {
    expect(storyDialect("Gulf")).toBe("Gulf");
    expect(storyDialect(" egyptian ")).toBe("Egyptian");
    expect(storyDialect("Yemeni")).toBe("Yemeni");
    // The admin form's other two choices; `normalizeDialect` reads both as Gulf.
    expect(storyDialect("Levantine")).toBeNull();
    expect(storyDialect("MSA")).toBeNull();
    expect(storyDialect("")).toBeNull();
    const story = { status: "published", license: "CC0", dialect: "Egyptian" };
    expect(storySourceProblem(story, "Gulf")).toBe("dialect");
    expect(storySourceProblem(story, "Egyptian")).toBeNull();
  });
});

describe("cutting a passage from a story", () => {
  const story = (over: Partial<StoryRow> = {}): StoryRow => ({
    id: "s1",
    title: "The cold morning",
    title_arabic: "الصبح البارد",
    dialect: "Gulf",
    license: "public_domain",
    status: "published",
    ...over,
  });
  const line = (index: number, dialect: string | null, english: string, over: Partial<StoryLineRow> = {}): StoryLineRow => ({
    story_id: "s1",
    line_index: index,
    arabic: `سطر فصيح ${index}`,
    dialect,
    english,
    ...over,
  });

  it("splits a line into its sentences at . ! ? ؟ and …, and always at a newline", () => {
    expect(splitSentences("كان الصبح بارد. طلب قهوة! وين رحت؟ ما ادري… خلاص")).toEqual([
      "كان الصبح بارد.",
      "طلب قهوة!",
      "وين رحت؟",
      "ما ادري…",
      "خلاص",
    ]);
    expect(splitSentences("قال: «تعال.» وراح\nثاني")).toEqual(["قال: «تعال.»", "وراح", "ثاني"]);
  });

  it("takes the word's sentence and the one before it, from the dialect text", () => {
    const [passage] = storyPassages("قهوة", "coffee", "Gulf", [story()], [
      line(0, morning.arabic, morning.english),
      line(1, ordered.arabic, ordered.english),
      line(2, sat.arabic, sat.english),
    ]);
    expect(passage.sentences).toEqual([morning, ordered]);
    expect(passage.story).toEqual({ id: "s1", title: "The cold morning", titleArabic: "الصبح البارد" });
    expect(passage.lines).toEqual([
      { index: 0, dialect: morning.arabic },
      { index: 1, dialect: ordered.arabic },
    ]);
  });

  it("takes the one after when the word opens the story", () => {
    const [passage] = storyPassages("قهوة", "coffee", "Gulf", [story()], [
      line(0, ordered.arabic, ordered.english),
      line(1, sat.arabic, sat.english),
    ]);
    expect(passage.sentences).toEqual([ordered, sat]);
  });

  it("cuts a long line at its sentences where its English has as many, and never inside the word's", () => {
    const [passage] = storyPassages("قهوة", "coffee", "Gulf", [story()], [
      line(0, `${morning.arabic} ${ordered.arabic} ${sat.arabic}`, `${morning.english} ${ordered.english} ${sat.english}`),
    ]);
    expect(passage.sentences).toEqual([morning, ordered]);
    expect(passage.lines).toEqual([{ index: 0, dialect: `${morning.arabic} ${ordered.arabic} ${sat.arabic}` }]);
  });

  it("keeps a line whole when its English does not split the same way, and takes it only if it is short enough", () => {
    const [whole] = storyPassages("قهوة", "coffee", "Gulf", [story()], [
      line(0, morning.arabic, morning.english),
      line(1, `${ordered.arabic} ${sat.arabic}`, "The man ordered hot coffee and sat with his friends."),
    ]);
    expect(whole.sentences[1]).toEqual({
      arabic: `${ordered.arabic} ${sat.arabic}`,
      english: "The man ordered hot coffee and sat with his friends.",
    });
    const long = `${"كلام ".repeat(50)}${ordered.arabic}`;
    expect(storyPassages("قهوة", "coffee", "Gulf", [story()], [line(0, morning.arabic, morning.english), line(1, long, "x")])).toEqual([]);
  });

  it("pairs only sentences that follow on: not across a line with no rendering", () => {
    expect(
      storyPassages("قهوة", "coffee", "Gulf", [story()], [line(0, morning.arabic, morning.english), line(2, ordered.arabic, ordered.english)]),
    ).toEqual([]);
  });

  it("never reads the fusha: a line with no rendering, or one that is its fusha word for word, lends nothing", () => {
    const fusha = "طلب الرجل قهوة ساخنة.";
    expect(
      storyPassages("قهوة", "coffee", "Gulf", [story()], [
        line(0, morning.arabic, morning.english),
        line(1, null, ordered.english, { arabic: fusha }),
      ]),
    ).toEqual([]);
    expect(
      storyPassages("قهوة", "coffee", "Gulf", [story()], [
        line(0, morning.arabic, morning.english),
        line(1, fusha, ordered.english, { arabic: fusha }),
      ]),
    ).toEqual([]);
  });

  it("lends nothing from a story the source rule turns away", () => {
    const lines = [line(0, morning.arabic, morning.english), line(1, ordered.arabic, ordered.english)];
    for (const over of [{ status: "draft" }, { license: "CC-BY" }, { dialect: "Levantine" }, { dialect: "MSA" }]) {
      expect(storyPassages("قهوة", "coffee", "Gulf", [story(over)], lines), JSON.stringify(over)).toEqual([]);
    }
  });

  it("leaves out a pair the leak detector finds MSA in, quoted or not", () => {
    const leaksIn = (text: string) => detectMsaLeaks(text, "Gulf").leaks;
    const quoted = { arabic: "قال «لماذا» وطلب قهوة.", english: "He said 'why' and ordered coffee." };
    expect(
      storyPassages("قهوة", "coffee", "Gulf", [story()], [line(0, morning.arabic, morning.english), line(1, quoted.arabic, quoted.english)], leaksIn),
    ).toEqual([]);
  });

  it("offers the shortest passage first, whichever story it is in", () => {
    const short = { arabic: "شرب قهوة.", english: "He drank coffee." };
    const passages = storyPassages("قهوة", "coffee", "Gulf", [story(), story({ id: "s2" })], [
      line(0, morning.arabic, morning.english),
      line(1, ordered.arabic, ordered.english),
      line(0, "برد.", "Cold.", { story_id: "s2" }),
      line(1, short.arabic, short.english, { story_id: "s2" }),
    ]);
    expect(passages.map((p) => p.story.id)).toEqual(["s2", "s1"]);
  });

  it("takes the word only in the key's sense: the gap sentence's English must name it", () => {
    const lines = [line(0, morning.arabic, morning.english), line(1, ordered.arabic, ordered.english)];
    expect(storyPassages("قهوة", "coffee", "Gulf", [story()], lines)).toHaveLength(1);
    // The folding cannot tell a homograph apart; the English can.
    expect(storyPassages("قهوة", "eye body part", "Gulf", [story()], lines)).toEqual([]);
  });

  it("checks a passage against its story's current rendering", () => {
    const passage = { lines: [{ index: 0, dialect: morning.arabic }, { index: 1, dialect: ordered.arabic }] };
    expect(inCurrentRendering(passage, [morning.arabic, ordered.arabic, sat.arabic].join("\n"))).toBe(true);
    // Line 1 skipped by a later conversion: the body has its fusha there.
    expect(inCurrentRendering(passage, [morning.arabic, "طلب الرجل قهوة ساخنة.", sat.arabic].join("\n"))).toBe(false);
    expect(inCurrentRendering(passage, null)).toBe(false);
  });

  it("is filed as a person's, with how it was found", () => {
    const [passage] = storyPassages("قهوة", "coffee", "Gulf", [story()], [
      line(0, morning.arabic, morning.english),
      line(1, ordered.arabic, ordered.english),
    ]);
    const asset = storyPassageAsset(passage, "text-1");
    expect(asset.source).toBe("reviewed");
    expect(asset.payload).toEqual({
      sentences: [morning, ordered],
      story: { id: "s1", title: "The cold morning", titleArabic: "الصبح البارد" },
    });
    expect(asset.meta).toEqual({
      from: "story",
      story_id: "s1",
      story_title: "The cold morning",
      line_indexes: [0, 1],
      license: "public_domain",
      style: "text-1",
    });
  });
});

describe("findStoryPassage against the project's own tables", () => {
  type Story = Database["public"]["Tables"]["authentic_stories"]["Row"];
  type Line = Database["public"]["Tables"]["authentic_story_lines"]["Row"];

  let backend: SupabaseBackend;
  let restore: () => void;
  let client: StoryClient;
  let clientCount = 0;

  beforeEach(() => {
    const installed = installSupabaseFetch();
    backend = installed.backend;
    restore = installed.restore;
    // The service-role client in production; the emulator checks the columns
    // and filters, not who is asking.
    client = createClient(SUPABASE_URL, "e2e-anon-key-not-a-real-secret", {
      auth: { storageKey: `sb-word-story-line-test-${++clientCount}` },
    }) as unknown as StoryClient;
  });

  afterEach(() => restore());

  const coffee = (dialect = "Gulf") => assetKey({ kind: "story_line", word: "قهوة", gloss: "coffee", dialect }) as AssetKey;

  /** A story as the import writes it: fusha on every line, the rendering beside it, and the body rebuilt from the renderings. */
  function seed(stories: Array<{ story: Partial<Story>; lines: Array<Partial<Line>> }>) {
    const storyRows: Partial<Story>[] = [];
    const lineRows: Partial<Line>[] = [];
    stories.forEach(({ story, lines }, s) => {
      const id = story.id ?? storyId(s);
      const rendered = lines.map((l) => l.dialect ?? l.arabic ?? "");
      storyRows.push(anAuthenticStory({ id, body_fusha: lines.map((l) => l.arabic).join("\n"), body_dialect: rendered.join("\n"), ...story }) as Partial<Story>);
      lines.forEach((l, i) =>
        lineRows.push(anAuthenticStoryLine({ id: storyLineId(s * 100 + i), story_id: id, line_index: i, ...l }) as Partial<Line>),
      );
    });
    backend.db.seed("authentic_stories", storyRows);
    backend.db.seed("authentic_story_lines", lineRows);
  }

  const theMorning = (over: Array<Partial<Line>> = []): Array<Partial<Line>> =>
    [
      { arabic: "كان الصباح باردا جدا.", dialect: morning.arabic, english: morning.english },
      { arabic: "طلب الرجل قهوة ساخنة.", dialect: ordered.arabic, english: ordered.english },
      { arabic: "ثم جلس مع أصدقائه.", dialect: sat.arabic, english: sat.english },
    ].map((line, i) => ({ ...line, ...(over[i] ?? {}) }));

  it("takes the passage from a published, public-domain story in the key's dialect", async () => {
    seed([{ story: {}, lines: theMorning() }]);
    const passage = await findStoryPassage(client, coffee());
    expect(passage?.sentences).toEqual([morning, ordered]);
    expect(passage?.story.id).toBe(storyId(0));
    expect(passage?.license).toBe("public_domain");
  });

  it("finds nothing in another dialect's story, an unpublished one, or one whose licence asks for a credit", async () => {
    for (const story of [
      { dialect: "Egyptian" },
      { dialect: "Levantine" },
      { dialect: "MSA" },
      { status: "draft" },
      { status: "content_approved" },
      { license: "CC-BY" },
      { license: "CC-BY-SA" },
    ] as Array<Partial<Story>>) {
      seed([{ story, lines: theMorning() }]);
      expect(await findStoryPassage(client, coffee()), JSON.stringify(story)).toBeNull();
    }
    seed([{ story: { dialect: "Egyptian" }, lines: theMorning() }]);
    expect((await findStoryPassage(client, coffee("Egyptian")))?.sentences).toEqual([morning, ordered]);
  });

  it("never takes the fusha: an MSA story's lines, or a line its conversion skipped", async () => {
    // An MSA story has no rendering at all; the word is in its fusha only.
    seed([{ story: { dialect: "MSA" }, lines: theMorning().map((l) => ({ ...l, dialect: null })) }]);
    expect(await findStoryPassage(client, coffee())).toBeNull();
    // A Gulf story whose conversion skipped the word's line.
    seed([{ story: {}, lines: theMorning([{}, { dialect: null }]) }]);
    expect(await findStoryPassage(client, coffee())).toBeNull();
  });

  it("does not take a line an earlier rendering left behind", async () => {
    // Moved from Gulf to Egyptian with the word's line skipped: the line kept
    // its Gulf text, and the body the Egyptian conversion wrote has the fusha.
    seed([
      {
        story: {
          dialect: "Egyptian",
          body_dialect: ["كان الصبح برد قوي.", "طلب الرجل قهوة ساخنة.", "وبعدين قعد مع صحابه."].join("\n"),
        },
        lines: theMorning([{ dialect: "كان الصبح برد قوي." }, {}, { dialect: "وبعدين قعد مع صحابه." }]),
      },
    ]);
    expect(await findStoryPassage(client, coffee("Egyptian"))).toBeNull();
  });

  it("finds the word as a phrase", async () => {
    const daily = { arabic: "نشرب قهوة كل يوم.", english: "We drink coffee every day." };
    seed([
      { story: {}, lines: theMorning() },
      { story: {}, lines: [{ arabic: "نحن نشرب القهوة كل يوم.", dialect: morning.arabic, english: morning.english }, { arabic: "x", dialect: daily.arabic, english: daily.english }] },
    ]);
    const key = assetKey({ kind: "story_line", word: "كل يوم", gloss: "every day", dialect: "Gulf" }) as AssetKey;
    const passage = await findStoryPassage(client, key);
    expect(passage?.sentences).toEqual([morning, daily]);
    expect(passage?.story.id).toBe(storyId(1));
  });

  it("reads a long story's lines a page at a time, past PostgREST's thousand", async () => {
    const filler = Array.from({ length: 1100 }, (_, i) => ({
      arabic: `سطر ${i}`,
      dialect: `كلام عادي رقم ${i}.`,
      english: `Plain talk number ${i}.`,
    }));
    filler[1049] = { arabic: "كان الصباح باردا جدا.", dialect: morning.arabic, english: morning.english };
    filler[1050] = { arabic: "طلب الرجل قهوة ساخنة.", dialect: ordered.arabic, english: ordered.english };
    seed([{ story: {}, lines: filler }]);
    expect((await findStoryPassage(client, coffee()))?.sentences).toEqual([morning, ordered]);
  });

  describe("whether a filed passage is still lent", () => {
    const filedFrom = (over: Record<string, unknown> = {}) => ({
      payload: { sentences: [morning, ordered], story: { id: storyId(0), title: "A story", titleArabic: "" } },
      meta: { from: "story", story_id: storyId(0), line_indexes: [0, 1], license: "public_domain" },
      ...over,
    });

    it("is while its story still lends it", async () => {
      seed([{ story: {}, lines: theMorning() }]);
      expect(await storyPassageStillLent(client, coffee(), filedFrom())).toBe(true);
    });

    it("is not once its story is unpublished, re-licensed, moved to another dialect, re-converted or gone", async () => {
      for (const story of [{ status: "draft" }, { license: "CC-BY" }, { dialect: "Egyptian" }] as Array<Partial<Story>>) {
        seed([{ story, lines: theMorning() }]);
        expect(await storyPassageStillLent(client, coffee(), filedFrom()), JSON.stringify(story)).toBe(false);
      }
      seed([{ story: {}, lines: theMorning([{}, { dialect: "طلب الريال قهوة بارده." }]) }]);
      expect(await storyPassageStillLent(client, coffee(), filedFrom())).toBe(false);
      seed([]);
      expect(await storyPassageStillLent(client, coffee(), filedFrom())).toBe(false);
    });

    it("has nothing to say about a passage written for the word, or when a read fails", async () => {
      seed([{ story: {}, lines: theMorning() }]);
      expect(await storyPassageStillLent(client, coffee(), filedFrom({ meta: {} }))).toBeNull();
      backend.db.failAlways("authentic_stories", 500, { code: "XX000", message: "down" });
      expect(await storyPassageStillLent(client, coffee(), filedFrom())).toBeNull();
    });
  });

  it("is no passage, rather than an error, when a read fails", async () => {
    seed([{ story: {}, lines: theMorning() }]);
    backend.db.failAlways("authentic_story_lines", 500, { code: "XX000", message: "down" });
    expect(await findStoryPassage(client, coffee())).toBeNull();
  });
});
