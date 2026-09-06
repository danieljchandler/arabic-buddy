/**
 * X/Twitter post bodies, for free, without the API.
 *
 * The premise the social harvester shipped with was that post bodies are out
 * of reach: X search needs a login and the API is metered per read (X moved to
 * pay-per-use with no free tier in February 2026). So `x` meant *trending
 * topics only* — a chip that links out — and the actual Arabic text all came
 * from Telegram news channels, which is why the feed reads like a wire and the
 * MSA screen rejects most of it.
 *
 * The premise was wrong in one specific place. X's own embed backend is public
 * and unauthenticated, because embedded tweets on third-party sites have to
 * work for logged-out readers:
 *
 *   syndication.twitter.com/srv/timeline-profile/screen-name/<handle>
 *       the account's timeline, server-rendered, with the tweets as JSON in
 *       the page's __NEXT_DATA__ blob. 20-100 tweets, full text, engagement
 *       counts, language tag.
 *   cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>
 *       one tweet by id, as JSON. The token is derived from the id, not a
 *       credential.
 *
 * What it does NOT give, and no free route does: search. There is no
 * timeline-search, timeline-hashtag or timeline-conversation endpoint — they
 * 404. That shapes the whole pipeline: X content is reachable *per account*,
 * so the scarce resource is knowing which accounts to read, which is a
 * research problem rather than an API problem. See docs/x-content-pipeline.md.
 *
 * Two behaviours to design around, both observed live:
 *
 *   Freshness varies per account. Widely-embedded accounts return a live
 *   timeline (hours old); others return a cached top-tweets set that can be
 *   months or years stale. For a dialect-learning corpus that is a feature
 *   worth naming: a top-tweets set is engagement-ranked, and high-engagement
 *   Arabic is far more idiomatic than the routine posting around it. Nothing
 *   here promises recency, and the harvester does not filter on it.
 *
 *   It rate-limits. Roughly 40 timeline fetches from one IP inside a few
 *   minutes starts returning 429. Callers must pace and back off — see
 *   `SYNDICATION_PACING_MS`.
 *
 * IO-free: every function here parses a payload someone else fetched, so
 * `src/test/xSyndication.test.ts` can exercise it against captured responses.
 */

import type { HarvestedPost } from "./socialTrendsCore.ts";

/**
 * How long to wait between timeline fetches. Measured, not guessed: a burst of
 * ~40 back-to-back fetches earned a 429 that took minutes to clear, and a
 * harvest that trips the limit loses the whole rest of its source list.
 */
export const SYNDICATION_PACING_MS = 1500;

/** X handles: 1-15 of [A-Za-z0-9_]. */
export function isXHandle(handle: string): boolean {
  return /^[A-Za-z0-9_]{1,15}$/.test(handle);
}

/**
 * The `token` the tweet-result endpoint wants.
 *
 * Not a credential and not a secret — it is a pure function of the id that
 * X's own embed script computes client-side, and the endpoint rejects a
 * request without it. Reimplemented rather than stored so it stays correct
 * for ids that don't exist yet.
 */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function timelineProfileUrl(handle: string): string {
  return `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`;
}

export function tweetResultUrl(id: string, lang = "ar"): string {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=${lang}` +
    `&token=${syndicationToken(id)}`;
}

/** The public post URL for a tweet, which is what a learner would open. */
export function tweetUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`;
}

/**
 * `{handle, id}` out of an X status URL, by parsing rather than by substring.
 *
 * Host equality (plus `www.`) and a `/{handle}/status/{id}` path — the same
 * bar `scrape-x-post` applies, because a test that only asks whether an X URL
 * *appears* in a string turns any fetcher built on it into an open proxy.
 */
export function parseXPostUrl(raw: string): { handle: string; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "twitter.com" && host !== "x.com") return null;
  const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/.exec(parsed.pathname);
  return match ? { handle: match[1], id: match[2] } : null;
}

/** The `__NEXT_DATA__` payload out of a server-rendered syndication page. */
export function parseNextData(html: string): unknown | null {
  const match = /id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

interface RawTweet {
  id_str?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  lang?: string;
  favorite_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  in_reply_to_screen_name?: string;
  user?: { screen_name?: string };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * X's `created_at` ("Sat Sep 05 04:03:00 +0000 2026") as an ISO string.
 * The tweet-result endpoint already answers in ISO, so both shapes are taken.
 */
export function parseTweetDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function toHarvested(tweet: RawTweet): HarvestedPost | null {
  const id = tweet.id_str;
  const text = tweet.full_text ?? tweet.text ?? "";
  if (!id || !text.trim()) return null;
  // A retweet teaches the original author's words under the wrong attribution,
  // and the same body will be harvested again from wherever it came from.
  if (/^RT @/.test(text)) return null;
  const handle = tweet.user?.screen_name ?? null;
  const engagement: Record<string, number> = {};
  if (typeof tweet.favorite_count === "number") engagement.likes = tweet.favorite_count;
  if (typeof tweet.retweet_count === "number") engagement.retweets = tweet.retweet_count;
  if (typeof tweet.reply_count === "number") engagement.replies = tweet.reply_count;
  if (typeof tweet.quote_count === "number") engagement.quotes = tweet.quote_count;
  return {
    externalId: id,
    text: text.trim(),
    url: handle ? tweetUrl(handle, id) : "",
    author: handle,
    postedAt: parseTweetDate(tweet.created_at),
    engagement,
  };
}

/**
 * Every tweet in a `timeline-profile` page.
 *
 * Entries come as `{type: "tweet", content: {tweet: {...}}}`; anything else in
 * the timeline (ads, "who to follow" modules) is skipped by type rather than
 * by shape.
 */
export function parseSyndicationTimeline(html: string): HarvestedPost[] {
  const data = record(parseNextData(html));
  const props = record(record(record(data?.props)?.pageProps)?.timeline);
  const entries = props?.entries;
  if (!Array.isArray(entries)) return [];
  const posts: HarvestedPost[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const e = record(entry);
    if (e?.type !== "tweet") continue;
    const tweet = record(record(e.content)?.tweet) as RawTweet | null;
    if (!tweet) continue;
    const post = toHarvested(tweet);
    if (!post || seen.has(post.externalId)) continue;
    seen.add(post.externalId);
    posts.push(post);
  }
  return posts;
}

/** One tweet out of a `tweet-result` response. */
export function parseTweetResult(payload: unknown): HarvestedPost | null {
  const tweet = record(payload) as RawTweet | null;
  if (!tweet) return null;
  return toHarvested(tweet);
}

export interface TimelineSummary {
  tweets: number;
  arabic: number;
  newestAt: string | null;
  oldestAt: string | null;
  /** Whole days between the newest tweet and `now`. */
  newestAgeDays: number | null;
}

/**
 * What a source verification run records about a handle.
 *
 * The discovery loop proposes handles from research; this is the evidence that
 * one of them is actually reachable and actually posts Arabic, stored on the
 * source row so a reviewer can see why it was approved without re-fetching.
 */
export function summariseTimeline(
  posts: HarvestedPost[],
  now: number = Date.now(),
): TimelineSummary {
  const dates = posts
    .map((p) => (p.postedAt ? Date.parse(p.postedAt) : NaN))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => b - a);
  const arabic = posts.filter((p) => /[؀-ۿ]/.test(p.text)).length;
  return {
    tweets: posts.length,
    arabic,
    newestAt: dates.length ? new Date(dates[0]).toISOString() : null,
    oldestAt: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null,
    newestAgeDays: dates.length ? Math.floor((now - dates[0]) / 86_400_000) : null,
  };
}
