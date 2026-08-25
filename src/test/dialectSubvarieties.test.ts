import { describe, expect, it } from "vitest";
import {
  DIALECT_FEATURE_CATEGORIES,
  DIALECT_SUBVARIETIES,
  LEGACY_DIALECT_ALIASES,
  MAX_DIALECT_FEATURES,
  REVIEWABLE_DIALECTS,
  dialectsWithSubvarieties,
  featureCategoryLabel,
  findSubvariety,
  isReviewableDialect,
  isSubvarietyOf,
  resolveSubvariety,
  sanitizeDialectFeature,
  sanitizeDialectFeatures,
  subvarietiesFor,
  subvarietyLabel,
  subvarietyPromptHint,
} from "../../supabase/functions/_shared/dialectSubvarieties";

/**
 * The sub-dialect taxonomy the review workspace offers, and the sanitiser the
 * write path runs everything through.
 *
 * Two kinds of test here and they are guarding different things. The invariants
 * over the tables are guarding a *contract*: the ids are written into
 * `discover_videos.dialect_subvariety` and into every feature row, so a rename
 * orphans data and a duplicate makes a lookup ambiguous. The sanitiser tests
 * are guarding the corpus: this is reviewer-supplied JSON heading for a column
 * that conditions every generator downstream, and "the model was told the clip
 * was Ḥijāzi because a stale dropdown said so" is a failure nobody would trace
 * back here.
 */

describe("the taxonomy is a usable contract", () => {
  const everyEntry = Object.entries(DIALECT_SUBVARIETIES).flatMap(([dialect, list]) =>
    list.map((entry) => ({ dialect, entry })),
  );

  it("only hangs sub-varieties off dialects the write path will accept", () => {
    // A list under a label no save can carry is a list nobody can reach: the
    // notes form posts the dialect on every save, so a label the write path
    // refuses locks the reviewer out of the whole tab.
    const orphans = dialectsWithSubvarieties().filter((dialect) => !isReviewableDialect(dialect));

    expect(orphans, `refused by isReviewableDialect: ${orphans.join(", ")}`).toEqual([]);
  });

  it("gives every legacy alias the same options as the label it stands in for", () => {
    for (const [alias, canonical] of Object.entries(LEGACY_DIALECT_ALIASES)) {
      // Otherwise a video tagged the old way silently offers a different — or
      // empty — sub-variety list from an identical video tagged the new way.
      expect(subvarietiesFor(alias), alias).toEqual(subvarietiesFor(canonical));
      expect(isReviewableDialect(canonical), canonical).toBe(true);
    }
  });

  it("gives every entry an id, both labels and a hint", () => {
    for (const { dialect, entry } of everyEntry) {
      const where = `${dialect}/${entry.id}`;
      expect(entry.id, where).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.label.trim(), where).not.toBe("");
      expect(entry.labelAr.trim(), where).not.toBe("");
      // The hint is what a reviewer reads to choose between two entries they
      // cannot tell apart from the name. An entry without one is a guess.
      expect(entry.hint.trim().length, where).toBeGreaterThan(20);
    }
  });

  it("never repeats an id inside one dialect", () => {
    for (const [dialect, list] of Object.entries(DIALECT_SUBVARIETIES)) {
      const ids = list.map((entry) => entry.id);
      expect([...new Set(ids)], dialect).toEqual(ids);
    }
  });

  it("keeps one meaning per id across dialects", () => {
    // Ids are shared on purpose where the variety genuinely is — Shiḥḥi spans
    // the UAE and Omani lists — but a shared id that meant two different things
    // would make `findSubvariety` return whichever came first.
    const byId = new Map<string, Set<string>>();
    for (const { entry } of everyEntry) {
      const labels = byId.get(entry.id) ?? new Set<string>();
      labels.add(entry.label);
      byId.set(entry.id, labels);
    }

    const conflicting = [...byId].filter(([, labels]) => labels.size > 1);

    expect(conflicting.map(([id]) => id)).toEqual([]);
  });

  it("keeps every dropdown short enough to read", () => {
    // The whole reason for two levels rather than one flat list. A dropdown a
    // reviewer has to scroll is one they leave on its default.
    for (const [dialect, list] of Object.entries(DIALECT_SUBVARIETIES)) {
      expect(list.length, dialect).toBeLessThanOrEqual(8);
      expect(list.length, dialect).toBeGreaterThan(1);
    }
  });

  it("covers the three modules the app actually teaches", () => {
    // Gulf, Egyptian and Yemeni are the whole product. A missing list here is a
    // reviewer with nothing to say about most of the library.
    for (const dialect of ["Gulf", "Saudi", "Kuwaiti", "UAE", "Egyptian", "Yemeni"]) {
      expect(subvarietiesFor(dialect).length, dialect).toBeGreaterThan(0);
    }
  });

  it("offers nothing for a dialect it has no taxonomy for", () => {
    // The signal the UI uses to hide the second dropdown rather than show an
    // empty one.
    expect(subvarietiesFor("MSA")).toEqual([]);
    expect(subvarietiesFor("Levantine")).toEqual([]);
    expect(subvarietiesFor(null)).toEqual([]);
    expect(subvarietiesFor(42)).toEqual([]);
  });

  it("gives every feature category a distinct id and a hint", () => {
    const ids = DIALECT_FEATURE_CATEGORIES.map((category) => category.id);

    expect([...new Set(ids)]).toEqual(ids);
    for (const category of DIALECT_FEATURE_CATEGORIES) {
      expect(category.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(category.hint.trim().length, category.id).toBeGreaterThan(20);
    }
  });
});

describe("looking a sub-variety up", () => {
  it("knows what belongs where", () => {
    expect(isSubvarietyOf("Saudi", "hijazi")).toBe(true);
    expect(isSubvarietyOf("Egyptian", "hijazi")).toBe(false);
    expect(isSubvarietyOf("Saudi", "")).toBe(false);
    expect(isSubvarietyOf("Saudi", null)).toBe(false);
  });

  it("finds one wherever it lives", () => {
    // Needed because a stored id outlives the dialect label it was set under:
    // the screen still has to render "Ḥijāzi" while telling the reviewer it no
    // longer applies to a video they have just re-tagged Egyptian.
    expect(findSubvariety("saidi")?.label).toContain("Ṣaʿīdi");
    expect(findSubvariety("nope")).toBeUndefined();
  });

  it("falls back to the raw id rather than rendering blank", () => {
    expect(subvarietyLabel("tihami")).toContain("Tihāmi");
    expect(subvarietyLabel("something-a-migration-left")).toBe("something-a-migration-left");
    expect(subvarietyLabel(null)).toBe("");
    expect(featureCategoryLabel("negation")).toBe("Negation");
    expect(featureCategoryLabel("unheard-of")).toBe("unheard-of");
  });
});

describe("resolving what to store", () => {
  it("keeps a sub-variety that belongs under the dialect", () => {
    expect(resolveSubvariety("Yemeni", "tihami")).toBe("tihami");
  });

  it("clears rather than refuses when the country moved", () => {
    // The case that produces a mismatch is a reviewer correcting the country on
    // a mis-tagged video. Refusing the save would leave them with the wrong
    // country *and* the wrong variety under it.
    expect(resolveSubvariety("Egyptian", "hijazi")).toBeNull();
  });

  it("treats every empty shape as cleared", () => {
    expect(resolveSubvariety("Saudi", null)).toBeNull();
    expect(resolveSubvariety("Saudi", undefined)).toBeNull();
    expect(resolveSubvariety("Saudi", "")).toBeNull();
  });
});

describe("cleaning a reviewer's dialect features", () => {
  it("keeps a complete one", () => {
    const feature = sanitizeDialectFeature(
      {
        category: "question-words",
        subvariety: "hijazi",
        title: "إيش rather than وش",
        arabic: "إيش تبغى؟",
        lineId: "L3",
        explanation: "Hijazi asks with إيش.",
        contrast: "Riyadh would say وش تبي.",
      },
      "Saudi",
    );

    expect(feature).toEqual({
      category: "question-words",
      subvariety: "hijazi",
      title: "إيش rather than وش",
      arabic: "إيش تبغى؟",
      lineId: "L3",
      explanation: "Hijazi asks with إيش.",
      contrast: "Riyadh would say وش تبي.",
    });
  });

  it("refuses a category it does not recognise", () => {
    // Otherwise the corpus grows a key space nothing can group by, which is the
    // exact failure grammarTaxonomy.ts exists to have already fixed once.
    expect(sanitizeDialectFeature({ category: "vibes", title: "x" }, "Saudi")).toBeNull();
    expect(sanitizeDialectFeature({ title: "no category" }, "Saudi")).toBeNull();
  });

  it("refuses one that says nothing", () => {
    // A category and nothing else is a dropdown left on its default, not an
    // observation.
    expect(sanitizeDialectFeature({ category: "phonology" }, "Saudi")).toBeNull();
    expect(
      sanitizeDialectFeature({ category: "phonology", title: "   " }, "Saudi"),
    ).toBeNull();
  });

  it("keeps a feature tagged with another country's variety", () => {
    // A Cairene speaker quoting a Ṣaʿīdi phrase is a real thing to record, not
    // a mistake to flatten.
    const feature = sanitizeDialectFeature(
      { category: "lexicon", subvariety: "saidi", title: "a quoted Ṣaʿīdi word" },
      "Egyptian",
    );

    expect(feature?.subvariety).toBe("saidi");
  });

  it("drops a sub-variety it has never heard of", () => {
    const feature = sanitizeDialectFeature(
      { category: "lexicon", subvariety: "atlantean", title: "kept" },
      "Egyptian",
    );

    expect(feature).toEqual({ category: "lexicon", title: "kept" });
  });

  it("trims, and bounds a runaway field", () => {
    const feature = sanitizeDialectFeature(
      { category: "prosody", title: "  spaced  ", explanation: "x".repeat(5000) },
      "Saudi",
    );

    expect(feature?.title).toBe("spaced");
    expect(feature?.explanation).toHaveLength(2000);
  });

  it("ignores anything that is not an object", () => {
    for (const junk of [null, "a string", 7, ["a", "list"]]) {
      expect(sanitizeDialectFeature(junk, "Saudi")).toBeNull();
    }
  });

  it("drops the unusable entries out of a list rather than the whole list", () => {
    const features = sanitizeDialectFeatures(
      [
        { category: "negation", title: "مب" },
        { category: "not-a-category", title: "dropped" },
        "not an object",
        { category: "lexicon", contrast: "kept — a contrast is enough on its own" },
      ],
      "Kuwaiti",
    );

    expect(features).toHaveLength(2);
    expect(features[0].title).toBe("مب");
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_DIALECT_FEATURES + 20 }, () => ({
      category: "lexicon",
      title: "a word",
    }));

    expect(sanitizeDialectFeatures(many, "Saudi")).toHaveLength(MAX_DIALECT_FEATURES);
  });

  it("returns an empty list for anything that is not one", () => {
    expect(sanitizeDialectFeatures(null, "Saudi")).toEqual([]);
    expect(sanitizeDialectFeatures({ category: "lexicon" }, "Saudi")).toEqual([]);
  });
});

describe("the prompt hint", () => {
  it("describes a variety that belongs to the dialect", () => {
    const hint = subvarietyPromptHint("Yemeni", "tihami");

    expect(hint).toContain("Tihāmi");
    expect(hint).toContain("تهامي");
    // The hint text carries the actual distinguishing feature, which is the
    // part worth putting in front of a model.
    expect(hint).toContain("am-");
  });

  it("says nothing when there is nothing reliable to say", () => {
    // A mismatched pair means the row is mid-correction; asserting the old
    // variety at a model would be worse than asserting nothing.
    expect(subvarietyPromptHint("Egyptian", "tihami")).toBe("");
    expect(subvarietyPromptHint("Egyptian", null)).toBe("");
  });
});

describe("the dialect labels a reviewer may set", () => {
  it("admits the ones the video form has always offered", () => {
    for (const dialect of ["Saudi", "Gulf", "Egyptian", "Yemeni", "MSA"]) {
      expect(isReviewableDialect(dialect), dialect).toBe(true);
    }
  });

  it("still accepts a label already sitting on rows", () => {
    // "Emirati" is not in the picker, but videos carry it. A reviewer opening
    // one of those must be able to save.
    expect(isReviewableDialect("Emirati")).toBe(true);
  });

  it("refuses anything else", () => {
    // The label reaches every generator downstream, so a typo that sailed
    // through would quietly take a video out of every dialect filter it belongs
    // to.
    expect(isReviewableDialect("Saudia")).toBe(false);
    expect(isReviewableDialect("")).toBe(false);
    expect(isReviewableDialect(null)).toBe(false);
  });

  it("has no duplicates", () => {
    expect([...new Set(REVIEWABLE_DIALECTS)]).toHaveLength(REVIEWABLE_DIALECTS.length);
  });
});
