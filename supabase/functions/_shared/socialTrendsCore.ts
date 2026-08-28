/**
 * Pure parsing/decision logic for the social trends harvester.
 *
 * Everything here is deliberately IO-free (no Deno.env, no fetch) so the unit
 * suite can exercise it from src/test/socialTrendsCore.test.ts against real
 * captured payloads. The fetching, auth and DB writes live in
 * harvest-social-trends/index.ts.
 *
 * Three source shapes, three parsers:
 *   - getdaytrends country pages arrive as Jina Reader markdown; trend rows
 *     render as `| 3 | [#topic](https://getdaytrends.com/<c>/trend/...) | ...`
 *   - t.me/s/<channel> preview pages are plain HTML with one
 *     tgme_widget_message_wrap block per message
 *   - Reddit listings are the ordinary /top.json shape
 */

export interface TrendTopic {
  topic: string;
  rank: number;
}

export interface HarvestedPost {
  externalId: string;
  text: string;
  url: string;
  author: string | null;
  postedAt: string | null;
  engagement: Record<string, number>;
}

/** The tool-call verdict the screening model must emit for each post. */
export interface ScreenVerdict {
  is_arabic: boolean;
  register: "dialect" | "mixed" | "msa" | "other";
  dialect: string;
  confidence: number;
  translation: string;
  reason: string;
}

const ARABIC_CHAR = /[؀-ۿ]/;

export function hasArabic(text: string): boolean {
  return ARABIC_CHAR.test(text);
}

/**
 * Trend rows out of a getdaytrends page rendered to markdown. The page holds
 * several tables (current trends, then "longest lasting" / "most tweeted"
 * recaps) whose ranks each restart at 1 — the current table is the first, so
 * parsing stops the moment ranks stop increasing.
 */
export function parseDayTrendsMarkdown(markdown: string, limit = 20): TrendTopic[] {
  const rowPattern = /^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\([^)]*\/trend\/[^)]*\)/;
  const topics: TrendTopic[] = [];
  const seen = new Set<string>();
  let lastRank = 0;
  for (const line of markdown.split("\n")) {
    const m = rowPattern.exec(line.trim());
    if (!m) continue;
    const rank = Number(m[1]);
    if (rank <= lastRank) break;
    lastRank = rank;
    const topic = m[2].trim();
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    topics.push({ topic, rank });
    if (topics.length >= limit) break;
  }
  return topics;
}

/** Where a learner can watch a trend live: X's own search, newest first. */
export function xSearchUrl(topic: string): string {
  return `https://x.com/search?q=${encodeURIComponent(topic)}&f=live`;
}

/** "14.7M" / "8,450" / "287" → a number; null for anything unparsable. */
export function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^([\d.,]+)\s*([KMB])?$/i.exec(raw.trim());
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(base * scale);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Messages out of a t.me/s/<channel> preview page. Only channels that enable
 * previews render these blocks at all — a page without them is the harvester's
 * signal that the source needs review, not an error.
 */
export function parseTelegramPreviewHtml(html: string): HarvestedPost[] {
  const posts: HarvestedPost[] = [];
  const chunks = html.split('tgme_widget_message_wrap').slice(1);
  for (const chunk of chunks) {
    const postId = /data-post="([^"]+)"/.exec(chunk)?.[1];
    if (!postId) continue;
    const textHtml = /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1];
    const text = textHtml ? stripTags(textHtml) : "";
    if (!text) continue;
    const views = parseCompactCount(
      /tgme_widget_message_views">([^<]+)</.exec(chunk)?.[1] ?? null,
    );
    const author = /tgme_widget_message_from_author[^>]*>([^<]+)</.exec(chunk)?.[1] ?? null;
    const postedAt = /datetime="([^"]+)"/.exec(chunk)?.[1] ?? null;
    posts.push({
      externalId: postId,
      text,
      url: `https://t.me/${postId}`,
      author: author ? decodeEntities(author).trim() : null,
      postedAt,
      engagement: views === null ? {} : { views },
    });
  }
  return posts;
}

interface RedditChild {
  data?: {
    name?: string;
    title?: string;
    selftext?: string;
    author?: string;
    permalink?: string;
    ups?: number;
    num_comments?: number;
    created_utc?: number;
    over_18?: boolean;
    stickied?: boolean;
  };
}

/**
 * Arabic-bearing posts out of a Reddit /top listing. Country subreddits are
 * mostly English threads, so the Arabic-script filter is what makes them a
 * dialect source at all; NSFW and pinned mod posts never pass.
 */
export function extractRedditPosts(listing: unknown, minLength = 12): HarvestedPost[] {
  const children =
    ((listing as { data?: { children?: RedditChild[] } })?.data?.children ?? []) as RedditChild[];
  const posts: HarvestedPost[] = [];
  for (const child of children) {
    const d = child?.data;
    if (!d?.name || d.over_18 || d.stickied) continue;
    const text = [d.title ?? "", d.selftext ?? ""].join("\n\n").trim();
    if (text.length < minLength || !hasArabic(text)) continue;
    posts.push({
      externalId: d.name,
      text,
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : "",
      author: d.author ?? null,
      postedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
      engagement: { ups: d.ups ?? 0, comments: d.num_comments ?? 0 },
    });
  }
  return posts;
}

const KNOWN_DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);

/**
 * Turn a screening verdict into a row status. The screen is triage, not the
 * publisher: a pass means "screened" — a human on /admin/social-trends makes
 * the approve/reject call — so the bar can afford to be generous. "mixed" and
 * low-confidence dialect calls go to the review queue (real social writing
 * code-switches constantly, and a strict bar was starving Gulf, whose sources
 * lean news-register). Only the clear-cut negatives — MSA, not Arabic — are
 * binned without a human look, and a model outage leaves the post pending so
 * the next run retries it.
 */
export function decideScreenOutcome(
  verdict: ScreenVerdict | null,
  sourceDialect: string,
): { status: "screened" | "rejected" | "pending"; dialect: string; reason: string } {
  const dialect =
    verdict && KNOWN_DIALECTS.has(verdict.dialect) ? verdict.dialect : sourceDialect;
  if (!verdict) return { status: "pending", dialect, reason: "screen unavailable" };
  if (!verdict.is_arabic) return { status: "rejected", dialect, reason: "not Arabic" };
  if (verdict.register === "msa" || verdict.register === "other") {
    return { status: "rejected", dialect, reason: verdict.reason || `register: ${verdict.register}` };
  }
  return { status: "screened", dialect, reason: verdict.reason || "dialect content" };
}

/**
 * The oldest message id on a t.me/s page, for pagination: requesting
 * `t.me/s/<handle>?before=<id>` serves the previous ~20 messages. Null when
 * the page had no parseable ids (nothing further to page to).
 */
export function lowestTelegramPostId(posts: HarvestedPost[]): number | null {
  let lowest: number | null = null;
  for (const post of posts) {
    const id = Number(post.externalId.split("/").pop());
    if (!Number.isFinite(id)) continue;
    if (lowest === null || id < lowest) lowest = id;
  }
  return lowest;
}
