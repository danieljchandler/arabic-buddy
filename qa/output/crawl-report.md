# Live crawl report

Generated 2026-09-04T13:47:19.071Z — 126 route instances, 33 resilience runs, 2 media checks.

## Routes

| Route | Auth | Result | Load | Console err | Supabase failures | Controls (clicked / no-op / paid / unsafe) |
|---|---|---|---|---|---|---|
| `*` | anon | 404 (expected) | 1471ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/` | anon | empty state ("come back") | 2308ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/admin` | anon | → auth (gated) | 1705ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/bible-access` | anon | → auth (gated) | 1663ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/bible-lessons` | anon | → auth (gated) | 1671ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/channels` | anon | → auth (gated) | 1685ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/chunks` | anon | → auth (gated) | 1704ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/clips` | anon | → auth (gated) | 1657ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/coverage` | anon | → auth (gated) | 1675ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/curriculum` | anon | → auth (gated) | 1889ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/curriculum-builder` | anon | → auth (gated) | 1676ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/curriculum-builder/:sessionId` | anon | → auth (gated) | 1671ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/dialect-rules` | anon | → auth (gated) | 1703ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/errors` | anon | → auth (gated) | 1685ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/feedback` | anon | → auth (gated) | 1663ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/id-logins` | anon | → auth (gated) | 1671ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/invite-codes` | anon | → auth (gated) | 1658ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/lessons/:lessonId/words` | anon | → auth (gated) | 1661ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/lessons/import` | anon | → auth (gated) | 1725ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/login` | anon | ok (auth page) | 1830ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/memes` | anon | → auth (gated) | 1675ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/memes/:memeId` | anon | → auth (gated) | 1674ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/memes/new` | anon | → auth (gated) | 1671ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/metrics` | anon | → auth (gated) | 1667ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/reading-library` | anon | → auth (gated) | 1686ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/reading-library/:id/edit` | anon | → auth (gated) | 1676ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/reading-library/new` | anon | → auth (gated) | 1656ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/set-phrases` | anon | → auth (gated) | 1682ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/social-trends` | anon | → auth (gated) | 1679ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/stories` | anon | → auth (gated) | 1672ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/stories/:storyId/edit` | anon | → auth (gated) | 1667ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/stories/new` | anon | → auth (gated) | 1673ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics` | anon | → auth (gated) | 1684ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics/:topicId/edit` | anon | → auth (gated) | 1461ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics/:topicId/words` | anon | → auth (gated) | 1694ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics/:topicId/words/:wordId/edit` | anon | → auth (gated) | 1663ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics/:topicId/words/bulk` | anon | → auth (gated) | 1689ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics/:topicId/words/new` | anon | → auth (gated) | 1676ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/topics/new` | anon | → auth (gated) | 1699ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/transcribe` | anon | → auth (gated) | 1661ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/transcribe/:videoId` | anon | → auth (gated) | 1698ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/trending` | anon | → auth (gated) | 1670ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/videos` | anon | → auth (gated) | 1710ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/videos/:videoId/edit` | anon | → auth (gated) | 1681ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/admin/videos/new` | anon | → auth (gated) | 1681ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/alphabet` | anon | ok | 1462ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/alphabet/:letterCode` | anon | ok | 2313ms | 2 | 2 | 7 / 0 / 3 / 0 |
| `/alphabet/checkpoint/:index` | anon | → auth (gated) | 1682ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/alphabet/sounds` | anon | ok | 2098ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/analytics` | anon | → auth (gated) | 1673ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/auth` | anon | ok (auth page) | 1473ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/battles` | anon | → auth (gated) | 1674ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/battles/:battleId` | anon | → auth (gated) | 1666ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/bible` | anon | ok | 1914ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/bible/lessons` | anon | ok | 1469ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/bible/lessons/:lessonId` | anon | ok | 1884ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/bridge` | anon | ok | 1665ms | 0 | 0 | 8 / 1 / 14 / 0 |
| `/choose` | anon | ok | 1974ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/clips` | anon | → auth (gated) | 1661ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/conversation` | anon | ok | 1659ms | 0 | 0 | 5 / 0 / 1 / 0 |
| `/culture-guide` | anon | ok | 1465ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/curriculum` | anon | empty state ("No lessons yet") | 1876ms | 0 | 0 | 1 / 0 / 0 / 0 |
| `/daily-challenge` | anon | ok | 1491ms | 0 | 0 | 2 / 0 / 0 / 2 |
| `/dialect-compare` | anon | ok | 1462ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/discover` | anon | ok | 3679ms | 0 | 0 | 38 / 0 / 2 / 1 |
| `/discover/:videoId (tiktok)` | anon | ok | 3275ms | 13 | 14 | 12 / 0 / 2 / 2 |
| `/discover/:videoId (unknown id)` | anon | ok | 3080ms | 2 | 2 | 1 / 0 / 0 / 0 |
| `/discover/:videoId (youtube)` | anon | ok | 4112ms | 12 | 13 | 15 / 0 / 10 / 1 |
| `/friends` | anon | → auth (gated) | 1891ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/grammar` | anon | ok | 1473ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/how-do-i-say` | anon | ok | 1465ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/index` | anon | redirect → / | 2393ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/leaderboard` | anon | empty state ("No rankings yet") | 1868ms | 0 | 0 | 5 / 1 / 0 / 0 |
| `/learn` | anon | ok | 3306ms | 2 | 2 | 4 / 1 / 0 / 0 |
| `/learn-from-x` | anon | empty state ("get started") | 1686ms | 0 | 0 | 1 / 0 / 0 / 0 |
| `/learn-hub` | anon | redirect → /choose | 1901ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/learn/:lessonId (no lessons exist)` | anon | near-blank (see screenshot) | 3710ms | 2 | 2 | 0 / 0 / 0 / 0 |
| `/liked-videos` | anon | → auth (gated) | 1685ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/listen` | anon | → auth (gated) | 1668ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/listen/:id` | anon | → auth (gated) | 1662ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/listening` | anon | ok | 1474ms | 0 | 0 | 1 / 0 / 4 / 0 |
| `/login/id` | anon | ok | 1705ms | 0 | 0 | 3 / 1 / 0 / 0 |
| `/me` | anon | → auth (gated) | 1680ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/meme` | anon | ok | 1674ms | 0 | 0 | 1 / 0 / 1 / 0 |
| `/mistakes` | anon | → auth (gated) | 1662ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/monologue` | anon | → auth (gated) | 1712ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/my-transcriptions` | anon | → auth (gated) | 1664ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/my-words` | anon | → auth (gated) | 1668ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/native-feedback` | anon | → auth (gated) | 1664ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/onboarding` | anon | REDIRECTED TO AUTH (public route!) | 1666ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/placement` | anon | ok | 1680ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/placement/c-test` | anon | → auth (gated) | 1666ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/practice` | anon | redirect → /choose | 2157ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/pricing` | anon | empty state ("Get started") | 1470ms | 0 | 0 | 3 / 0 / 0 / 2 |
| `/privacy` | anon | ok | 1464ms | 0 | 0 | 1 / 0 / 0 / 0 |
| `/profile` | anon | → auth (gated) | 1728ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/pronunciation` | anon | ok | 1666ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/quiz/:lessonId (no lessons exist)` | anon | near-blank (see screenshot) | 3077ms | 2 | 2 | 0 / 0 / 0 / 0 |
| `/reading` | anon | ok | 1674ms | 0 | 0 | 3 / 0 / 1 / 0 |
| `/reading-library` | anon | ok | 1868ms | 0 | 0 | 2 / 0 / 0 / 0 |
| `/reading-library/:id` | anon | ok | 3682ms | 0 | 0 | 39 / 1 / 1 / 1 |
| `/reset-password` | anon | ok | 11702ms | 0 | 0 | 1 / 0 / 0 / 0 |
| `/review` | anon | → auth (gated) | 1676ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/review/my-phrases` | anon | → auth (gated) | 1664ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/review/my-words` | anon | → auth (gated) | 1670ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/saved-chats` | anon | → auth (gated) | 1666ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/set-phrases` | anon | ok | 1862ms | 0 | 0 | 20 / 0 / 1 / 0 |
| `/set-phrases/practice` | anon | empty state ("No phrases ready yet") | 2278ms | 1 | 1 | 0 / 0 / 0 / 0 |
| `/set-phrases/review` | anon | empty state ("No phrases ready yet") | 1872ms | 1 | 1 | 0 / 0 / 0 / 0 |
| `/settings` | anon | → auth (gated) | 1884ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/share` | anon | → auth (in-page gate) | 1670ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/share-target` | anon | → auth (in-page gate) | 1906ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/skills` | anon | redirect → /choose | 1943ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/skills/:skillId` | anon | ok | 1690ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/souq-news` | anon | ok | 1677ms | 0 | 0 | 4 / 0 / 0 / 0 |
| `/stories` | anon | ok | 1659ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/stories/:storyId` | anon | ok | 1889ms | 0 | 0 | 5 / 0 / 0 / 0 |
| `/terms` | anon | ok | 1490ms | 0 | 0 | 1 / 0 / 0 / 0 |
| `/today` | anon | empty state ("come back") | 3111ms | 1 | 1 | 3 / 0 / 0 / 0 |
| `/today/story` | anon | → auth (gated) | 1706ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/transcribe` | anon | → auth (gated) | 1715ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/translate` | anon | → auth (gated) | 1464ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/translate/saved` | anon | → auth (gated) | 1658ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/tutor-upload` | anon | → auth (gated) | 1703ms | 0 | 0 | 0 / 0 / 0 / 0 |
| `/vocab-games` | anon | ok | 1884ms | 0 | 0 | 3 / 0 / 0 / 0 |
| `/write` | anon | → auth (gated) | 1676ms | 0 | 0 | 0 / 0 / 0 / 0 |

## Page-level problems

- **/onboarding** — REDIRECTED TO AUTH (public route!) (final url `/auth`, headline "Welcome Back")

## Supabase failures (aggregated across load + interaction)

Phase = whether the failure happened while the page loaded (a bug the user hits by arriving) or during the click sweep (which also navigates away and back, so ERR_ABORTED there is usually the harness cancelling in-flight queries).

| Phase | Layer | Method | Target | Status | Count | Pages | Body |
|---|---|---|---|---|---|---|---|
| load | storage | POST | `object/sign/video-audio/*.wav` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| load | storage | POST | `object/sign/video-audio/*.mp4` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| load | storage | POST | `object/sign/video-audio/*.m4a` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| load | storage | POST | `object/sign/video-audio/*.webm` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| load | storage | POST | `object/sign/video-audio/*.mp3` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| load | storage | POST | `object/sign/video-audio/*.opus` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| load | rest | GET | `topics` | 406 | 4 | /learn/:lessonId (no lessons exist), /quiz/:lessonId (no lessons exist) | {"code":"PGRST116","details":"The result contains 0 rows","hint":null,"message":"Cannot coerce the result to a single JS |
| load | functions | POST | `tts-speak` | 401 | 2 | /alphabet/:letterCode, /learn | {"error":"auth_required","message":"Please sign in to use this feature."} |
| load | functions | POST | `azure-tts` | 401 | 2 | /alphabet/:letterCode, /learn | {"error":"auth_required","message":"Please sign in to use this feature."} |
| load | rest | HEAD | `video_likes` | NETFAIL | 2 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | net::ERR_ABORTED |
| load | rest | GET | `discover_videos` | 406 | 2 | /discover/:videoId (unknown id) | {"code":"PGRST116","details":"The result contains 0 rows","hint":null,"message":"Cannot coerce the result to a single JS |
| load | functions | POST | `generate-set-phrase-quiz` | 401 | 2 | /set-phrases/practice, /set-phrases/review | {"error":"unauthenticated"} |
| load | functions | POST | `convert-to-fusha` | 401 | 1 | /discover/:videoId (tiktok) | {"error":"auth_required","message":"Please sign in to use this feature."} |
| load | functions | POST | `phrase-of-the-day` | 401 | 1 | /today | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | storage | POST | `object/sign/video-audio/*.wav` | 400 | 44 | /discover, /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| interaction | rest | HEAD | `video_likes` | NETFAIL | 35 | /discover, /discover/:videoId (tiktok), /discover/:videoId (youtube) | net::ERR_ABORTED |
| interaction | functions | POST | `word-enrichment` | 401 | 28 | /reading-library/:id | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | storage | POST | `object/sign/video-audio/*.mp4` | NETFAIL | 23 | /discover | net::ERR_ABORTED |
| interaction | storage | POST | `object/sign/video-audio/*.mp4` | 400 | 21 | /discover, /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| interaction | storage | POST | `object/sign/video-audio/*.m4a` | NETFAIL | 16 | /discover | net::ERR_ABORTED |
| interaction | functions | POST | `translate-phrase` | 401 | 13 | /discover/:videoId (youtube) | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `generate-set-phrase-quiz` | 401 | 12 | /set-phrases | {"error":"unauthenticated"} |
| interaction | storage | POST | `object/sign/video-audio/*.wav` | NETFAIL | 8 | /discover | net::ERR_ABORTED |
| interaction | functions | POST | `tts-speak` | 401 | 7 | /alphabet, /alphabet/:letterCode, /alphabet/sounds, /learn | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `azure-tts` | 401 | 6 | /alphabet/:letterCode, /alphabet/sounds, /learn | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | storage | POST | `object/sign/video-audio/*.m4a` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| interaction | storage | POST | `object/sign/video-audio/*.webm` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| interaction | storage | POST | `object/sign/video-audio/*.mp3` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| interaction | storage | POST | `object/sign/video-audio/*.opus` | 400 | 4 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} |
| interaction | functions | POST | `phrase-of-the-day` | 401 | 3 | /today | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | rest | GET | `discover_videos` | NETFAIL | 2 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | net::ERR_ABORTED |
| interaction | functions | POST | `convert-to-fusha` | 401 | 2 | /discover/:videoId (tiktok), /discover/:videoId (youtube) | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | rest | GET | `discover_videos` | 406 | 2 | /discover/:videoId (unknown id) | {"code":"PGRST116","details":"The result contains 0 rows","hint":null,"message":"Cannot coerce the result to a single JS |
| interaction | functions | POST | `azure-tts` | NETFAIL | 1 | /alphabet | net::ERR_ABORTED |
| interaction | functions | POST | `free-chat` | 401 | 1 | /conversation | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `dialect-compare` | 401 | 1 | /dialect-compare | {"error":"auth_required","message":"Please sign in to use this feature."} |
| interaction | functions | POST | `placement-quiz` | NETFAIL | 1 | /placement | net::ERR_ABORTED |
| interaction | functions | POST | `generate-set-phrase-quiz` | NETFAIL | 1 | /set-phrases | net::ERR_ABORTED |
| interaction | functions | POST | `souq-news` | 401 | 1 | /souq-news | {"error":"auth_required","message":"Please sign in to use this feature."} |

## External / asset failures

- youtube NETFAIL `https://i.ytimg.com/vi/dnkn65mKkm4/maxresdefault.jpg` ×836 (/discover)
- tiktok NETFAIL `https://p16-common-sign.tiktokcdn.com/tos-alisg-p-0037/owPGQiURGE895rDXBpgFncfMQfo7qOEBrCGqnA~tplv-tiktokx-ori` ×238 (/discover)
- tiktok NETFAIL `https://p19-common-sign.tiktokcdn.com/tos-alisg-p-0037/ooiYqBQouHDogqAOQcxEBSGFKUF9RRFECF1Iff~tplv-tiktokx-ori` ×34 (/discover)
- tiktok NETFAIL `https://www.tiktok.com/player/v1/7460257124258516231` ×34 (/discover, /discover/:videoId (tiktok))
- youtube NETFAIL `https://www.youtube.com/iframe_api` ×20 (/discover, /discover/:videoId (youtube))
- app NETFAIL `http://127.0.0.1:4173/assets/campfire-hero.webm` ×1 (/discover)

## Console / page error signatures

- ×124 (2 pages) `Failed to load resource: net::ERR_CONNECTION_RESET`
- ×105 (3 pages) `Failed to load resource: the server responded with a status of 400 (Bad Request)`
- ×82 (14 pages) `Failed to load resource: the server responded with a status of 401 (Unauthorized)`
- ×8 (3 pages) `Failed to load resource: the server responded with a status of 406 (Not Acceptable)`

## Controls that did nothing when clicked (no navigation, no DOM change, no request)

- `/bridge`: "I don't know MSA"
- `/leaderboard`: "This Week"
- `/learn`: "lucide-volume2"
- `/login/id`: "Sign in"
- `/reading-library/:id`: "(unlabeled)"

## Controls that could not be clicked

- `/alphabet/:letterCode`: "Fusha (MSA) pronunciation" (locator.click: Timeout 3000ms exceeded.); "Gulf pronunciation" (locator.click: Timeout 3000ms exceeded.); "Skip" (locator.click: Timeout 3000ms exceeded.)
- `/alphabet/sounds`: "Practise ط versus ت" (locator.click: Timeout 3000ms exceeded.); "Practise ض versus د" (locator.click: Timeout 3000ms exceeded.); "Practise ق versus ك" (locator.click: Timeout 3000ms exceeded.); "Practise ح versus ه" (locator.click: Timeout 3000ms exceeded.); "Practise ع versus ء" (locator.click: Timeout 3000ms exceeded.); "Practise غ versus خ" (locator.click: Timeout 3000ms exceeded.); "Practise ث versus س" (locator.click: Timeout 3000ms exceeded.); "Practise ذ versus ز" (locator.click: Timeout 3000ms exceeded.)
- `/conversation`: "Coffee ☕" (locator.click: Timeout 3000ms exceeded.); "Family 👨‍👩‍👧" (locator.click: Timeout 3000ms exceeded.); "Work 💼" (locator.click: Timeout 3000ms exceeded.); "Travel ✈️" (locator.click: Timeout 3000ms exceeded.); "Food 🍽️" (locator.click: Timeout 3000ms exceeded.)
- `/dialect-compare`: "شكراً(Thank you)" (locator.click: Timeout 3000ms exceeded.); "ماذا(What)" (locator.click: Timeout 3000ms exceeded.); "أريد(I want)" (locator.click: Timeout 3000ms exceeded.); "جميل(Beautiful)" (locator.click: Timeout 3000ms exceeded.); "الآن(Now)" (locator.click: Timeout 3000ms exceeded.)
- `/discover/:videoId (tiktok)`: "سيدي" (locator.click: Timeout 3000ms exceeded.); "جابر." (locator.click: Timeout 3000ms exceeded.); "أنا" (locator.click: Timeout 3000ms exceeded.); "هقول" (locator.click: Timeout 3000ms exceeded.); "لك" (locator.click: Timeout 3000ms exceeded.); "سيدا،" (locator.click: Timeout 3000ms exceeded.); "إيش" (locator.click: Timeout 3000ms exceeded.); "دخل" (locator.click: Timeout 3000ms exceeded.); "سيدي" (locator.click: Timeout 3000ms exceeded.); "جابر" (locator.click: Timeout 3000ms exceeded.); "يا" (locator.click: Timeout 3000ms exceeded.); "أخي؟" (locator.click: Timeout 3000ms exceeded.); "Next line" (locator.click: Timeout 3000ms exceeded.); "سيدا، سيدا. إحنا عندنا هنا سيدي جابر. أنا هقول لك سيدا، إيش " (locator.click: Timeout 3000ms exceeded.); "سيدا،" (locator.click: Timeout 3000ms exceeded.); "سيدا." (locator.click: Timeout 3000ms exceeded.); "إحنا" (locator.click: Timeout 3000ms exceeded.); "عندنا" (locator.click: Timeout 3000ms exceeded.); "هنا" (locator.click: Timeout 3000ms exceeded.); "سيدي" (locator.click: Timeout 3000ms exceeded.); "جابر." (locator.click: Timeout 3000ms exceeded.); "أنا" (locator.click: Timeout 3000ms exceeded.); "هقول" (locator.click: Timeout 3000ms exceeded.); "لك" (locator.click: Timeout 3000ms exceeded.); "سيدا،" (locator.click: Timeout 3000ms exceeded.)
- `/discover/:videoId (unknown id)`: "Browse clips" (locator.click: Timeout 3000ms exceeded.)
- `/discover/:videoId (youtube)`: "آه" (locator.click: Timeout 3000ms exceeded.); "مو" (locator.click: Timeout 3000ms exceeded.); "لشيء،" (locator.click: Timeout 3000ms exceeded.); "بس" (locator.click: Timeout 3000ms exceeded.); "أهلي" (locator.click: Timeout 3000ms exceeded.); "كانوا" (locator.click: Timeout 3000ms exceeded.); "يطلقوا." (locator.click: Timeout 3000ms exceeded.); "عادي" (locator.click: Timeout 3000ms exceeded.); "كذا؟" (locator.click: Timeout 3000ms exceeded.); "في" (locator.click: Timeout 3000ms exceeded.); "شيء؟" (locator.click: Timeout 3000ms exceeded.); "أنا" (locator.click: Timeout 3000ms exceeded.); "صراحة" (locator.click: Timeout 3000ms exceeded.); "قلت" (locator.click: Timeout 3000ms exceeded.); "لك" (locator.click: Timeout 3000ms exceeded.)
- `/reset-password`: "Back to sign in" (locator.click: Timeout 3000ms exceeded.)
- `/stories/:storyId`: "Show translation" (locator.click: Timeout 3000ms exceeded.)
- `/vocab-games`: "Memory CardsFlip and find matching Arabic-English pairs" (locator.click: Timeout 3000ms exceeded.); "Fill in the BlankType the English meaning from Arabic" (locator.click: Timeout 3000ms exceeded.)

## Paid-pipeline controls (not exercised — needs live API test)

- "Step 2: Hear & see" on /alphabet/:letterCode
- "Ask AI" on /alphabet/:letterCode, /discover/:videoId (tiktok), /discover/:videoId (youtube), /reading-library/:id
- "I've heard it" on /alphabet/:letterCode
- "Ask AI about this sentence" on /bridge
- "Real-time voice call with the tutor" on /conversation
- "Request content — suggest a video, creator, or topic" on /discover
- "Video: Bro, I'm a bit embarrassed to ask, but I need to talk" on /discover
- "lucide-heart" on /discover/:videoId (tiktok), /discover/:videoId (youtube)
- "Practice shadowing" on /discover/:videoId (youtube)
- "آه مو لشيء، بس أهلي كانوا يطلقوا.Ask AIPractice shadowingOh," on /discover/:videoId (youtube)
- "عادي كذا؟ في شيء؟Ask AIPractice shadowingIs it okay like thi" on /discover/:videoId (youtube)
- "أنا صراحة قلت لك أبغى ماتشا.Ask AIPractice shadowingHonestly" on /discover/:videoId (youtube)
- "Learn about Listening Practice" on /listening
- "DictationListen and type what you hear" on /listening
- "ComprehensionAnswer questions about what you hear" on /listening
- "Speed DrillFast-paced listening at variable speeds" on /listening
- "Learn about Meme Analyzer" on /meme
- "Ask AnythingAsk questions on any topic and get answers in Gu" on /reading
- "Generate phrases" on /set-phrases

## Links to unrouted paths (possible dead links)

- `blank` from /placement via "Go Back"

## Resilience (Supabase slow / down)

| Route | backend-500 | network-drop | slow-4s |
|---|---|---|---|
| `/` | silent-empty | silent-empty | silent-empty |
| `/alphabet` | looks-normal | looks-normal | looks-normal |
| `/choose` | looks-normal | looks-normal | looks-normal |
| `/curriculum` | silent-empty | silent-empty | silent-empty |
| `/daily-challenge` | looks-normal | looks-normal | looks-normal |
| `/discover` | silent-empty | silent-empty | looks-normal |
| `/leaderboard` | silent-empty | silent-empty | silent-empty |
| `/pricing` | silent-empty | silent-empty | silent-empty |
| `/set-phrases` | silent-empty | silent-empty | looks-normal |
| `/stories` | silent-empty | silent-empty | looks-normal |
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