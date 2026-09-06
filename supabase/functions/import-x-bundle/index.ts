// import-x-bundle: the research loop's way into the app.
//
// There is no free X search (see _shared/xSyndication.ts), so "which accounts
// write Yemeni or Egyptian on X" cannot be answered by an API — it is a
// research question. What answers it well is an agent with a web search tool
// and a person who can read the results: Claude Code proposes handles and
// specific posts, with the evidence for each, and this function is where that
// proposal lands.
//
// The contract is deliberately narrow, because the proposal comes from
// outside the trust boundary:
//
//   - a proposed *source* is only ever written as status='candidate', never
//     approved. The registry's approve/reject call stays with a human on
//     /admin/social-trends, and an existing approved source is never
//     downgraded by a re-import.
//   - a proposed *post* is not taken on the bundle's word. Only the tweet id
//     is used; the body is re-fetched from X's own syndication endpoint, so a
//     bundle cannot plant text that was never posted. It lands as
//     status='pending' and goes through the same prefilter, the same askBrain
//     screen and the same human review as anything the harvester found.
//   - nothing here can approve, publish, or reach a learner.
//
// Gated to content managers, plus SOCIAL_HARVEST_SECRET for scripted runs
// (scripts/discover-x-sources.ts). See docs/x-content-pipeline.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret } from "../_shared/requireRole.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";
import { hasArabic } from "../_shared/socialTrendsCore.ts";
import { prescreen } from "../_shared/socialPrescreen.ts";
import {
  isXHandle,
  parseSyndicationTimeline,
  parseTweetResult,
  parseXPostUrl,
  summariseTimeline,
  SYNDICATION_PACING_MS,
  timelineProfileUrl,
  tweetResultUrl,
} from "../_shared/xSyndication.ts";

const FEATURE = "import-x-bundle";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DIALECTS = ["Gulf", "Egyptian", "Yemeni"];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function isContentManager(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return false;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user?.id) return false;
  const { data: roles } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .in("role", ["admin", "content_reviewer"]);
  return Array.isArray(roles) && roles.length > 0;
}

interface ProposedSource {
  handle?: unknown;
  displayName?: unknown;
  dialect?: unknown;
  country?: unknown;
  notes?: unknown;
}

interface ProposedPost {
  url?: unknown;
  id?: unknown;
  dialect?: unknown;
  note?: unknown;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

// ---------- sources ----------

interface SourceOutcome {
  handle: string;
  outcome: string;
  verification?: Record<string, unknown>;
}

async function importSource(
  proposed: ProposedSource,
  verify: boolean,
): Promise<SourceOutcome> {
  const handle = text(proposed.handle, 15);
  if (!handle || !isXHandle(handle)) {
    return { handle: String(proposed.handle ?? ""), outcome: "invalid_handle" };
  }
  const dialect = text(proposed.dialect, 20);
  if (!dialect || !DIALECTS.includes(dialect)) {
    return { handle, outcome: "invalid_dialect" };
  }

  let verification: Record<string, unknown> = {};
  if (verify) {
    // Verify by fetching, not by trusting the bundle: the claim worth storing
    // is "this handle resolves and posts Arabic", and only a fetch shows that.
    try {
      const res = await fetch(timelineProfileUrl(handle), {
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.status === 429) {
        verification = { rateLimited: true };
      } else if (res.ok) {
        const posts = parseSyndicationTimeline(await res.text());
        const arabicPosts = posts.filter((p) => hasArabic(p.text));
        verification = {
          ...summariseTimeline(posts),
          prescreenPassed: arabicPosts.filter((p) => prescreen(p.text).worthScreening).length,
        };
      } else {
        verification = { httpStatus: res.status };
      }
    } catch {
      verification = { fetchFailed: true };
    }
    if (verification.rateLimited) return { handle, outcome: "rate_limited", verification };
    if (!verification.tweets) return { handle, outcome: "unreachable", verification };
  }

  const { data: existing } = await admin()
    .from("social_content_sources")
    .select("id, status")
    .eq("platform", "x")
    .eq("handle", handle)
    .maybeSingle();

  const notes = text(proposed.notes, 1000);
  const row = {
    platform: "x",
    handle,
    display_name: text(proposed.displayName, 200) ?? handle,
    dialect,
    country: text(proposed.country, 100),
    notes,
    updated_at: new Date().toISOString(),
    // Only a run that actually fetched may touch the evidence. A --no-verify
    // import must not blank the last real probe's findings.
    ...(verify ? { last_verified_at: new Date().toISOString(), verification } : {}),
  };

  if (existing) {
    // Re-importing a handle refreshes its evidence. It never touches `status`:
    // an approved source stays approved and a rejected one stays rejected,
    // because a bundle must not be able to resurrect a source a human binned.
    const { error } = await admin()
      .from("social_content_sources")
      .update({ ...row, notes: notes ?? undefined } as never)
      .eq("id", existing.id as string);
    if (error) throw new Error(`source update failed: ${error.message}`);
    return { handle, outcome: `existing_${existing.status}`, verification };
  }

  const { error } = await admin()
    .from("social_content_sources")
    .insert({ ...row, status: "candidate" } as never);
  if (error) throw new Error(`source insert failed: ${error.message}`);
  return { handle, outcome: "candidate", verification };
}

// ---------- posts ----------

interface PostOutcome {
  id: string;
  outcome: string;
}

async function hydrateAndStore(
  proposed: ProposedPost,
  sourceIds: Map<string, { id: string; dialect: string; country: string | null }>,
): Promise<PostOutcome> {
  const url = text(proposed.url, 500);
  const parsed = url ? parseXPostUrl(url) : null;
  const id = parsed?.id ?? (typeof proposed.id === "string" && /^\d{1,25}$/.test(proposed.id)
    ? proposed.id
    : null);
  if (!id) return { id: String(proposed.url ?? proposed.id ?? ""), outcome: "invalid_url" };

  let post: ReturnType<typeof parseTweetResult> = null;
  try {
    const res = await fetch(tweetResultUrl(id), { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 429) return { id, outcome: "rate_limited" };
    if (res.ok) post = parseTweetResult(await res.json());
  } catch {
    return { id, outcome: "fetch_failed" };
  }
  // Deleted, protected, or never existed. The bundle's own copy of the text is
  // deliberately not used as a fallback — an unverifiable body is not evidence.
  if (!post) return { id, outcome: "unavailable" };
  if (!hasArabic(post.text)) return { id, outcome: "no_arabic" };

  const pre = prescreen(post.text);
  const source = post.author ? sourceIds.get(post.author.toLowerCase()) : undefined;
  const dialect = text(proposed.dialect, 20) ?? source?.dialect ?? null;
  if (!dialect || !DIALECTS.includes(dialect)) return { id, outcome: "invalid_dialect" };

  const { error } = await admin()
    .from("social_posts")
    .upsert(
      {
        source_id: source?.id ?? null,
        platform: "x",
        external_id: post.externalId,
        url: post.url,
        author: post.author,
        dialect,
        country: source?.country ?? null,
        arabic_text: post.text,
        engagement: post.engagement,
        posted_at: post.postedAt,
        // The prefilter's reading travels with the row so the harvester's
        // screening pass can see it was a deliberate submission, not a scrape.
        screen: {
          submitted: true,
          note: text(proposed.note, 500),
          prefilter: pre.reason,
          markers: pre.profile,
        },
      } as never,
      { onConflict: "platform,external_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`social_posts upsert failed: ${error.message}`);
  return { id, outcome: pre.worthScreening ? "pending" : `pending_${pre.reason}` };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const bySecret = await hasSharedSecret(req, "x-harvest-secret", "SOCIAL_HARVEST_SECRET");
    if (!bySecret && !(await isContentManager(req))) {
      return json({ error: "content_manager_required" }, 403, corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const sources = Array.isArray(body.sources) ? body.sources.slice(0, 50) : [];
    const posts = Array.isArray(body.posts) ? body.posts.slice(0, 100) : [];
    const verify = body.verify !== false;
    if (sources.length === 0 && posts.length === 0) {
      return json({ error: "empty_bundle" }, 400, corsHeaders);
    }

    const started = Date.now();
    const sourceResults: SourceOutcome[] = [];
    for (const [index, proposed] of sources.entries()) {
      // Syndication throttles per IP; a bundle of 50 handles fetched flat out
      // earns a 429 that costs the rest of the run.
      if (verify && index > 0) await sleep(SYNDICATION_PACING_MS);
      sourceResults.push(await importSource(proposed as ProposedSource, verify));
    }

    // Resolve handles to source rows once, so a submitted post can inherit the
    // dialect and country of the account it came from.
    const known = new Map<string, { id: string; dialect: string; country: string | null }>();
    if (posts.length > 0) {
      const { data } = await admin()
        .from("social_content_sources")
        .select("id, handle, dialect, country")
        .eq("platform", "x");
      for (const row of (data ?? []) as Array<Record<string, string | null>>) {
        if (row.handle && row.id) {
          known.set(row.handle.toLowerCase(), {
            id: row.id,
            dialect: row.dialect ?? "Gulf",
            country: row.country,
          });
        }
      }
    }

    const postResults: PostOutcome[] = [];
    for (const [index, proposed] of posts.entries()) {
      if (index > 0) await sleep(SYNDICATION_PACING_MS);
      postResults.push(await hydrateAndStore(proposed as ProposedPost, known));
    }

    const summary = {
      sources: sourceResults,
      posts: postResults,
      accepted: postResults.filter((p) => p.outcome.startsWith("pending")).length,
    };
    emitMetric({
      feature: FEATURE,
      event: "request_complete",
      durationMs: Date.now() - started,
      count: summary.accepted,
      meta: { sources: sourceResults.length, posts: postResults.length },
    });
    return json(summary, 200, corsHeaders);
  } catch (e) {
    console.error(`[${FEATURE}] error`, e);
    emitMetric({ feature: FEATURE, event: "request_failed", status: "error" });
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
