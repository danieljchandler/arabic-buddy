// Social trends harvester: trending topics + screened social posts.
//
// Pulls "what the Arab world is posting right now" from the three free
// sources the registry (social_content_sources) knows about:
//
//   x         per-country trending topics scraped from getdaytrends.com via
//             Jina Reader (the scrape-x-post fetch path). Topics only — X
//             search is behind login, so there is no free route to post
//             bodies, and the paid API starts at $0.005/read.
//   reddit    top-of-day posts from country subreddits. Reddit blocks
//             anonymous datacenter fetches, so this uses a free registered
//             app (REDDIT_CLIENT_ID/SECRET, client_credentials grant) and
//             quietly skips the platform when the secrets are unset.
//   telegram  public channel previews at t.me/s/<handle> — no key at all.
//             Fetched direct, with Jina as fallback for blocked egress.
//
// Every harvested post lands as status='pending' and goes through an askBrain
// screen (UTILITY lineup, solo, forced tool call). The screen is TRIAGE, not
// the publisher: a pass moves the post to status='screened', where a content
// manager on /admin/social-trends makes the actual approve/reject call — only
// clear MSA and non-Arabic are binned without a human look. The same call
// produces the English translation, so screening adds no second model pass,
// and a screen outage leaves posts pending for the next run.
//
// Screening runs per dialect with a target: each run keeps fetching (older
// Telegram pages included) and screening a dialect's pending queue until that
// dialect has `targetPerDialect` posts awaiting or past review, its queue is
// empty, or the run's global call/time budget is spent. Neediest dialect
// first, so Gulf's news-heavy sources can't be starved by Egyptian filling a
// global quota — the failure mode the first cut shipped with.
//
// Gated to content managers, plus the SOCIAL_HARVEST_SECRET header for the
// scheduled automation loop. Parsing/decision logic is pure and lives in
// _shared/socialTrendsCore.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getLineup } from "../_shared/modelRegistry.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";
import {
  decideScreenOutcome,
  extractRedditPosts,
  hasArabic,
  type HarvestedPost,
  lowestTelegramPostId,
  parseDayTrendsMarkdown,
  parseTelegramPreviewHtml,
  type ScreenVerdict,
  xSearchUrl,
} from "../_shared/socialTrendsCore.ts";

const FEATURE = "harvest-social-trends";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isContentManager(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const { data: userData, error } = await admin().auth.getUser(token);
  if (error || !userData?.user?.id) return false;
  const { data: roles } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .in("role", ["admin", "content_reviewer"]);
  return Array.isArray(roles) && roles.length > 0;
}

async function hasHarvestSecret(req: Request): Promise<boolean> {
  return await hasSharedSecret(req, "x-harvest-secret", "SOCIAL_HARVEST_SECRET");
}

/** Fetch a page through Jina Reader; empty string on any failure. */
async function fetchViaJina(url: string, format: "markdown" | "html"): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Return-Format": format,
  };
  const key = Deno.env.get("JINA_API_KEY");
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (!res.ok) return "";
    const data = await res.json();
    return String(data?.data?.content ?? "");
  } catch {
    return "";
  }
}

interface SourceRow {
  id: string;
  platform: string;
  handle: string;
  display_name: string;
  dialect: string;
  country: string | null;
}

async function approvedSources(platform: string): Promise<SourceRow[]> {
  const { data, error } = await admin()
    .from("social_content_sources")
    .select("id, platform, handle, display_name, dialect, country")
    .eq("status", "approved")
    .eq("platform", platform);
  if (error) throw new Error(`social_content_sources fetch failed: ${error.message}`);
  return (data ?? []) as unknown as SourceRow[];
}

async function touchSources(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await admin()
    .from("social_content_sources")
    .update({ last_harvested_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
    .in("id", ids);
}

// ---------- x: trending topics ----------

async function harvestTrends(): Promise<number> {
  const sources = await approvedSources("x");
  let stored = 0;
  for (const source of sources) {
    const started = Date.now();
    const markdown = await fetchViaJina(`https://getdaytrends.com/${source.handle}/`, "markdown");
    const topics = parseDayTrendsMarkdown(markdown);
    emitMetric({
      feature: FEATURE,
      event: "trends_fetch",
      dialect: source.dialect,
      status: topics.length > 0 ? "ok" : "warn",
      durationMs: Date.now() - started,
      count: topics.length,
      meta: { handle: source.handle },
    });
    if (topics.length === 0) continue;
    const rows = topics.map((t) => ({
      platform: "x",
      country: source.country ?? source.display_name,
      dialect: source.dialect,
      topic: t.topic,
      rank: t.rank,
      source_url: xSearchUrl(t.topic),
      captured_at: new Date().toISOString(),
    }));
    const { error } = await admin()
      .from("trending_topics")
      .upsert(rows as never, { onConflict: "country,topic,captured_on" });
    if (error) throw new Error(`trending_topics upsert failed: ${error.message}`);
    stored += rows.length;
  }
  await touchSources(sources.map((s) => s.id));
  return stored;
}

// ---------- telegram + reddit: posts ----------

async function fetchTelegramHtml(handle: string, before: number | null = null): Promise<string> {
  const url = `https://t.me/s/${handle}${before === null ? "" : `?before=${before}`}`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const html = await res.text();
      if (html.includes("tgme_widget_message")) return html;
    }
  } catch {
    /* fall through to Jina */
  }
  return await fetchViaJina(url, "html");
}

/**
 * Walk a channel's preview backwards (t.me's ?before= pagination) until
 * `wanted` Arabic posts are in hand or `maxPages` pages have been read. One
 * page is ~20 messages; a news channel where most captions are links or media
 * needs the extra pages to yield anything screenable.
 */
async function collectTelegramPosts(
  handle: string,
  wanted: number,
  maxPages: number,
): Promise<HarvestedPost[]> {
  const collected: HarvestedPost[] = [];
  let before: number | null = null;
  for (let page = 0; page < maxPages && collected.length < wanted; page++) {
    const parsed = parseTelegramPreviewHtml(await fetchTelegramHtml(handle, before));
    if (parsed.length === 0) break;
    // Same bar Reddit posts clear in the parser: an all-emoji or all-media
    // caption never costs a screening call.
    collected.push(...parsed.filter((p) => hasArabic(p.text)));
    // The pagination cursor comes from everything parsed, not just the Arabic
    // survivors — the next page starts before the oldest message seen.
    const oldest = lowestTelegramPostId(parsed);
    if (oldest === null || oldest <= 1) break;
    before = oldest;
  }
  return collected;
}

let redditToken: { token: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string | null> {
  const id = Deno.env.get("REDDIT_CLIENT_ID");
  const secret = Deno.env.get("REDDIT_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (redditToken && redditToken.expiresAt > Date.now() + 60_000) return redditToken.token;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "hakiya/1.0 (Arabic dialect learning; content discovery)",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.access_token) return null;
  redditToken = {
    token: String(data.access_token),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
  return redditToken.token;
}

async function fetchRedditListing(handle: string): Promise<unknown | null> {
  const token = await getRedditToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://oauth.reddit.com/r/${handle}/top?t=day&limit=25&raw_json=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "hakiya/1.0 (Arabic dialect learning; content discovery)",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function storePosts(
  source: SourceRow,
  posts: HarvestedPost[],
  perSource: number,
): Promise<number> {
  const rows = posts.slice(0, perSource).map((p) => ({
    source_id: source.id,
    platform: source.platform,
    external_id: p.externalId,
    url: p.url || null,
    author: p.author,
    dialect: source.dialect,
    country: source.country,
    arabic_text: p.text,
    engagement: p.engagement,
    posted_at: p.postedAt,
  }));
  if (rows.length === 0) return 0;
  // ignoreDuplicates: a re-run must not stomp rows the screen already judged.
  const { error } = await admin()
    .from("social_posts")
    .upsert(rows as never, { onConflict: "platform,external_id", ignoreDuplicates: true });
  if (error) throw new Error(`social_posts upsert failed: ${error.message}`);
  return rows.length;
}

async function harvestPosts(platform: "telegram" | "reddit", perSource: number): Promise<number> {
  const sources = await approvedSources(platform);
  if (platform === "reddit" && !(await getRedditToken())) {
    // No registered app configured — a setup state, not a failure.
    emitMetric({ feature: FEATURE, event: "reddit_skipped_no_credentials", status: "warn" });
    return 0;
  }
  let stored = 0;
  for (const source of sources) {
    const started = Date.now();
    let posts: HarvestedPost[] = [];
    if (platform === "telegram") {
      posts = await collectTelegramPosts(source.handle, perSource, 3);
    } else {
      const listing = await fetchRedditListing(source.handle);
      posts = listing ? extractRedditPosts(listing) : [];
    }
    emitMetric({
      feature: FEATURE,
      event: `${platform}_fetch`,
      dialect: source.dialect,
      status: posts.length > 0 ? "ok" : "warn",
      durationMs: Date.now() - started,
      count: posts.length,
      meta: { handle: source.handle },
    });
    stored += await storePosts(source, posts, perSource);
  }
  await touchSources(sources.map((s) => s.id));
  return stored;
}

// ---------- screening ----------

async function screenPost(
  text: string,
  sourceDialect: string,
): Promise<{ verdict: ScreenVerdict | null; error?: string }> {
  try {
    const brain = await askBrain<ScreenVerdict>({
      purpose: "social_post_screen",
      dialect: sourceDialect,
      strategy: "solo",
      models: [...getLineup("UTILITY").drafters],
      skipRepair: true,
      maxTokens: 700,
      temperature: 0,
      userPrompt:
        `You are screening a social media post for a learner feed in an app that teaches ` +
        `SPOKEN dialectal Arabic (Gulf/Khaliji, Egyptian, Yemeni) and never MSA/فصحى.\n` +
        `The post came from a ${sourceDialect}-region source.\n\n` +
        `Post:\n«${text.slice(0, 1500)}»\n\n` +
        `Judge it:\n` +
        `- is_arabic: does it contain real Arabic sentences (not just a hashtag or name)?\n` +
        `- register: "dialect" if written the way people speak; "mixed" if colloquial with ` +
        `some formal phrasing; "msa" for news/formal fusha; "other" for anything else.\n` +
        `- dialect: your best guess of Gulf, Egyptian or Yemeni.\n` +
        `- confidence: 0-1, how sure you are the register call is right.\n` +
        `- translation: a natural English translation of the Arabic.\n` +
        `- reason: one sentence a reviewer can audit.`,
      tool: {
        name: "emit_social_screen",
        description: "Verdict on one social post.",
        parameters: {
          type: "object",
          properties: {
            is_arabic: { type: "boolean" },
            register: { type: "string", enum: ["dialect", "mixed", "msa", "other"] },
            dialect: { type: "string", enum: ["Gulf", "Egyptian", "Yemeni"] },
            confidence: { type: "number" },
            translation: { type: "string" },
            reason: { type: "string", description: "One sentence." },
          },
          required: ["is_arabic", "register", "dialect", "confidence", "translation", "reason"],
        },
      },
    });
    const v = brain.output;
    if (!v || typeof v.is_arabic !== "boolean") {
      return { verdict: null, error: "screen returned no verdict" };
    }
    return { verdict: v };
  } catch (e) {
    return { verdict: null, error: e instanceof Error ? e.message : "screen failed" };
  }
}

async function screenPending(dialect: string, limit: number): Promise<Record<string, number>> {
  // Newest first: this is a trending queue, and the reviewer should see
  // today's posts before working back through the backlog.
  const { data, error } = await admin()
    .from("social_posts")
    .select("id, arabic_text, dialect")
    .eq("status", "pending")
    .eq("dialect", dialect)
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`social_posts fetch failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; arabic_text: string; dialect: string }>;

  const outcomes: Record<string, number> = {};
  for (const row of rows) {
    const started = Date.now();
    const { verdict, error: screenError } = await screenPost(row.arabic_text, row.dialect);
    const outcome = decideScreenOutcome(verdict, row.dialect);
    // A pending outcome means the screen itself was down — leave the row
    // untouched so the next run retries it.
    if (outcome.status !== "pending") {
      const { error: updateErr } = await admin()
        .from("social_posts")
        .update({
          status: outcome.status,
          dialect: outcome.dialect,
          translation: verdict?.translation ?? null,
          screen: {
            ...(verdict ?? { error: screenError ?? "unavailable" }),
            outcome: outcome.reason,
            decidedAt: new Date().toISOString(),
          },
        } as never)
        .eq("id", row.id);
      if (updateErr) throw new Error(`social_posts update failed: ${updateErr.message}`);
    }
    emitMetric({
      feature: FEATURE,
      event: "post_screened",
      dialect: outcome.dialect,
      status: outcome.status === "pending" ? "warn" : "ok",
      durationMs: Date.now() - started,
      meta: { outcome: outcome.status, reason: outcome.reason },
    });
    outcomes[outcome.status] = (outcomes[outcome.status] ?? 0) + 1;
  }
  return outcomes;
}

/** Posts a dialect already has awaiting or past human review. */
async function countInReview(dialect: string): Promise<number> {
  const { count, error } = await admin()
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .in("status", ["screened", "approved"])
    .eq("dialect", dialect);
  if (error) throw new Error(`social_posts count failed: ${error.message}`);
  return count ?? 0;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!(await hasHarvestSecret(req)) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const platform = ["x", "reddit", "telegram", "all"].includes(body.platform)
      ? (body.platform as string)
      : "all";
    const perSource = Math.max(1, Math.min(30, Number(body.perSource) || 15));
    // Keep screening until every dialect has `targetPerDialect` posts awaiting
    // or past human review, or its pending queue runs dry. Bounds: the run
    // stops at maxScreenCalls model calls or the time budget, so a
    // full-reject backlog can't loop forever.
    const targetPerDialect = Math.max(1, Math.min(20, Number(body.targetPerDialect) || 5));
    const batchSize = Math.max(1, Math.min(30, Number(body.screenLimit) || 12));
    const maxScreenCalls = Math.max(batchSize, Math.min(150, Number(body.maxScreenCalls) || 60));
    const timeBudgetMs = 100_000;

    const started = Date.now();
    const summary: Record<string, unknown> = {};
    if (platform === "x" || platform === "all") {
      summary.topics = await harvestTrends();
    }
    if (platform === "telegram" || platform === "all") {
      summary.telegramPosts = await harvestPosts("telegram", perSource);
    }
    if (platform === "reddit" || platform === "all") {
      summary.redditPosts = await harvestPosts("reddit", perSource);
    }

    // Per-dialect screening, neediest dialect first so one productive dialect
    // can't spend the whole budget while another sits at zero. Two rounds:
    // the first caps each dialect at an equal share of the budget, the second
    // gives whatever is left to dialects still under target.
    const DIALECTS = ["Gulf", "Egyptian", "Yemeni"];
    interface DialectReview {
      target: number;
      have: number;
      screenedThisRun: Record<string, number>;
      queueEmpty: boolean;
    }
    const review: Record<string, DialectReview> = {};
    for (const dialect of DIALECTS) {
      review[dialect] = {
        target: targetPerDialect,
        have: await countInReview(dialect),
        screenedThisRun: {},
        queueEmpty: false,
      };
    }
    let screenCalls = 0;
    const fairShare = Math.ceil(maxScreenCalls / DIALECTS.length);
    for (const roundCap of [fairShare, maxScreenCalls]) {
      const needy = DIALECTS
        .filter((d) => review[d].have < review[d].target && !review[d].queueEmpty)
        .sort((a, b) => review[a].have - review[b].have);
      for (const dialect of needy) {
        const info = review[dialect];
        let spentThisRound = 0;
        while (
          info.have < info.target &&
          !info.queueEmpty &&
          spentThisRound < roundCap &&
          screenCalls < maxScreenCalls &&
          Date.now() - started < timeBudgetMs
        ) {
          const batch = Math.min(batchSize, roundCap - spentThisRound, maxScreenCalls - screenCalls);
          const outcomes = await screenPending(dialect, batch);
          const touched = Object.values(outcomes).reduce((a, b) => a + b, 0);
          screenCalls += touched;
          spentThisRound += touched;
          for (const [k, v] of Object.entries(outcomes)) {
            info.screenedThisRun[k] = (info.screenedThisRun[k] ?? 0) + v;
          }
          info.have += outcomes.screened ?? 0;
          if (touched < batch) info.queueEmpty = true;
          // The screen itself is down: stop burning the budget on retries.
          if (touched > 0 && (outcomes.pending ?? 0) === touched) break;
        }
      }
    }
    summary.review = review;
    summary.screenCalls = screenCalls;
    summary.allTargetsReached = DIALECTS.every((d) => review[d].have >= review[d].target);

    emitMetric({
      feature: FEATURE,
      event: "request_complete",
      durationMs: Date.now() - started,
      meta: summary,
    });
    return json(summary, 200, corsHeaders);
  } catch (e) {
    console.error(`[${FEATURE}] error`, e);
    emitMetric({ feature: FEATURE, event: "request_failed", status: "error" });
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
