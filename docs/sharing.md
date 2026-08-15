# Sharing into the app

Share a message, a voice note, a screenshot, or a link straight to Hakiya from
another app; AI screens what it is and routes it to the right feature,
converting it on the way when needed. Admins get one extra power: sharing a
TikTok/YouTube/Instagram link starts the full Discover ingestion pipeline in a
single step.

## How it flows

```
Android share sheet
  → POST /share-target (manifest share_target)
    → service worker stashes payload in Cache Storage, 303 → /share
      → /share reads the stash (src/lib/shareInbox.ts)
        → deterministic routing (src/lib/shareRouting.ts) where obvious
        → screen-shared-content (AI, forced tool call) where not
          → in-memory handoff → destination page seeds itself and runs
```

The pieces:

| Piece | File | Job |
| --- | --- | --- |
| Manifest `share_target` | `public/manifest.webmanifest` | registers the app in Android's share sheet (installed PWA only) |
| SW POST handler | `public/sw.js` | receives the multipart POST, stashes it, redirects |
| Inbox | `src/lib/shareInbox.ts` | Cache Storage stash (survives the login bounce) + in-memory handoff to destination pages |
| Router | `src/lib/shareRouting.ts` | pure, unit-tested first pass — no AI for obvious payloads |
| Landing page | `src/pages/Share.tsx` | orchestrates: auth bounce, screening call, pipeline kickoff, manual fallback |
| AI screener | `supabase/functions/screen-shared-content` | one forced-tool-call on `DEFAULT_FAST`; classifies text/screenshots and extracts the Arabic |
| Admin ingest | `supabase/functions/ingest-shared-video` | link → `discover_videos` row → `process-approved-video` kickoff |

## Routing table

| Shared thing | Who | Lands in |
| --- | --- | --- |
| Audio file (voice note, clip) | everyone | Transcribe, file pre-loaded |
| Video file | admin | Transcribe (video path is admin-only) |
| Video file | learner | Meme Analyzer (frames + audio, auto-runs) |
| Image / screenshot | everyone | AI screen: chat/sign/menu screenshot → Translate with the Arabic extracted; meme → Meme Analyzer |
| Arabic text | everyone | AI screen → Translate, auto-runs |
| English "how do I say…" text | everyone | AI screen → How Do I Say, auto-runs |
| X/Twitter post link | everyone | Learn from X, auto-runs |
| TikTok / YouTube / Instagram link | admin | one-step Discover pipeline (below) |
| TikTok / YouTube / Instagram link | learner | friendly notice — link import is admin-only |
| Anything else | — | manual chooser on /share |

When the screener errors, the share still lands somewhere: text falls back to
Translate verbatim, an image to the Meme Analyzer (whose own OCR runs anyway).

## Admin one-step video ingestion

Share a TikTok link (vt./vm. short links included) to the app as an admin and
`/share` calls `ingest-shared-video`, which:

1. resolves the short link and parses the platform + video id
2. dedups against `discover_videos` (re-share opens the existing row)
3. pulls title/thumbnail from oEmbed
4. inserts the `discover_videos` row (unpublished, `transcription_status: pending`)
5. kicks `process-approved-video` with the service-role key — the pipeline
   finds no staged audio and falls back to `download-media` (Cobalt), which is
   the audio-extraction step; multi-engine ASR and analysis follow as for any
   admin-form upload

The /share page then links straight to `/admin/videos/<id>/edit`, where results
appear when the pipeline finishes. Publishing stays a human decision.

## Platform support

- **Android (Chrome, installed PWA):** the real share-sheet integration. Needs
  the app installed (Add to Home Screen); Chrome shows "Hakiya" as a share
  target for text, links, images, audio and video.
- **iOS:** Safari has no Web Share Target. Two fallbacks:
  - `/share?text=…&url=…` accepts query params, so an iOS **Shortcut** (Share
    Sheet → "Open URL" with `https://hakiya.app/share?text=[Shortcut Input]`)
    gives one-tap sharing of text and links.
  - `/share` opened empty shows a paste box and file-free chooser.
- **Desktop:** `/share` works as a paste-anything page.

Note the service worker only registers in production builds
(`src/lib/serviceWorker.ts`), so the share target is testable only on a
deployed build, not `npm run dev`.

## Sync hazards

- The cache name `hakiya-share-inbox` and the `/__share-inbox/*` entry paths
  are duplicated between `public/sw.js` (writer) and `src/lib/shareInbox.ts`
  (reader) — the SW is plain JS and can't import the module. Change them
  together.
- `share_target.params.files[0].name` in the manifest is `media`; the SW reads
  `formData.getAll('media')`. Change them together.
