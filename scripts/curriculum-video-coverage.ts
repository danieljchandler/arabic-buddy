#!/usr/bin/env -S npx vite-node
/**
 * Which curriculum words are already on video?
 *
 * Reads every source of real speech the app holds — discover_videos
 * transcripts (the videos already uploaded and reviewed), the caption index
 * built by the clip pipeline, and published clips — and matches each line
 * against the track vocabulary of its dialect. Writes
 * curriculum/video-needs/coverage-<dialect>.md: per word, the videos and
 * timestamps where it is said, then the list of words nobody has filmed yet.
 * That is the harvesting worklist: mine the hits with the clip pipeline, hunt
 * for the rest with the searches in <dialect>.md.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/curriculum-video-coverage.ts [--dialect Gulf]
 *
 * Needs the service role because caption_lines and channel_videos are
 * admin-read tables. Read-only: nothing is written to the database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { coverageMarkdown, matchTranscripts, type SpeechLine } from "../src/lib/curriculumVideo";
import { TRACK_DIALECTS, type TrackDialect } from "../src/lib/curriculumTracks";
import { loadDialectTracks } from "./curriculum/loadTracks";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const args = process.argv.slice(2);
const onlyDialect = args[args.indexOf("--dialect") + 1];
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function pageAll<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await fetch(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

async function loadLines(): Promise<SpeechLine[]> {
  const lines: SpeechLine[] = [];

  type Video = { id: string; title: string; dialect: string; transcript_lines: unknown };
  const videos = await pageAll<Video>((from, to) =>
    supabase.from("discover_videos").select("id, title, dialect, transcript_lines").range(from, to),
  );
  for (const v of videos) {
    if (!Array.isArray(v.transcript_lines)) continue;
    for (const raw of v.transcript_lines) {
      const line = raw as { arabic?: unknown; startMs?: unknown; endMs?: unknown };
      if (typeof line.arabic !== "string") continue;
      lines.push({
        source: "discover_video",
        dialect: v.dialect,
        videoId: v.id,
        videoTitle: v.title,
        text: line.arabic,
        startMs: typeof line.startMs === "number" ? line.startMs : null,
        endMs: typeof line.endMs === "number" ? line.endMs : null,
      });
    }
  }

  type Channel = { id: string; dialect: string; name: string };
  const channels = await pageAll<Channel>((from, to) => supabase.from("content_channels").select("id, dialect, name").range(from, to));
  const channelById = new Map(channels.map((c) => [c.id, c]));
  type ChannelVideo = { id: string; channel_id: string; yt_video_id: string; title: string };
  const channelVideos = await pageAll<ChannelVideo>((from, to) =>
    supabase.from("channel_videos").select("id, channel_id, yt_video_id, title").range(from, to),
  );
  const videoById = new Map(channelVideos.map((v) => [v.id, v]));
  type Caption = { video_id: string; text: string; start_ms: number; end_ms: number };
  const captions = await pageAll<Caption>((from, to) => supabase.from("caption_lines").select("video_id, text, start_ms, end_ms").range(from, to));
  for (const c of captions) {
    const video = videoById.get(c.video_id);
    const channel = video && channelById.get(video.channel_id);
    if (!video || !channel) continue;
    lines.push({
      source: "caption_line",
      dialect: channel.dialect,
      videoId: video.yt_video_id,
      videoTitle: `${channel.name} — ${video.title}`,
      text: c.text,
      startMs: c.start_ms,
      endMs: c.end_ms,
    });
  }

  type Clip = { yt_video_id: string; channel_name: string | null; dialect: string; arabic: string; start_ms: number; end_ms: number };
  const clips = await pageAll<Clip>((from, to) =>
    supabase.from("published_clips").select("yt_video_id, channel_name, dialect, arabic, start_ms, end_ms").range(from, to),
  );
  for (const c of clips) {
    lines.push({
      source: "published_clip",
      dialect: c.dialect,
      videoId: c.yt_video_id,
      videoTitle: c.channel_name ?? "published clip",
      text: c.arabic,
      startMs: c.start_ms,
      endMs: c.end_ms,
    });
  }
  return lines;
}

const OUT = resolve(__dirname, "../curriculum/video-needs");
mkdirSync(OUT, { recursive: true });
const lines = await loadLines();
console.log(`${lines.length} lines of speech loaded`);
const generatedAt = new Date().toISOString().slice(0, 10);
for (const dialect of TRACK_DIALECTS) {
  if (onlyDialect && onlyDialect.toLowerCase() !== dialect.toLowerCase()) continue;
  const tracks = loadDialectTracks(dialect as TrackDialect);
  if (tracks.length === 0) continue;
  const hits = matchTranscripts(tracks, lines.filter((l) => l.dialect === dialect));
  const { markdown, summary } = coverageMarkdown(tracks, hits, generatedAt);
  const path = resolve(OUT, `coverage-${dialect.toLowerCase()}.md`);
  writeFileSync(path, markdown);
  console.log(`${dialect}: ${summary.covered}/${summary.words} words covered by ${summary.lines} lines → ${path}`);
}
