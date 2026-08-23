#!/usr/bin/env -S deno run --allow-env --allow-net --allow-run --allow-read --allow-write
/**
 * Clip pipeline, stage 2: fill the caption index.
 *
 * For every harvested video (channel_videos) that has no caption_lines yet,
 * fetches the Arabic caption track, normalizes and dialect-scores each line
 * with the same shared modules the app uses (msaLeakDetector.normalizeArabic,
 * dialectMarkers), and writes the searchable index. After each channel
 * completes, rolls line scores up into content_channels.dialect_score /
 * msa_score — the machine half of channel vetting.
 *
 * Caption source is yt-dlp run LOCALLY (not from cloud egress — YouTube
 * blocks datacenter IP ranges), manual track preferred over auto. Be a polite
 * client: --sleep seconds between videos (default 2). Downloading captions at
 * scale sits outside YouTube ToS — keep volume modest, or route through a
 * commercial transcript API instead; the learner-facing product never touches
 * these files, it embeds the videos.
 *
 * Requires yt-dlp on PATH (https://github.com/yt-dlp/yt-dlp). If subtitle
 * requests come back empty, YouTube is asking for a PO token — install the
 * bgutil-ytdlp-pot-provider plugin and retry.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno run --allow-env --allow-net --allow-run --allow-read --allow-write \
 *     scripts/fetch-captions.ts [options]
 *
 * Options:
 *   --dialect Gulf|Egyptian|Yemeni   only videos of channels in this dialect
 *   --channel <substring>            only channels whose name matches
 *   --limit N                        max videos this run (default 50)
 *   --sleep N                        seconds between yt-dlp calls (default 2)
 *   --refetch                        re-fetch videos that already have lines
 *   --dry-run                        parse and score, write nothing
 */

import { normalizeArabic } from '../supabase/functions/_shared/msaLeakDetector.ts';
import {
  aggregateChannelScores,
  scoreLineForDialect,
  type MarkerDialect,
} from '../supabase/functions/_shared/dialectMarkers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  Deno.exit(1);
}

function argValue(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
const has = (name: string) => Deno.args.includes(name);

const ONLY_DIALECT = argValue('--dialect');
const ONLY_CHANNEL = argValue('--channel')?.toLowerCase();
const LIMIT = Number(argValue('--limit') ?? 50);
const SLEEP_S = Number(argValue('--sleep') ?? 2);
const REFETCH = has('--refetch');
const DRY_RUN = has('--dry-run');

// ---------- Supabase REST helpers ----------

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

async function dbInsert(table: string, rows: unknown[]): Promise<void> {
  if (DRY_RUN) return;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`insert ${table}: ${res.status} ${await res.text()}`);
  }
}

async function dbDelete(table: string, filter: string): Promise<void> {
  if (DRY_RUN) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: dbHeaders,
  });
  if (!res.ok) throw new Error(`delete ${table}: ${res.status} ${await res.text()}`);
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

// ---------- yt-dlp ----------

interface CaptionLine {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Fetch the Arabic caption track for one video. Returns null when the video
 * has no Arabic captions at all. Manual track wins over auto.
 */
async function fetchTrack(
  ytVideoId: string,
  tmpDir: string,
): Promise<{ source: 'manual' | 'auto'; lines: CaptionLine[] } | null> {
  for (const source of ['manual', 'auto'] as const) {
    const subFlag = source === 'manual' ? '--write-subs' : '--write-auto-subs';
    const cmd = new Deno.Command('yt-dlp', {
      args: [
        '--skip-download', subFlag,
        '--sub-langs', 'ar,ar-.*',
        '--sub-format', 'json3',
        '--no-warnings',
        '-o', `${tmpDir}/${ytVideoId}.%(ext)s`,
        `https://www.youtube.com/watch?v=${ytVideoId}`,
      ],
      stdout: 'null',
      stderr: 'piped',
    });
    const out = await cmd.output();
    if (!out.success) {
      const err = new TextDecoder().decode(out.stderr).trim().split('\n').at(-1);
      console.warn(`  yt-dlp (${source}): ${err}`);
      continue;
    }
    // yt-dlp names the file <id>.<lang>.json3 — take whatever ar* landed.
    for await (const entry of Deno.readDir(tmpDir)) {
      if (entry.name.startsWith(`${ytVideoId}.ar`) && entry.name.endsWith('.json3')) {
        const raw = JSON.parse(await Deno.readTextFile(`${tmpDir}/${entry.name}`));
        await Deno.remove(`${tmpDir}/${entry.name}`);
        const lines = parseJson3(raw);
        if (lines.length > 0) return { source, lines };
      }
    }
  }
  return null;
}

/** YouTube json3 caption format → lines. */
function parseJson3(raw: { events?: Array<Record<string, unknown>> }): CaptionLine[] {
  const lines: CaptionLine[] = [];
  for (const ev of raw.events ?? []) {
    const start = ev.tStartMs as number | undefined;
    const dur = ev.dDurationMs as number | undefined;
    const segs = ev.segs as Array<{ utf8?: string }> | undefined;
    if (start === undefined || !segs) continue;
    const text = segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    // Skip empties and music/sound-effect markers.
    if (!text || /^[[(♪♫]/.test(text)) continue;
    lines.push({
      startMs: Math.round(start),
      endMs: Math.round(start + (dur ?? 2000)),
      text,
    });
  }
  return lines;
}

// ---------- main ----------

interface VideoRow {
  id: string;
  yt_video_id: string;
  caption_status: string;
  channel_id: string;
  content_channels: { id: string; name: string; dialect: string };
}

let q = 'channel_videos?select=id,yt_video_id,caption_status,channel_id,content_channels!inner(id,name,dialect)'
  + '&availability=neq.unavailable&order=published_at.desc.nullslast';
if (ONLY_DIALECT) q += `&content_channels.dialect=eq.${ONLY_DIALECT}`;

let videos = await dbSelect<VideoRow>(q);
if (ONLY_CHANNEL) {
  videos = videos.filter((v) => v.content_channels.name.toLowerCase().includes(ONLY_CHANNEL));
}
if (!REFETCH) {
  // caption_status flips to auto/manual/none once processed; 'unknown' means
  // never fetched, 'manual' from the harvester is a hint, not a fetch record —
  // only skip rows fetch-captions itself has finished ('none' or already
  // indexed lines, which set auto/manual here).
  const done = new Set(
    (await dbSelect<{ video_id: string }>('caption_lines?select=video_id')).map((r) => r.video_id),
  );
  videos = videos.filter((v) => !done.has(v.id) && v.caption_status !== 'none');
}
videos = videos.slice(0, LIMIT);

console.log(`${videos.length} video(s) to fetch${DRY_RUN ? ' (dry run)' : ''}`);
const tmpDir = await Deno.makeTempDir({ prefix: 'captions-' });
const touchedChannels = new Map<string, { name: string; dialect: string }>();

for (const video of videos) {
  const dialect = video.content_channels.dialect as MarkerDialect;
  console.log(`\n${video.yt_video_id} (${video.content_channels.name})`);
  const track = await fetchTrack(video.yt_video_id, tmpDir);

  if (!track) {
    console.log('  no Arabic captions — marked none (ASR is the fallback path)');
    await dbPatch('channel_videos', `id=eq.${video.id}`, { caption_status: 'none' });
  } else {
    const rows = track.lines.map((line) => {
      const scores = scoreLineForDialect(line.text, dialect);
      return {
        video_id: video.id,
        start_ms: line.startMs,
        end_ms: Math.max(line.endMs, line.startMs + 1),
        text: line.text,
        text_normalized: normalizeArabic(line.text),
        source: track.source,
        dialect_score: scores.dialectScore,
        msa_score: scores.msaScore,
      };
    });
    await dbDelete('caption_lines', `video_id=eq.${video.id}`);
    await dbInsert('caption_lines', rows);
    await dbPatch('channel_videos', `id=eq.${video.id}`, { caption_status: track.source });
    touchedChannels.set(video.channel_id, video.content_channels);
    console.log(`  ${rows.length} ${track.source} lines indexed`);
  }

  if (SLEEP_S > 0) await new Promise((r) => setTimeout(r, SLEEP_S * 1000));
}

// Channel-level rollup over everything indexed so far (not just this run).
for (const [channelId, info] of touchedChannels) {
  const lines = await dbSelect<{ text: string }>(
    `caption_lines?select=text,channel_videos!inner(channel_id)&channel_videos.channel_id=eq.${channelId}&limit=5000`,
  );
  const agg = aggregateChannelScores(lines.map((l) => l.text), info.dialect as MarkerDialect);
  await dbPatch('content_channels', `id=eq.${channelId}`, {
    dialect_score: agg.dialectScore,
    msa_score: agg.msaScore,
    updated_at: new Date().toISOString(),
  });
  console.log(
    `\n${info.name}: dialect ${agg.dialectScore.toFixed(2)}, MSA ${agg.msaScore.toFixed(2)}, ` +
    `misfit share ${(agg.misfitShare * 100).toFixed(0)}% over ${agg.lineCount} lines`,
  );
}

await Deno.remove(tmpDir, { recursive: true });
console.log('\nDone.');
