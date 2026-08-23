#!/usr/bin/env -S deno run --allow-env --allow-net
/**
 * Clip pipeline, stage 1: enumerate the channel corpus.
 *
 * For each channel in `content_channels`, resolves its YouTube channel id
 * (from the stored handle where needed), pages the channel's uploads playlist,
 * and upserts every video into `channel_videos` with duration, embeddability
 * and a caption hint. Downstream, fetch-captions.ts fills `caption_lines` for
 * these videos.
 *
 * Quota shape (see docs/testing.md's sibling: the plan artifact): since the
 * 2026 granular-quota change, search.list is capped ~100 calls/day in its own
 * bucket, so this script NEVER calls search.list unless --resolve-names is
 * passed explicitly. Everything else is cheap: channels.list and videos.list
 * are 1 unit each, playlistItems.list is 1 unit per 50 videos — a full
 * 50-channel harvest costs a few hundred units of the 10,000/day pool.
 *
 * Usage:
 *   YOUTUBE_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno run --allow-env --allow-net scripts/harvest-channels.ts [options]
 *
 * Options:
 *   --dialect Gulf|Egyptian|Yemeni   only channels of this dialect
 *   --channel <substring>            only channels whose name matches
 *   --include-candidates             also harvest status='candidate' channels
 *                                    (default: approved only)
 *   --max-videos N                   per channel (default 200, newest first)
 *   --min-seconds N                  skip shorter videos (default 45)
 *   --max-seconds N                  skip longer videos (default 900)
 *   --resolve-names                  use search.list for channels that have
 *                                    neither id nor handle (quota-scarce!)
 *   --dry-run                        report, write nothing
 */

const YT = 'https://www.googleapis.com/youtube/v3';

const API_KEY = Deno.env.get('YOUTUBE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Set YOUTUBE_API_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  Deno.exit(1);
}

// ---------- args ----------

function argValue(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
const has = (name: string) => Deno.args.includes(name);

const ONLY_DIALECT = argValue('--dialect');
const ONLY_CHANNEL = argValue('--channel')?.toLowerCase();
const MAX_VIDEOS = Number(argValue('--max-videos') ?? 200);
const MIN_SECONDS = Number(argValue('--min-seconds') ?? 45);
const MAX_SECONDS = Number(argValue('--max-seconds') ?? 900);
const INCLUDE_CANDIDATES = has('--include-candidates');
const RESOLVE_NAMES = has('--resolve-names');
const DRY_RUN = has('--dry-run');

// ---------- Supabase REST helpers (service role, plain PostgREST) ----------

const dbHeaders = {
  apikey: SERVICE_ROLE!,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function dbSelect<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders });
  if (!res.ok) throw new Error(`select ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dbUpsert(table: string, rows: unknown[], onConflict: string): Promise<void> {
  if (DRY_RUN || rows.length === 0) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`,
    {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`upsert ${table}: ${res.status} ${await res.text()}`);
}

async function dbPatch(table: string, filter: string, patch: unknown): Promise<void> {
  if (DRY_RUN) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...dbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch ${table}: ${res.status} ${await res.text()}`);
}

// ---------- YouTube API ----------

let unitsSpent = 0;

async function yt(endpoint: string, params: Record<string, string>, units: number): Promise<{
  items?: Array<Record<string, unknown>>;
  nextPageToken?: string;
}> {
  const url = new URL(`${YT}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', API_KEY!);
  const res = await fetch(url);
  unitsSpent += units;
  if (!res.ok) throw new Error(`${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** PT#H#M#S → seconds. */
function parseDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

async function resolveChannelId(ch: Channel): Promise<string | null> {
  if (ch.yt_channel_id) return ch.yt_channel_id;
  if (ch.handle) {
    const handle = ch.handle.replace(/^@/, '');
    const data = await yt('channels', { part: 'id', forHandle: handle }, 1);
    const id = data.items?.[0]?.id as string | undefined;
    if (id) return id;
    console.warn(`  handle @${handle} did not resolve`);
  }
  if (RESOLVE_NAMES) {
    // search.list: 100 units against the scarce dedicated bucket. Only on
    // explicit request, and the result still gets human eyes via the notes.
    const data = await yt('search', { part: 'snippet', q: ch.name, type: 'channel', maxResults: '1' }, 100);
    const id = (data.items?.[0]?.snippet as { channelId?: string } | undefined)?.channelId;
    if (id) {
      console.warn(`  resolved "${ch.name}" by SEARCH — verify this is the right channel before approving`);
      return id;
    }
  }
  return null;
}

interface Channel {
  id: string;
  name: string;
  handle: string | null;
  yt_channel_id: string | null;
  dialect: string;
  status: string;
}

// ---------- main ----------

const statusFilter = INCLUDE_CANDIDATES
  ? 'status=in.(approved,candidate)'
  : 'status=eq.approved';
let channelQuery = `content_channels?select=id,name,handle,yt_channel_id,dialect,status&${statusFilter}&order=name`;
if (ONLY_DIALECT) channelQuery += `&dialect=eq.${ONLY_DIALECT}`;

let channels = await dbSelect<Channel>(channelQuery);
if (ONLY_CHANNEL) channels = channels.filter((c) => c.name.toLowerCase().includes(ONLY_CHANNEL));

console.log(`${channels.length} channel(s) to harvest${DRY_RUN ? ' (dry run)' : ''}`);

let totalVideos = 0;
for (const ch of channels) {
  console.log(`\n${ch.name} [${ch.dialect}/${ch.status}]`);
  const channelId = await resolveChannelId(ch);
  if (!channelId) {
    console.warn('  no channel id and no resolvable handle — skipped (pass --resolve-names to spend search quota, or fill yt_channel_id by hand)');
    continue;
  }
  if (!ch.yt_channel_id) {
    await dbPatch('content_channels', `id=eq.${ch.id}`, { yt_channel_id: channelId });
  }

  // Uploads playlist: UC... → UU... — 1 unit per 50 videos.
  const uploads = channelId.replace(/^UC/, 'UU');
  const videoIds: string[] = [];
  const meta = new Map<string, { title: string; publishedAt: string | null }>();
  let pageToken: string | undefined;
  while (videoIds.length < MAX_VIDEOS) {
    const data = await yt('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploads,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    }, 1);
    for (const item of data.items ?? []) {
      const details = item.contentDetails as { videoId?: string; videoPublishedAt?: string };
      const snippet = item.snippet as { title?: string };
      if (!details?.videoId) continue;
      videoIds.push(details.videoId);
      meta.set(details.videoId, {
        title: snippet?.title ?? '',
        publishedAt: details.videoPublishedAt ?? null,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  // videos.list in 50-id batches: duration, embeddability, caption hint.
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const data = await yt('videos', {
      part: 'contentDetails,status',
      id: batch.join(','),
      maxResults: '50',
    }, 1);
    for (const item of data.items ?? []) {
      const id = item.id as string;
      const details = item.contentDetails as { duration?: string; caption?: string };
      const status = item.status as { embeddable?: boolean };
      const seconds = parseDuration(details?.duration);
      if (seconds === null || seconds < MIN_SECONDS || seconds > MAX_SECONDS) continue;
      rows.push({
        channel_id: ch.id,
        yt_video_id: id,
        title: meta.get(id)?.title ?? '',
        published_at: meta.get(id)?.publishedAt,
        duration_seconds: seconds,
        embeddable: status?.embeddable ?? null,
        availability: 'available',
        // contentDetails.caption reflects manual tracks only; 'unknown' still
        // lets fetch-captions try the auto track.
        caption_status: details?.caption === 'true' ? 'manual' : 'unknown',
        last_checked_at: new Date().toISOString(),
      });
    }
  }

  await dbUpsert('channel_videos', rows, 'yt_video_id');
  await dbPatch('content_channels', `id=eq.${ch.id}`, {
    last_harvested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  totalVideos += rows.length;
  console.log(`  ${rows.length} videos in the ${MIN_SECONDS}-${MAX_SECONDS}s window (of ${videoIds.length} enumerated)`);
}

console.log(`\nDone: ${totalVideos} videos across ${channels.length} channels; ~${unitsSpent} quota units spent.`);
