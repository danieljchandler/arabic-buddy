import { describe, expect, it } from "vitest";
import {
  isXHandle,
  parseNextData,
  parseSyndicationTimeline,
  parseTweetDate,
  parseTweetResult,
  parseXPostUrl,
  summariseTimeline,
  syndicationToken,
  timelineProfileUrl,
  tweetResultUrl,
  tweetUrl,
} from "../../supabase/functions/_shared/xSyndication";

/**
 * The free route to X post bodies.
 *
 * Fixtures mirror what syndication.twitter.com actually served on 2026-09-05,
 * down to the field names (`full_text`, `id_str`, X's own `created_at`
 * format) and the entry envelope (`{type: "tweet", content: {tweet}}`). The
 * Arabic bodies are real tweets from the accounts the seed migration lists —
 * a parser proven against invented JSON proves nothing about the harvest.
 */

const tweet = (over: Record<string, unknown> = {}) => ({
  id_str: "1848076783578415215",
  full_text: "طفل يعيد تمثيل مشهد اللحظات الأخيرة",
  text: "طفل يعيد تمثيل مشهد اللحظات الأخيرة",
  created_at: "Sun Oct 20 19:00:15 +0000 2024",
  lang: "ar",
  favorite_count: 11910,
  retweet_count: 1463,
  reply_count: 77,
  quote_count: 12,
  user: { screen_name: "AlMasryAlYoum", name: "المصري اليوم" },
  ...over,
});

const timelinePage = (tweets: Array<Record<string, unknown>>, extraEntries: unknown[] = []) =>
  `<!DOCTYPE html><html><body><div id="__next"></div>` +
  `<script id="__NEXT_DATA__" type="application/json">` +
  JSON.stringify({
    props: {
      pageProps: {
        timeline: {
          entries: [
            ...tweets.map((t) => ({
              type: "tweet",
              entry_id: `tweet-${t.id_str}`,
              content: { tweet: t },
            })),
            ...extraEntries,
          ],
        },
      },
    },
  }) +
  `</script></body></html>`;

describe("syndicationToken", () => {
  it("reproduces the token X's own embed script computes", () => {
    // Pinned against a live 200 from cdn.syndication.twimg.com for tweet 20
    // (jack's first tweet). It is derived from the id, not a credential —
    // if this drifts, every hydration request starts 404ing.
    expect(syndicationToken("20")).toBe("6dq1a2xwd93");
  });
});

describe("url builders", () => {
  it("points at the per-account timeline and the per-id hydration endpoint", () => {
    expect(timelineProfileUrl("tamerhosny")).toBe(
      "https://syndication.twitter.com/srv/timeline-profile/screen-name/tamerhosny",
    );
    expect(tweetResultUrl("20")).toContain("cdn.syndication.twimg.com/tweet-result?id=20");
    expect(tweetResultUrl("20")).toContain("token=6dq1a2xwd93");
    expect(tweetUrl("tamerhosny", "20")).toBe("https://x.com/tamerhosny/status/20");
  });
});

describe("parseXPostUrl", () => {
  it("accepts x.com and twitter.com status URLs", () => {
    expect(parseXPostUrl("https://x.com/tamerhosny/status/123")).toEqual({
      handle: "tamerhosny",
      id: "123",
    });
    expect(parseXPostUrl("https://www.twitter.com/a_b/status/456/")).toEqual({
      handle: "a_b",
      id: "456",
    });
  });

  it("refuses a URL that merely embeds one", () => {
    // The bug scrape-x-post shipped with: an unanchored regex asks whether an
    // X URL *appears* in the string, which turns any fetcher built on it into
    // an open proxy.
    expect(parseXPostUrl("https://attacker.tld/?u=https://x.com/a/status/1")).toBeNull();
    expect(parseXPostUrl("https://x.com.evil.tld/a/status/1")).toBeNull();
    expect(parseXPostUrl("https://x.com/tamerhosny")).toBeNull();
    expect(parseXPostUrl("not a url")).toBeNull();
  });
});

describe("isXHandle", () => {
  it("holds X's own handle shape", () => {
    expect(isXHandle("tamerhosny")).toBe(true);
    expect(isXHandle("a_b_1")).toBe(true);
    expect(isXHandle("way_too_long_a_handle")).toBe(false);
    expect(isXHandle("has-a-dash")).toBe(false);
    expect(isXHandle("")).toBe(false);
  });
});

describe("parseNextData", () => {
  it("returns null rather than throwing on a page that is not the timeline", () => {
    expect(parseNextData("<html><body>rate limited</body></html>")).toBeNull();
    expect(parseNextData('<script id="__NEXT_DATA__">{not json</script>')).toBeNull();
  });
});

describe("parseSyndicationTimeline", () => {
  it("parses the tweets out of a served timeline page", () => {
    const posts = parseSyndicationTimeline(timelinePage([tweet()]));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      externalId: "1848076783578415215",
      text: "طفل يعيد تمثيل مشهد اللحظات الأخيرة",
      url: "https://x.com/AlMasryAlYoum/status/1848076783578415215",
      author: "AlMasryAlYoum",
      postedAt: "2024-10-20T19:00:15.000Z",
      engagement: { likes: 11910, retweets: 1463, replies: 77, quotes: 12 },
    });
  });

  it("prefers full_text over the truncated text field", () => {
    const posts = parseSyndicationTimeline(
      timelinePage([tweet({ full_text: "النص الكامل هنا", text: "النص المقطوع…" })]),
    );
    expect(posts[0].text).toBe("النص الكامل هنا");
  });

  it("skips retweets — the words belong to another account", () => {
    const posts = parseSyndicationTimeline(
      timelinePage([tweet({ full_text: "RT @someone: كلام حلو اوي" })]),
    );
    expect(posts).toHaveLength(0);
  });

  it("skips non-tweet entries by type, not by shape", () => {
    const posts = parseSyndicationTimeline(
      timelinePage([tweet()], [{ type: "user", content: { user: { screen_name: "x" } } }]),
    );
    expect(posts).toHaveLength(1);
  });

  it("drops duplicate ids and bodyless tweets", () => {
    const posts = parseSyndicationTimeline(
      timelinePage([tweet(), tweet(), tweet({ id_str: "999", full_text: "   ", text: "" })]),
    );
    expect(posts.map((p) => p.externalId)).toEqual(["1848076783578415215"]);
  });

  it("returns nothing for a throttled or empty response", () => {
    // Syndication answers 429 with an HTML body, and the harvester must read
    // that as "no posts" rather than as a parse crash.
    expect(parseSyndicationTimeline("")).toEqual([]);
    expect(parseSyndicationTimeline("<html>Too Many Requests</html>")).toEqual([]);
    expect(parseSyndicationTimeline(timelinePage([]))).toEqual([]);
  });
});

describe("parseTweetResult", () => {
  it("parses the single-tweet hydration response", () => {
    // tweet-result answers in ISO, unlike the timeline's X-format date.
    const post = parseTweetResult({
      ...tweet(),
      created_at: "2024-10-20T19:00:15.000Z",
    });
    expect(post?.externalId).toBe("1848076783578415215");
    expect(post?.postedAt).toBe("2024-10-20T19:00:15.000Z");
    expect(post?.author).toBe("AlMasryAlYoum");
  });

  it("returns null for a deleted or protected tweet", () => {
    expect(parseTweetResult(null)).toBeNull();
    expect(parseTweetResult({ __typename: "TweetTombstone" })).toBeNull();
  });
});

describe("parseTweetDate", () => {
  it("takes both shapes X uses", () => {
    expect(parseTweetDate("Sat Sep 05 04:03:00 +0000 2026")).toBe("2026-09-05T04:03:00.000Z");
    expect(parseTweetDate("2024-10-20T19:00:15.000Z")).toBe("2024-10-20T19:00:15.000Z");
    expect(parseTweetDate("never")).toBeNull();
    expect(parseTweetDate(undefined)).toBeNull();
  });
});

describe("summariseTimeline", () => {
  it("records what a verification probe saw", () => {
    const now = Date.parse("2026-09-08T04:03:00.000Z");
    const summary = summariseTimeline(
      parseSyndicationTimeline(
        timelinePage([
          tweet(),
          tweet({
            id_str: "2",
            full_text: "Not Arabic at all",
            created_at: "Sat Sep 05 04:03:00 +0000 2026",
          }),
        ]),
      ),
      now,
    );
    expect(summary.tweets).toBe(2);
    expect(summary.arabic).toBe(1);
    expect(summary.newestAt).toBe("2026-09-05T04:03:00.000Z");
    expect(summary.oldestAt).toBe("2024-10-20T19:00:15.000Z");
    // Freshness is recorded, never filtered on — syndication serves some
    // accounts an engagement-ranked cached set months old, and for a dialect
    // corpus that is often the better half.
    expect(summary.newestAgeDays).toBe(3);
  });

  it("survives a source that returned nothing", () => {
    expect(summariseTimeline([])).toEqual({
      tweets: 0,
      arabic: 0,
      newestAt: null,
      oldestAt: null,
      newestAgeDays: null,
    });
  });
});
