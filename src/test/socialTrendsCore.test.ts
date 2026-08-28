import { describe, expect, it } from "vitest";
import {
  decideScreenOutcome,
  extractRedditPosts,
  hasArabic,
  parseCompactCount,
  parseDayTrendsMarkdown,
  parseTelegramPreviewHtml,
  xSearchUrl,
} from "../../supabase/functions/_shared/socialTrendsCore";

/**
 * The pure half of harvest-social-trends. The parsers run against snippets
 * captured from the real pages on 2026-08-28, because "parses what the site
 * actually serves" is the only property worth having — a parser proven
 * against invented HTML proves nothing about the harvest.
 */

describe("parseDayTrendsMarkdown", () => {
  // Verbatim shape from getdaytrends.com/saudi-arabia/ through Jina Reader.
  const page = [
    "Later trends UTC Time",
    "| 1 | [#يوم_الجمعه](https://getdaytrends.com/saudi-arabia/trend/%23a/) |  | View details |",
    "| --- |",
    "| 2 | [محمد](https://getdaytrends.com/saudi-arabia/trend/b/) |  | View details |",
    "| 3 | [صن داونز](https://getdaytrends.com/saudi-arabia/trend/c/) |  | View details |",
    "##### Longest lasting",
    "| 1 | [#recap_topic](https://getdaytrends.com/saudi-arabia/trend/d/) |  | View details |",
  ].join("\n");

  it("reads the current-trends table and stops at the recap tables", () => {
    // The page repeats ranks 1..N for its "longest lasting"/"most tweeted"
    // recaps; reading past the restart would report yesterday as trending.
    expect(parseDayTrendsMarkdown(page)).toEqual([
      { topic: "#يوم_الجمعه", rank: 1 },
      { topic: "محمد", rank: 2 },
      { topic: "صن داونز", rank: 3 },
    ]);
  });

  it("caps how many topics one page contributes", () => {
    expect(parseDayTrendsMarkdown(page, 2)).toHaveLength(2);
  });

  it("returns nothing for a page with no trend rows", () => {
    // getdaytrends serves country pages that exist but are empty (and Jina
    // serves error prose as content); an empty parse must mean "no rows",
    // never a throw, because one bad country must not end the whole run.
    expect(parseDayTrendsMarkdown("If you have **Telegram**, you can contact")).toEqual([]);
  });
});

describe("parseTelegramPreviewHtml", () => {
  // Shape captured from t.me/s/ pages: text div with inline markup, compact
  // view counts, a data-post permalink id.
  const page = [
    '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kuwaitnews/101">',
    '<div class="tgme_widget_message_text js-message_text" dir="auto">شلونكم يا جماعة؟<br/>خبر <b>مهم</b> اليوم &amp; بس</div>',
    '<span class="tgme_widget_message_views">14.7K</span>',
    '<span class="tgme_widget_message_from_author" dir="auto">Kuwait News</span>',
    '<time datetime="2026-08-28T09:00:00+00:00" class="time">09:00</time></div></div>',
    '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="kuwaitnews/102">',
    "<video>media-only post, no text div</video></div></div>",
  ].join("\n");

  it("extracts text, permalink, views and timestamp per message", () => {
    const posts = parseTelegramPreviewHtml(page);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      externalId: "kuwaitnews/101",
      text: "شلونكم يا جماعة؟\nخبر مهم اليوم & بس",
      url: "https://t.me/kuwaitnews/101",
      author: "Kuwait News",
      postedAt: "2026-08-28T09:00:00+00:00",
      engagement: { views: 14700 },
    });
  });

  it("drops media-only messages rather than storing empty rows", () => {
    // A photo/video post with no caption has nothing to screen and nothing
    // to teach; storing it would spend a model call to reject "".
    expect(parseTelegramPreviewHtml(page).some((p) => p.externalId === "kuwaitnews/102")).toBe(
      false,
    );
  });

  it("returns nothing for a channel without previews", () => {
    // Channels can disable web previews; t.me then serves a contact card.
    // That is a registry-review signal (the harvester logs it), not a crash.
    expect(parseTelegramPreviewHtml("If you have Telegram, you can contact")).toEqual([]);
  });
});

describe("parseCompactCount", () => {
  it("expands the suffixes Telegram actually uses", () => {
    expect(parseCompactCount("14.7K")).toBe(14700);
    expect(parseCompactCount("14.7M")).toBe(14700000);
    expect(parseCompactCount("8,450")).toBe(8450);
    expect(parseCompactCount("287")).toBe(287);
  });

  it("answers null rather than NaN for junk", () => {
    // The count feeds a jsonb engagement blob; NaN would serialize to null
    // deep inside it, but a top-level null keeps the key out entirely.
    expect(parseCompactCount("views")).toBeNull();
    expect(parseCompactCount("")).toBeNull();
    expect(parseCompactCount(null)).toBeNull();
  });
});

describe("extractRedditPosts", () => {
  const listing = {
    data: {
      children: [
        {
          data: {
            name: "t3_arabic",
            title: "وش رايكم بهالمطعم؟",
            selftext: "جربته امس وكان خرافي",
            author: "u1",
            permalink: "/r/Kuwait/comments/x/",
            ups: 42,
            num_comments: 7,
            created_utc: 1756300000,
          },
        },
        { data: { name: "t3_english", title: "Best shawarma in Salmiya?", ups: 90 } },
        { data: { name: "t3_pinned", title: "قوانين المجتمع", stickied: true } },
        { data: { name: "t3_nsfw", title: "كلام كبار", over_18: true } },
      ],
    },
  };

  it("keeps only Arabic-bearing, non-pinned, safe posts", () => {
    // Country subreddits are mostly English; without this filter the screen
    // would spend most of its budget saying "not Arabic". Pinned rule posts
    // and NSFW never belong in a learner feed at all.
    const posts = extractRedditPosts(listing);
    expect(posts.map((p) => p.externalId)).toEqual(["t3_arabic"]);
    expect(posts[0].text).toContain("وش رايكم");
    expect(posts[0].url).toBe("https://www.reddit.com/r/Kuwait/comments/x/");
    expect(posts[0].engagement).toEqual({ ups: 42, comments: 7 });
    expect(posts[0].postedAt).toBe(new Date(1756300000 * 1000).toISOString());
  });

  it("survives a malformed listing", () => {
    expect(extractRedditPosts(null)).toEqual([]);
    expect(extractRedditPosts({ data: {} })).toEqual([]);
    expect(extractRedditPosts("blocked by network security")).toEqual([]);
  });
});

describe("decideScreenOutcome", () => {
  const verdict = {
    is_arabic: true,
    register: "dialect" as const,
    dialect: "Egyptian",
    confidence: 0.9,
    translation: "t",
    reason: "colloquial",
  };

  it("approves dialect and mixed registers, refining the dialect tag", () => {
    // "mixed" passes on purpose: real social writing code-switches, and a
    // dialect-only bar would empty the feed of the register the app teaches.
    expect(decideScreenOutcome(verdict, "Gulf")).toEqual({
      status: "approved",
      dialect: "Egyptian",
      reason: "colloquial",
    });
    expect(decideScreenOutcome({ ...verdict, register: "mixed" }, "Gulf").status).toBe("approved");
  });

  it("rejects MSA, non-Arabic and low-confidence calls", () => {
    expect(decideScreenOutcome({ ...verdict, register: "msa" }, "Gulf").status).toBe("rejected");
    expect(decideScreenOutcome({ ...verdict, is_arabic: false }, "Gulf").status).toBe("rejected");
    expect(decideScreenOutcome({ ...verdict, confidence: 0.3 }, "Gulf").status).toBe("rejected");
  });

  it("leaves a post pending when there is no verdict at all", () => {
    // The one outcome that must never happen is unjudged content going out,
    // so a screen outage parks the post for the next run instead.
    expect(decideScreenOutcome(null, "Gulf")).toEqual({
      status: "pending",
      dialect: "Gulf",
      reason: "screen unavailable",
    });
  });

  it("falls back to the source's dialect when the model invents one", () => {
    expect(decideScreenOutcome({ ...verdict, dialect: "Levantine" }, "Yemeni").dialect).toBe(
      "Yemeni",
    );
  });
});

describe("small helpers", () => {
  it("hasArabic spots Arabic script anywhere in mixed text", () => {
    expect(hasArabic("today وش السالفة")).toBe(true);
    expect(hasArabic("English only")).toBe(false);
  });

  it("xSearchUrl encodes hashtags so the # survives as a query", () => {
    // An unencoded # would become a URL fragment and X would search nothing.
    expect(xSearchUrl("#يوم_الجمعه")).toContain("%23");
    expect(xSearchUrl("#يوم_الجمعه")).not.toContain("q=#");
  });
});
