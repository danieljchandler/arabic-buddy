import { describe, expect, it } from "vitest";
import {
  buildReviewSystemPrompt,
  containsArabic,
  encodeAppFrame,
  extractArabicRuns,
  foldArabic,
  isParseableReview,
  parseJsonArray,
  parseNativeReview,
  readAppFrame,
  renderReviewTargets,
  selectReviewTargets,
  type NativeReviewFrame,
  type ReviewTarget,
} from "../../supabase/functions/_shared/arabicReviewCore";

/**
 * The post-stream native review of the assistant's own Arabic.
 *
 * Two of these tests are about the feature being *quiet*. A reviewer that
 * corrects a transcript line, or hands back the same words it was given, is
 * worse than no reviewer at all: the learner cannot tell which of the two
 * readings in front of them is the app's own, and stops believing either.
 */
describe("arabicReviewCore", () => {
  describe("extractArabicRuns", () => {
    it("pulls the Arabic out of a tutor's English answer", () => {
      const reply = "In Gulf Arabic you'd say شلونك (shlonak) rather than كيف حالك (kayf haalak).";
      expect(extractArabicRuns(reply)).toEqual(["شلونك", "كيف حالك"]);
    });

    it("does not take the markdown with it", () => {
      expect(extractArabicRuns("**شلونك** and _زين_")).toEqual(["شلونك", "زين"]);
    });

    it("keeps a sentence together across its own punctuation", () => {
      expect(extractArabicRuns("شلونك، شخبارك؟")).toEqual(["شلونك، شخبارك؟"]);
    });

    it("finds nothing in an English-only reply", () => {
      expect(extractArabicRuns("Word order is verb-subject-object here.")).toEqual([]);
      expect(containsArabic("no arabic at all")).toBe(false);
    });
  });

  describe("foldArabic", () => {
    it("folds the spelling variants that make the same phrase look different", () => {
      expect(foldArabic("الْكِتَاب")).toBe(foldArabic("الكتاب"));
      expect(foldArabic("إلى")).toBe(foldArabic("الي"));
      expect(foldArabic("مدرسة")).toBe(foldArabic("مدرسه"));
    });

    it("drops punctuation and latin, so prose and a bare quote compare equal", () => {
      expect(foldArabic("«شلونك»,")).toBe(foldArabic("شلونك"));
      expect(foldArabic("شلونك (shlonak)")).toBe(foldArabic("شلونك"));
    });
  });

  describe("selectReviewTargets", () => {
    it("numbers the runs it wants an opinion on", () => {
      const targets = selectReviewTargets("Say شلونك, or زين if you're answering.");
      expect(targets).toEqual([
        { id: 1, arabic: "شلونك" },
        { id: 2, arabic: "زين" },
      ]);
    });

    it("never reviews Arabic quoted from the page — that is a native speaker's own words", () => {
      // The tutor quotes the transcript line the learner is watching, then adds
      // its own phrasing. Only the second is the tutor's to answer for.
      const page = "▶ 00:12 — وش تسوي هني؟";
      const reply = "The line وش تسوي هني؟ means 'what are you doing here'. You could also say شنو تسوي.";
      expect(selectReviewTargets(reply, { sources: [page] })).toEqual([
        { id: 1, arabic: "شنو تسوي" },
      ]);
    });

    it("matches a quotation through the vowels a tutor adds to it", () => {
      const page = "وش تسوي";
      expect(selectReviewTargets("The line وِشْ تِسَوّي is fully voweled here.", { sources: [page] }))
        .toEqual([]);
    });

    it("keeps the tutor's own words when they share a breath with the quotation", () => {
      // "You wrote X, say Y" is one run by the extractor's reckoning — the
      // comma is glue, not a boundary. Dropping the run whole would let the
      // correction itself, the one thing worth judging here, through
      // unreviewed.
      const targets = selectReviewTargets("You wrote كيف حالك، شلونك is the Gulf form.", {
        sources: ["is كيف حالك right?"],
      });
      expect(targets).toEqual([{ id: 1, arabic: "شلونك" }]);
    });

    it("leaves a clause that still carries the quotation alone", () => {
      // Partly the learner's words. Silence is the cheaper mistake: a note
      // striking through a phrase they wrote reads as the tutor having said it.
      expect(
        selectReviewTargets("You wrote كيف حالك زين.", { sources: ["كيف حالك"] }),
      ).toEqual([]);
    });

    it("ignores a source too short to be a quotation", () => {
      // A stray letter in a learner's question is contained in almost any
      // candidate. Treated as a quotation it would switch the review off for
      // the rest of the conversation.
      expect(selectReviewTargets("Say ما أدري.", { sources: ["ا"] })).toEqual([
        { id: 1, arabic: "ما أدري" },
      ]);
    });

    it("asks about a one-word answer, which is where the leak word list is weakest", () => {
      expect(selectReviewTargets("It's ذهب.")).toEqual([{ id: 1, arabic: "ذهب" }]);
    });

    it("says the same run once, and stops at the cap", () => {
      const reply = "شلونك … شلونك … زين … بخير … تمام … حلو";
      const targets = selectReviewTargets(reply);
      expect(targets).toHaveLength(4);
      expect(targets.map((t) => t.arabic)).toEqual(["شلونك", "زين", "بخير", "تمام"]);
    });

    it("ignores a fragment too short to have an opinion about", () => {
      expect(selectReviewTargets("The prefix ب here.")).toEqual([]);
    });
  });

  describe("the prompt", () => {
    it("names the dialect and demands English field names", () => {
      const prompt = buildReviewSystemPrompt("Gulf");
      expect(prompt).toContain("Gulf");
      expect(prompt).toContain("Keep every field name in English");
      // The default answer has to be "nothing", or a judge finds something.
      expect(prompt).toContain("If every line is fine, reply [].");
    });

    it("numbers the lines the way the reply is asked to cite them", () => {
      const targets: ReviewTarget[] = [
        { id: 1, arabic: "شلونك" },
        { id: 2, arabic: "زين" },
      ];
      expect(renderReviewTargets(targets)).toBe("1. شلونك\n2. زين");
    });
  });

  describe("parseJsonArray", () => {
    it("reads a fenced array", () => {
      expect(parseJsonArray('```json\n[{"id":1}]\n```')).toEqual([{ id: 1 }]);
    });

    it("reads an array wrapped in the prose an Arabic model tends to add", () => {
      expect(parseJsonArray('Sure! Here is the review:\n[{"id":1}]\nHope that helps.')).toEqual([
        { id: 1 },
      ]);
    });

    it("reads Python-style single quotes", () => {
      expect(parseJsonArray("[{'id': 1}]")).toEqual([{ id: 1 }]);
    });

    it("is null when there is no array — a rung that cannot answer has a successor", () => {
      expect(parseJsonArray("I think the second line sounds Egyptian.")).toBeNull();
      expect(isParseableReview("I think the second line sounds Egyptian.")).toBe(false);
    });

    it("accepts an empty array, which is a real answer", () => {
      expect(isParseableReview("[]")).toBe(true);
      expect(parseNativeReview("[]", [{ id: 1, arabic: "شلونك" }])).toEqual([]);
    });
  });

  describe("parseNativeReview", () => {
    const targets: ReviewTarget[] = [
      { id: 1, arabic: "كيف حالك" },
      { id: 2, arabic: "شلونك" },
    ];

    it("keeps the flagged line and drops the one judged fine", () => {
      const raw = JSON.stringify([
        { id: 1, verdict: "msa", suggestion: "شلونك", note: "MSA greeting, not spoken in Gulf" },
        { id: 2, verdict: "ok", suggestion: "", note: "" },
      ]);
      expect(parseNativeReview(raw, targets)).toEqual([
        {
          arabic: "كيف حالك",
          suggestion: "شلونك",
          note: "MSA greeting, not spoken in Gulf",
          kind: "msa",
        },
      ]);
    });

    it("reads Arabic field names, because a model asked in Arabic translates the keys too", () => {
      const raw = JSON.stringify([
        { "رقم": 1, "الحكم": "msa", "الاقتراح": "شلونك", "السبب": "فصحى" },
      ]);
      expect(parseNativeReview(raw, targets)).toEqual([
        { arabic: "كيف حالك", suggestion: "شلونك", note: "فصحى", kind: "msa" },
      ]);
    });

    it("drops a correction that changes nothing", () => {
      // Same words back, differently voweled. Shown, it teaches the learner
      // that the reviewer is noise.
      const raw = JSON.stringify([
        { id: 2, verdict: "dialect", suggestion: "شَلوْنَك", note: "say it this way" },
      ]);
      expect(parseNativeReview(raw, targets)).toEqual([]);
    });

    it("drops a suggestion with no Arabic in it", () => {
      const raw = JSON.stringify([
        { id: 1, verdict: "msa", suggestion: "use the Gulf form", note: "" },
      ]);
      expect(parseNativeReview(raw, targets)).toEqual([]);
    });

    it("drops an unknown verdict and a line nobody asked about", () => {
      const raw = JSON.stringify([
        { id: 1, verdict: "awkward", suggestion: "شلونك", note: "" },
        { id: 9, verdict: "msa", suggestion: "شلونك", note: "" },
      ]);
      expect(parseNativeReview(raw, targets)).toEqual([]);
    });

    it("salvages the findings out of a reply cut off by its token budget", () => {
      const raw = '[{"id": 1, "verdict": "msa", "suggestion": "شلونك", "note": "MSA"}, {"id": 2, "ver';
      expect(parseNativeReview(raw, targets)).toEqual([]);
      // …but the same reply with its first object closed *and* the array
      // reopened is unreadable, which `accept` is what catches.
      expect(isParseableReview(raw)).toBe(false);
    });
  });

  describe("the wire frame", () => {
    const frame: NativeReviewFrame = {
      type: "native_review",
      model: "humain/humain-m3",
      corrections: [{ arabic: "كيف حالك", suggestion: "شلونك", note: "MSA", kind: "msa" }],
    };

    it("round-trips through the SSE encoding", () => {
      const line = encodeAppFrame(frame);
      expect(line.startsWith("data: ")).toBe(true);
      expect(line.endsWith("\n\n")).toBe(true);
      expect(readAppFrame(JSON.parse(line.slice(6)))).toEqual(frame);
    });

    it("is not confused with a provider frame", () => {
      expect(readAppFrame({ choices: [{ delta: { content: "hello" } }] })).toBeNull();
      expect(readAppFrame(null)).toBeNull();
      expect(readAppFrame({ hikaya: { type: "something-else" } })).toBeNull();
    });

    it("drops malformed corrections rather than rendering them", () => {
      expect(
        readAppFrame({
          hikaya: {
            type: "native_review",
            model: "x",
            corrections: [{ arabic: "كيف حالك", suggestion: "", kind: "msa" }],
          },
        }),
      ).toBeNull();
    });
  });
});
