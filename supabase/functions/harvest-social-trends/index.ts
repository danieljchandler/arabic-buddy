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
// Every harvested post lands as status='pending' and must pass an askBrain
// screen (UTILITY lineup, solo, forced tool call) before learners see it:
// trending and news content skews MSA, the one register this app refuses to
// teach, so the screen is the feature's load-bearing wall, not a nicety.
// The same call produces the English translation, so screening adds no
// second model pass. A screen outage leaves posts pending — nothing
// auto-publishes unjudged (same rule as the clip pipeline).
//
// Gated to content managers, plus the SOCIAL_HARVEST_SECRET header for the
// scheduled automation loop. Parsing/decision logic is pure and lives in
// _shared/socialTrendsCore.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getLineup } from "../_shared/modelRegistry.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";
import {
  decideScreenOutcome,
  extractRedditPosts,
  hasArabic,
  type HarvestedPost,
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

function hasHarvestSecret(req: Request): boolean {
  const secret = Deno.env.get("SOCIAL_HARVEST_SECRET");
  if (!secret) return false;
  return req.headers.get("x-harvest-secret") === secret;
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

async function fetchTelegramHtml(handle: string): Promise<string> {
  try {
    const res = await fetch(`https://t.me/s/${handle}`);
    if (res.ok) {
      const html = await res.text();
      if (html.includes("tgme_widget_message")) return html;
    }
  } catch {
    /* fall through to Jina */
  }
  return await fetchViaJina(`https://t.me/s/${handle}`, "html");
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
      // Same bar Reddit posts clear in the parser: an all-emoji or all-media
      // caption never costs a screening call.
      posts = parseTelegramPreviewHtml(await fetchTelegramHtml(source.handle))
        .filter((p) => hasArabic(p.text));
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

async function screenPending(limit: number): Promise<Record<string, number>> {
  const { data, error } = await admin()
    .from("social_posts")
    .select("id, arabic_text, dialect")
    .eq("status", "pending")
    .order("captured_at", { ascending: true })
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

async function countApproved(): Promise<number> {
  const { data, error } = await admin()
    .from("social_posts")
    .select("id")
    .eq("status", "approved")
    .limit(200);
  if (error) throw new Error(`social_posts count failed: ${error.message}`);
  return data?.length ?? 0;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!hasHarvestSecret(req) && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const platform = ["x", "reddit", "telegram", "all"].includes(body.platform)
      ? (body.platform as string)
      : "all";
    const perSource = Math.max(1, Math.min(20, Number(body.perSource) || 10));
    // Keep screening until `targetApproved` approved posts exist, or the
    // pending backlog is exhausted. Bounds: each batch is one screenLimit of
    // model calls and the whole run stops at maxScreenCalls or the time
    // budget so a full-reject backlog can't loop forever.
    const targetApproved = Math.max(1, Math.min(50, Number(body.targetApproved) || 10));
    const batchSize = Math.max(1, Math.min(30, Number(body.screenLimit) || 12));
    const maxScreenCalls = Math.max(batchSize, Math.min(120, Number(body.maxScreenCalls) || 48));
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

    const approvedBefore = await countApproved();
    let screenCalls = 0;
    const screenedTotal: Record<string, number> = {};
    while (
      approvedBefore + (screenedTotal.approved ?? 0) < targetApproved &&
      screenCalls < maxScreenCalls &&
      Date.now() - started < timeBudgetMs
    ) {
      const batch = Math.min(batchSize, maxScreenCalls - screenCalls);
      const outcomes = await screenPending(batch);
      screenCalls += batch;
      for (const [k, v] of Object.entries(outcomes)) {
        screenedTotal[k] = (screenedTotal[k] ?? 0) + v;
      }
      const touched = Object.values(outcomes).reduce((a, b) => a + b, 0);
      // No pending rows left, or the screen is down and left everything pending.
      if (touched < batch || (outcomes.pending ?? 0) === touched) break;
    }
    const approved = approvedBefore + (screenedTotal.approved ?? 0);
    summary.screened = screenedTotal;
    summary.approved = approved;
    summary.targetApproved = targetApproved;
    summary.targetReached = approved >= targetApproved;

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
