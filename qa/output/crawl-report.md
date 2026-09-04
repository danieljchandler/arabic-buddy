# Live crawl report

Generated 2026-09-04T15:40:28.495Z — 15 route instances, 33 resilience runs, 2 media checks.

## Routes

| Route | Auth | Result | Load | Console err | Supabase failures | Controls (clicked / no-op / paid / unsafe) |
|---|---|---|---|---|---|---|
| `/` | anon | empty state ("come back") | 2379ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/alphabet/:letterCode` | anon | ok | 2279ms | 2 | 2 | 7 / 0 / 3 / 0 |
| `/bridge` | anon | ok | 1678ms | 0 | 0 | 8 / 1 / 14 / 0 |
| `/curriculum` | anon | empty state ("No lessons yet") | 1665ms | 0 | 0 | 1 / 0 / 0 / 0 |
| `/discover/:videoId (tiktok)` | anon | ok | 2268ms | 0 | 1 | 13 / 0 / 1 / 2 |
| `/discover/:videoId (unknown id)` | anon | ok | 3289ms | 2 | 2 | 1 / 0 / 0 / 0 |
| `/discover/:videoId (youtube)` | anon | ok | 2073ms | 0 | 1 | 16 / 0 / 9 / 1 |
| `/leaderboard` | anon | empty state ("No rankings yet") | 2407ms | 0 | 0 | 5 / 1 / 0 / 0 |
| `/placement` | anon | ok | 1482ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/reading-library/:id` | anon | ok | 2490ms | 0 | 0 | 39 / 1 / 1 / 1 |
| `/set-phrases` | anon | ok | 1893ms | 0 | 0 | 20 / 0 / 1 / 0 |
| `/set-phrases/practice` | anon | ok | 1484ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/set-phrases/review` | anon | ok | 1472ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/stories` | anon | ok | 1659ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/today` | anon | empty state ("come back") | 3460ms | 0 | 0 | 3 / 0 / 0 / 0 |

## Page-level problems

None.

## Supabase failures (aggregated across load + interaction)

Phase = whether the failure happened while the page loaded (a bug the user hits by arriving) or during the click sweep (which also navigates away and back, so ERR_ABORTED there is usually the harness cancelling in-flight queries).

| Phase | Layer | Method | Target | Status | Count | Pages | Body |
|---|---|---|---|---|---|---|---|
| load | rest | HEAD | `video_likes` | NETFAIL | 2 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | net::ERR_ABORTED |
| load | rest | GET | `discover_videos` | 406 | 2 | /discover/:videoId (unknown id) | {"code":"PGRST116","details":"The result contains 0 rows","hint":null,"message":"Cannot coerce the result to a single JS |
| load | functions | POST | `tts-speak` | 401 | 1 | /alphabet/:letterCode | {"error":"auth_required","message":"Please sign in to use this feature."} |
| load | functions | POST | `azure-tts` | 401 | 1 | /alphabet/:letterCode | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `word-enrichment` | 401 | 28 | /reading-library/:id | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `translate-phrase` | 401 | 14 | /discover/:videoId (youtube) | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `tts-speak` | 401 | 3 | /alphabet/:letterCode | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `azure-tts` | 401 | 3 | /alphabet/:letterCode | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | rest | GET | `discover_videos` | NETFAIL | 2 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | net::ERR_ABORTED |
| interaction | rest | HEAD | `video_likes` | NETFAIL | 2 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | net::ERR_ABORTED |
| interaction | rest | GET | `discover_videos` | 406 | 2 | /discover/:videoId (unknown id) | {"code":"PGRST116","details":"The result contains 0 rows","hint":null,"message":"Cannot coerce the result to a single JS |
| interaction | functions | POST | `placement-quiz` | NETFAIL | 1 | /placement | net::ERR_ABORTED |
| interaction | storage | GET | `object/public/listen-audio/*.png` | NETFAIL | 1 | /reading-library/:id | net::ERR_ABORTED |

## External / asset failures

- tiktok NETFAIL `https://www.tiktok.com/player/v1/7654509704722320660` ×4 (/discover/:videoId (tiktok))
- youtube NETFAIL `https://www.youtube.com/iframe_api` ×2 (/discover/:videoId (youtube))

## Console / page error signatures

- ×50 (3 pages) `Failed to load resource: the server responded with a status of 401 (Unauthorized)`
- ×4 (1 pages) `Failed to load resource: the server responded with a status of 406 (Not Acceptable)`
- ×1 (1 pages) `Failed to load resource: net::ERR_CONNECTION_RESET`

## Controls that did nothing when clicked (no navigation, no DOM change, no request)

- `/bridge`: "I don't know MSA"
- `/leaderboard`: "This Week"
- `/reading-library/:id`: "(unlabeled)"

## Controls that could not be clicked

- `/alphabet/:letterCode`: "Fusha (MSA) pronunciation" (locator.click: Timeout 8000ms exceeded.); "Gulf pronunciation" (locator.click: Timeout 8000ms exceeded.); "Skip" (locator.click: Timeout 8000ms exceeded.)
- `/discover/:videoId (tiktok)`: "سيدي" (locator.click: Timeout 8000ms exceeded.); "جابر." (locator.click: Timeout 8000ms exceeded.); "أنا" (locator.click: Timeout 8000ms exceeded.); "هقول" (locator.click: Timeout 8000ms exceeded.); "لك" (locator.click: Timeout 8000ms exceeded.); "سيدا،" (locator.click: Timeout 8000ms exceeded.); "إيش" (locator.click: Timeout 8000ms exceeded.); "دخل" (locator.click: Timeout 8000ms exceeded.); "سيدي" (locator.click: Timeout 8000ms exceeded.); "جابر" (locator.click: Timeout 8000ms exceeded.); "يا" (locator.click: Timeout 8000ms exceeded.); "أخي؟" (locator.click: Timeout 8000ms exceeded.); "Next line" (locator.click: Timeout 8000ms exceeded.); "سيدا، سيدا. إحنا عندنا هنا سيدي جابر. أنا هقول لك سيدا، إيش " (locator.click: Timeout 8000ms exceeded.); "سيدا،" (locator.click: Timeout 8000ms exceeded.); "سيدا." (locator.click: Timeout 8000ms exceeded.); "إحنا" (locator.click: Timeout 8000ms exceeded.); "عندنا" (locator.click: Timeout 8000ms exceeded.); "هنا" (locator.click: Timeout 8000ms exceeded.); "سيدي" (locator.click: Timeout 8000ms exceeded.); "جابر." (locator.click: Timeout 8000ms exceeded.); "أنا" (locator.click: Timeout 8000ms exceeded.); "هقول" (locator.click: Timeout 8000ms exceeded.); "لك" (locator.click: Timeout 8000ms exceeded.); "سيدا،" (locator.click: Timeout 8000ms exceeded.)
- `/discover/:videoId (unknown id)`: "Browse clips" (locator.click: Timeout 8000ms exceeded.)
- `/discover/:videoId (youtube)`: "آه" (locator.click: Timeout 8000ms exceeded.); "مو" (locator.click: Timeout 8000ms exceeded.); "لشيء،" (locator.click: Timeout 8000ms exceeded.); "بس" (locator.click: Timeout 8000ms exceeded.); "أهلي" (locator.click: Timeout 8000ms exceeded.); "كانوا" (locator.click: Timeout 8000ms exceeded.); "يطلقوا." (locator.click: Timeout 8000ms exceeded.); "عادي" (locator.click: Timeout 8000ms exceeded.); "كذا؟" (locator.click: Timeout 8000ms exceeded.); "في" (locator.click: Timeout 8000ms exceeded.); "شيء؟" (locator.click: Timeout 8000ms exceeded.); "أنا" (locator.click: Timeout 8000ms exceeded.); "صراحة" (locator.click: Timeout 8000ms exceeded.); "قلت" (locator.click: Timeout 8000ms exceeded.); "لك" (locator.click: Timeout 8000ms exceeded.)

## Paid-pipeline controls (not exercised — needs live API test)

- "Step 2: Hear & see" on /alphabet/:letterCode
- "Ask AI" on /alphabet/:letterCode, /discover/:videoId (tiktok), /discover/:videoId (youtube), /reading-library/:id
- "I've heard it" on /alphabet/:letterCode
- "Ask AI about this sentence" on /bridge
- "Practice shadowing" on /discover/:videoId (youtube)
- "آه مو لشيء، بس أهلي كانوا يطلقوا.Ask AIPractice shadowingOh," on /discover/:videoId (youtube)
- "عادي كذا؟ في شيء؟Ask AIPractice shadowingIs it okay like thi" on /discover/:videoId (youtube)
- "أنا صراحة قلت لك أبغى ماتشا.Ask AIPractice shadowingHonestly" on /discover/:videoId (youtube)
- "Generate phrases" on /set-phrases

## Links to unrouted paths (possible dead links)

- `blank` from /placement via "Go Back"

## Resilience (Supabase slow / down)

| Route | backend-500 | network-drop | slow-4s |
|---|---|---|---|
| `/` | silent-empty | silent-empty | silent-empty |
| `/alphabet` | looks-normal | looks-normal | looks-normal |
| `/choose` | looks-normal | looks-normal | looks-normal |
| `/curriculum` | error-shown | error-shown | silent-empty |
| `/daily-challenge` | looks-normal | looks-normal | looks-normal |
| `/discover` | error-shown | error-shown | looks-normal |
| `/leaderboard` | error-shown | error-shown | silent-empty |
| `/pricing` | silent-empty | silent-empty | silent-empty |
| `/set-phrases` | error-shown | error-shown | looks-normal |
| `/stories` | error-shown | error-shown | looks-normal |
| `/today` | silent-empty | silent-empty | silent-empty |

## Media

```json
{
 "video": {
  "id": "f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a",
  "platform": "tiktok",
  "source_url": "https://vt.tiktok.com/ZSXmFWLTx/",
  "thumbnail_url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/public/flashcard-images/tiktok-thumbs/049dbfa9-4a15-4d39-9ab8-f99690394a9e.jpg"
 },
 "timing": {
  "lines": 11,
  "withLineTiming": 11,
  "withWordTiming": 0,
  "monotonic": true
 },
 "state": {
  "finalUrl": "http://127.0.0.1:4173/discover/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a",
  "path": "/discover/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a",
  "title": "Hakiya — Learn Spoken Arabic: Gulf, Egyptian & Yemeni",
  "bodyChars": 2764,
  "bodyText": "Back Kuwaiti Intermediate سيدا، سيدا. إحنا عندنا هنا سيدي جابر. أنا هقول لك سيدا، إيش يا أخي لخبطني Start subtitle sync Reset 0s سيدا، سيدا. إحنا عندنا هنا سيدي",
  "notFoundText": false,
  "is404": false,
  "spinnerVisible": false,
  "errorBoundary": false,
  "errorTextVisible": false,
  "emptyStateText": null,
  "headline": "سيدا، سيدا. إحنا عندنا هنا سيدي جابر. أنا هقول لك سيدا، إيش",
  "isBlank": false,
  "redirectedToAuth": false
 },
 "media": {
  "iframes": [
   {
    "src": "https://www.tiktok.com/player/v1/7654509704722320660?autoplay=1&muted=1&music_info=0&description=0&rel=0",
    "w": 420,
    "h": 512
   }
  ],
  "videos": [],
  "audios": [],
  "transcriptLinesRendered": 0,
  "rtlBlocks": 24,
  "playControls": []
 },
 "playAttempt": null,
 "tts": {
  "status": "needs live API test",
  "control": null
 },
 "storageFailures": [
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.wav",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.wav",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.wav",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.wav",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.mp4",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.mp4",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.mp4",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.mp4",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.m4a",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/f6b9c84f-6244-46b3-ab4d-9d73dbd3b83a.m4a",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKe
```
```json
{
 "video": {
  "id": "848dfb0c-f828-4c87-8690-a4e4b6de58e1",
  "platform": "youtube",
  "source_url": "https://youtube.com/shorts/kTKcSSW6NZw?si=jWpwNiz6jmYIsLs-",
  "thumbnail_url": "https://img.youtube.com/vi/kTKcSSW6NZw/hqdefault.jpg"
 },
 "timing": {
  "lines": 12,
  "withLineTiming": 11,
  "withWordTiming": 0,
  "monotonic": true
 },
 "state": {
  "finalUrl": "http://127.0.0.1:4173/discover/848dfb0c-f828-4c87-8690-a4e4b6de58e1",
  "path": "/discover/848dfb0c-f828-4c87-8690-a4e4b6de58e1",
  "title": "Hakiya — Learn Spoken Arabic: Gulf, Egyptian & Yemeni",
  "bodyChars": 1850,
  "bodyText": "Back Saudi Intermediate Honestly, I told you I wanted a matcha. أنا صراحة قلت لك أبغى ماتشا. آه مو لشيء، بس أهلي كانوا يطلقوا. Ask AI Practice shadowing 1 / 12 ",
  "notFoundText": false,
  "is404": false,
  "spinnerVisible": false,
  "errorBoundary": false,
  "errorTextVisible": false,
  "emptyStateText": null,
  "headline": "Honestly, I told you I wanted a matcha.",
  "isBlank": false,
  "redirectedToAuth": false
 },
 "media": {
  "iframes": [],
  "videos": [],
  "audios": [],
  "transcriptLinesRendered": 0,
  "rtlBlocks": 25,
  "playControls": [
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing",
   "Practice shadowing"
  ]
 },
 "playAttempt": null,
 "tts": {
  "status": "needs live API test",
  "control": null
 },
 "storageFailures": [
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.wav",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.wav",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.mp4",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.mp4",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.m4a",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.m4a",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.webm",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.webm",
   "body": "{\"statusCode\":\"404\",\"error\":\"not_found\",\"message\":\"Object not found\",\"code\":\"NoSuchKey\"}"
  },
  {
   "url": "https://ovscskaijvclaxelkdyf.supabase.co/storage/v1/object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.mp3",
   "method": "POST",
   "status": 400,
   "layer": "storage",
   "target": "object/sign/video-audio/848dfb0c-f828-4c87-8690-a4e4b6de58e1.mp3",
   "body": "{\"statusCode\":\"404\",\"error\"
```