import { describe, expect, it } from "vitest";
import {
  arabicWordCount,
  colloquialScore,
  prescreen,
  registerProfile,
  stripNoise,
} from "../../supabase/functions/_shared/socialPrescreen";

/**
 * The free half of the social screen.
 *
 * The module deliberately does not reimplement dialect identification —
 * `dialectMarkers.ts` owns that, with audited lists — so what is pinned here
 * is the axis it adds: **register**. Not which dialect, but whether anyone is
 * speaking. That is what separates a tweet from a headline, and it is the
 * signal the dialect scorer has no reason to carry.
 *
 * Every Arabic string here is real: captured from a live syndication harvest
 * on 2026-09-05, or the register a newsroom actually writes. A marker list
 * proven against invented sentences proves nothing — the point is that it
 * separates a singer writing to their followers from a newspaper writing a
 * headline, and only real text shows that.
 */

describe("stripNoise", () => {
  it("removes links, mentions and hashtags but keeps the sentence", () => {
    const raw = "مش عارف اعمل ايه دلوقتي @someone #مصر https://t.co/abc123";
    expect(stripNoise(raw)).toBe("مش عارف اعمل ايه دلوقتي");
  });

  it("strips the bidi control marks X sprinkles through RTL text", () => {
    expect(stripNoise("‏مش‎ كده​")).toBe("مش كده");
  });

  it("does not let a hashtag smuggle in a marker", () => {
    // `#مصر_دلوقتي` is a tag, not someone saying `دلوقتي`.
    expect(registerProfile("#مصر_دلوقتي news").dialectal).toBe(false);
  });
});

describe("arabicWordCount", () => {
  it("counts Arabic words only, after the noise is gone", () => {
    expect(arabicWordCount("شلونكم يا جماعة؟ https://t.co/x")).toBe(3);
    expect(arabicWordCount("Breaking: Egypt wins")).toBe(0);
  });
});

describe("registerProfile", () => {
  it("hears a person speaking", () => {
    const profile = registerProfile("انا مش عارف اعمل ايه دلوقتي بجد");
    expect(profile.personal).toBeGreaterThan(0);
    expect(profile.newsroom).toBe(0);
    expect(profile.dialectal).toBe(true);
    expect(profile.markers.best).toBe("Egyptian");
  });

  it("matches a register marker with an attached pronoun", () => {
    // Whole-word matching alone misses this: people type `شفتها`, not `شفت`.
    expect(registerProfile("شفتها امبارح في الشغل").personal).toBeGreaterThan(0);
    expect(registerProfile("عندكم خبر حلو ولا ايه").personal).toBeGreaterThan(0);
  });

  it("matches a register marker with an attached conjunction", () => {
    expect(registerProfile("تعالى وشفت الحاجة دي بنفسي").personal).toBeGreaterThan(0);
  });

  it("hears a newsroom in a wire sentence, and nobody speaking", () => {
    const wire = "أكد المتحدث الرسمي أن اللجنة التي شكلها المجلس بحثت الأمر وفقا للبيان";
    const profile = registerProfile(wire);
    expect(profile.newsroom).toBeGreaterThanOrEqual(2);
    expect(profile.personal).toBe(0);
    expect(profile.dialectal).toBe(false);
  });

  it("defers to dialectMarkers on which dialect it is", () => {
    // The point of composing rather than duplicating: one marker vocabulary,
    // already audited, and its shared-marker weighting comes along for free.
    expect(registerProfile("ذحين ما شفت شي").markers.dialectScores.Yemeni).toBeGreaterThan(0);
    expect(registerProfile("دلوقتي كده").markers.dialectScores.Egyptian).toBeGreaterThan(0);
  });

  it("does not see dialect where that scorer sees none, and says so", () => {
    // `عادك` is `عاد` with an attached pronoun, and dialectMarkers matches
    // whole words — so this reads as no dialect evidence. Benign: the text
    // still passes on the register axis rather than being binned.
    const profile = registerProfile("عادك ما شفت شي");
    expect(profile.dialectal).toBe(false);
    expect(prescreen("عادك ما شفت شي").worthScreening).toBe(true);
  });
});

describe("prescreen", () => {
  it("passes real dialect text through to the model", () => {
    const result = prescreen("زوجتي حبيبتي ربنا يخليكي ليا ويخلي لينا اولادنا");
    expect(result.worthScreening).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("passes short colloquial text — three words is a lesson", () => {
    expect(prescreen("شلونكم يا جماعة؟").worthScreening).toBe(true);
  });

  it("refuses wire copy without spending a model call", () => {
    const wire = "أعلن المتحدث الرسمي أن اللجنة التي شكلها المجلس بحثت الأمر وفقا للبيان";
    const result = prescreen(wire);
    expect(result.worthScreening).toBe(false);
    expect(result.reason).toBe("news_register");
  });

  it("refuses a headline: long, third person, nobody speaking", () => {
    // The rule the marker lists alone could not carry. Measured on a
    // newspaper account, MSA and newsroom markers together caught a handful
    // of 97 tweets; length plus the absence of anyone speaking is what
    // identifies wire copy.
    const headline = "الأهلي يفوز على الزمالك بهدفين نظيفين في قمة الدوري المصري";
    const result = prescreen(headline);
    expect(result.worthScreening).toBe(false);
    expect(result.reason).toBe("headline");
    expect(result.profile.personal).toBe(0);
  });

  it("screens a headline the moment someone is speaking in it", () => {
    const quoted = "الأهلي يفوز على الزمالك وانا شفت المباراة من اولها لاخرها";
    expect(prescreen(quoted).worthScreening).toBe(true);
  });

  it("screens a headline the moment it quotes someone in dialect", () => {
    // The best thing a news account produces; it must survive the wire copy
    // wrapped around it.
    const quoted = 'يحتضن معجبة بكت لحظة رؤيته: "هو أنا لسه كلمتك"';
    expect(prescreen(quoted).worthScreening).toBe(true);
  });

  it("refuses text with no Arabic at all", () => {
    expect(prescreen("Best shawarma in Salmiya?").reason).toBe("no_arabic");
  });

  it("refuses a bare hashtag or a one-word reply", () => {
    // The hashtag is Arabic script, so it is not `no_arabic` — it is text
    // with nothing left once the tag comes off, which is `too_short`.
    expect(prescreen("#مصر https://t.co/abc").reason).toBe("too_short");
    expect(prescreen("تمام").reason).toBe("too_short");
  });

  it("honours a caller's own thresholds", () => {
    expect(prescreen("شلونكم يا جماعة", { minArabicWords: 10 }).reason).toBe("too_short");
    const headline = "الأهلي يفوز على الزمالك بهدفين نظيفين في قمة الدوري المصري";
    expect(prescreen(headline, { headlineWordFloor: 99 }).worthScreening).toBe(true);
  });
});

describe("colloquialScore", () => {
  it("ranks dialect above wire copy", () => {
    const dialect = "انا مش عارف اعمل ايه دلوقتي بجد";
    const wire = "أكد الوزير أن الأمر الذي حدث جاء وفقا للبيان";
    expect(colloquialScore(dialect, "Egyptian")).toBeGreaterThan(colloquialScore(wire, "Egyptian"));
  });

  it("weights the source's own dialect over a neighbour's", () => {
    const egyptian = "مش عارف اعمل ايه دلوقتي";
    expect(colloquialScore(egyptian, "Egyptian")).toBeGreaterThan(
      colloquialScore(egyptian, "Gulf"),
    );
  });

  it("survives a dialect name it does not know", () => {
    expect(colloquialScore("دلوقتي كده", "Levantine")).toBeGreaterThan(0);
  });
});
