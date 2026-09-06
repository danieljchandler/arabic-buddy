#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
/**
 * X content pipeline, stage 1: turn research into registry rows.
 *
 * There is no free X search (see supabase/functions/_shared/xSyndication.ts),
 * so "which accounts write Yemeni or Egyptian on X" is not a question an API
 * answers. It is a research question, and the tool that answers it well is an
 * agent with a web search — Claude Code, say — proposing handles with the
 * evidence for each. This script is the bridge between that research and the
 * app: it reads the bundle, probes every handle against X's own syndication
 * endpoint, and posts what survives to the `import-x-bundle` edge function.
 *
 * Bundle shape (see docs/x-content-pipeline.md for the research prompt):
 *
 *   {
 *     "sources": [
 *       { "handle": "someaccount", "displayName": "...", "dialect": "Yemeni",
 *         "country": "Yemen", "notes": "why this account, and what it posts" }
 *     ],
 *     "posts": [
 *       { "url": "https://x.com/someaccount/status/123", "dialect": "Yemeni",
 *         "note": "why this post is worth teaching" }
 *     ]
 *   }
 *
 * Nothing here can publish. Sources land as candidates for a human to approve
 * on /admin/social-trends, and posts land as pending for the same screen and
 * the same reviewer as anything the harvester found.
 *
 * Usage:
 *   SUPABASE_URL=... SOCIAL_HARVEST_SECRET=... \
 *     deno run --allow-env --allow-net --allow-read \
 *     scripts/discover-x-sources.ts bundle.json [options]
 *
 * Options:
 *   --dry-run       probe and report the payload; post nothing, and needs\n *                   no credentials
 *   --probe-only    probe locally and print the table, then exit (no network
 *                   call to Supabase at all). Useful when the edge function's
 *                   IP is throttled but yours is not.
 *   --no-verify     let the edge function skip its own verification fetch
 *   --min-arabic N  drop a handle whose timeline had fewer than N Arabic
 *                   posts before posting the bundle (default 3)
 */

import {
  parseSyndicationTimeline,
  summariseTimeline,
  SYNDICATION_PACING_MS,
  timelineProfileUrl,
} from "../supabase/functions/_shared/xSyndication.ts";
import { prescreen } from "../supabase/functions/_shared/socialPrescreen.ts";
import { hasArabic } from "../supabase/functions/_shared/socialTrendsCore.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const args = Deno.args;
const bundlePath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const probeOnly = args.includes("--probe-only");
const verify = !args.includes("--no-verify");
const minArabic = Number(args[args.indexOf("--min-arabic") + 1]) || 3;

if (!bundlePath) {
  console.error("Usage: discover-x-sources.ts <bundle.json> [--dry-run] [--probe-only]");
  Deno.exit(1);
}

interface Bundle {
  sources?: Array<Record<string, unknown>>;
  posts?: Array<Record<string, unknown>>;
}

const bundle: Bundle = JSON.parse(await Deno.readTextFile(bundlePath));
const sources = bundle.sources ?? [];
const posts = bundle.posts ?? [];
console.log(`Bundle: ${sources.length} sources, ${posts.length} posts\n`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Probe {
  handle: string;
  status: number | "error";
  tweets: number;
  arabic: number;
  screenable: number;
  newestAgeDays: number | null;
  /** Ran out of retries against the throttle — says nothing about the handle. */
  throttled: boolean;
}

/**
 * One handle's timeline.
 *
 * Retries a 429 with a long backoff rather than skipping: syndication
 * throttles per IP for minutes at a time, and a probe run that quietly
 * reports every handle as unreachable because the third one tripped a limit
 * is worse than a slow one.
 */
async function probe(handle: string): Promise<Probe> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(timelineProfileUrl(handle), {
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.status === 429) {
        const wait = 30_000 * (attempt + 1);
        console.log(`  ${handle}: throttled, waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        return {
          handle, status: res.status, tweets: 0, arabic: 0, screenable: 0,
          newestAgeDays: null, throttled: false,
        };
      }
      const parsed = parseSyndicationTimeline(await res.text());
      const arabic = parsed.filter((p) => hasArabic(p.text));
      return {
        handle,
        status: res.status,
        tweets: parsed.length,
        arabic: arabic.length,
        screenable: arabic.filter((p) => prescreen(p.text).worthScreening).length,
        newestAgeDays: summariseTimeline(parsed).newestAgeDays,
        throttled: false,
      };
    } catch {
      return {
        handle, status: "error", tweets: 0, arabic: 0, screenable: 0,
        newestAgeDays: null, throttled: false,
      };
    }
  }
  return {
    handle, status: 429, tweets: 0, arabic: 0, screenable: 0,
    newestAgeDays: null, throttled: true,
  };
}

const probes: Probe[] = [];
for (const [index, source] of sources.entries()) {
  const handle = String(source.handle ?? "");
  if (index > 0) await sleep(SYNDICATION_PACING_MS);
  probes.push(await probe(handle));
}

if (probes.length > 0) {
  console.log("handle".padEnd(20), "http".padEnd(6), "tweets".padEnd(8), "arabic".padEnd(8), "screenable".padEnd(12), "newest (days)");
  for (const p of probes) {
    console.log(
      p.handle.padEnd(20),
      String(p.status).padEnd(6),
      String(p.tweets).padEnd(8),
      String(p.arabic).padEnd(8),
      String(p.screenable).padEnd(12),
      p.newestAgeDays === null ? "—" : String(p.newestAgeDays),
    );
  }
  console.log();
}

// Freshness is reported but never a filter: syndication serves some accounts a
// live timeline and others an engagement-ranked cached set months old, and for
// a dialect corpus the cached set is often the better half.
const keep = new Set(probes.filter((p) => p.arabic >= minArabic).map((p) => p.handle));

// A throttled handle is NOT a dead one, and must never be reported as if it
// were: the point of the probe is to tell an operator which handles to bin,
// and lumping "X would not talk to us" in with "this account does not exist"
// is how a good source gets deleted for nothing.
const throttled = probes.filter((p) => p.throttled);
const dropped = probes.filter((p) => !keep.has(p.handle) && !p.throttled);
if (dropped.length > 0) {
  console.log(`Dropping ${dropped.length} handle(s) under --min-arabic ${minArabic}: ` +
    dropped.map((p) => p.handle).join(", "));
}
if (throttled.length > 0) {
  console.log(
    `\n! ${throttled.length} handle(s) never got an answer — X throttled us, ` +
      `which says nothing about them:\n  ${throttled.map((p) => p.handle).join(", ")}\n` +
      `  Wait a few minutes and re-run. They are held back from this import, not judged.`,
  );
}

if (probeOnly) Deno.exit(0);

const payload = {
  sources: sources.filter((s) => keep.has(String(s.handle ?? ""))),
  posts,
  verify,
};

// Before the credential check, not after: a dry run posts nothing, so making
// it demand secrets it will never use is a wart on the one flag people reach
// for when they are still deciding whether to trust the bundle.
if (dryRun) {
  console.log("\n--dry-run, would post:\n", JSON.stringify(payload, null, 2));
  Deno.exit(0);
}
if (payload.sources.length === 0 && payload.posts.length === 0) {
  console.log("Nothing survived the probe; posting nothing.");
  Deno.exit(0);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SECRET = Deno.env.get("SOCIAL_HARVEST_SECRET");
if (!SUPABASE_URL || !SECRET) {
  console.error("Set SUPABASE_URL and SOCIAL_HARVEST_SECRET (or pass --probe-only / --dry-run).");
  Deno.exit(1);
}

const response = await fetch(`${SUPABASE_URL}/functions/v1/import-x-bundle`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-harvest-secret": SECRET },
  body: JSON.stringify(payload),
});
const result = await response.json().catch(() => ({}));
console.log(`\nimport-x-bundle → ${response.status}`);
console.log(JSON.stringify(result, null, 2));
Deno.exit(response.ok ? 0 : 1);
