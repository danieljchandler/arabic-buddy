# Deploying outside Lovable

This app is a static Vite SPA plus a Supabase project (Postgres + RLS, Auth,
Deno edge functions). Nothing about the backend changes when hosting moves —
only where the built `dist/` is served from, and a handful of URL-shaped
settings that name the frontend's origin.

Host configs in the repo:

| Host | Files | SPA fallback |
| --- | --- | --- |
| Vercel | `vercel.json` | `rewrites` → `/index.html` |
| Netlify | `netlify.toml` (+ `public/_headers`) | `[[redirects]]` 200 |
| Cloudflare Pages | `public/_redirects` (+ `public/_headers`) | `/* /index.html 200` |

Build command `npm run build`, output directory `dist`, Node 20.

## 1. Frontend environment variables

`vite.config.ts` deliberately points `envDir` at an empty `.vite-env/` directory
(Lovable Cloud rewrites the root `.env` and would restart the dev server), so
the client variables are injected from `process.env` at build time via `define`.
It also carries **hardcoded fallbacks** for the Supabase URL / project id /
publishable key. Those fallbacks exist so the Lovable preview never crashes on
late env injection — they are not a deployment strategy. A build that relies on
them is silently pinned to the current production project.

Set all three explicitly on the new host:

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | `https://<project-id>.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | yes | the bare project ref |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | the anon/publishable key. Public by design — RLS is what protects data. Never the `service_role` key. |
| `VITE_VAPID_PUBLIC_KEY` | no | web push. Unset → the Settings push toggle hides itself. Private half is an edge secret (below). |
| `VITE_POSTHOG_KEY` | no | analytics no-ops when unset |
| `VITE_POSTHOG_HOST` | no | e.g. `https://us.i.posthog.com` |

`vite.config.ts` also accepts the unprefixed aliases (`SUPABASE_URL`,
`SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY`), which
is useful on hosts that inject a Supabase integration's own names.

Verified locally: with the three variables supplied explicitly,
`npm run build` completes and the built bundle contains those values rather than
the fallbacks.

One leftover is *not* env-driven — `index.html` hardcodes the current project
ref in a `preconnect` / `dns-prefetch` hint. It is only a latency hint and
breaks nothing, but if the Supabase project ever changes, update those two lines
too or the browser warms a connection to a host it never uses.

```sh
VITE_SUPABASE_URL="https://<ref>.supabase.co" \
VITE_SUPABASE_PROJECT_ID="<ref>" \
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key>" \
npm run build
```

## 2. Edge function secrets

Set with `supabase secrets set KEY=value` (or the project's secret manager).
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
by the runtime and must not be set by hand.

**Required for the app to function**

| Secret | Used by |
| --- | --- |
| `ALLOWED_ORIGINS` | `_shared/cors.ts` — comma-separated allow-list of frontend origins. See §3. |
| `OPENROUTER_API_KEY` | `_shared/aiGateway.ts` — default provider *and* the fallback for every other vendor |
| `GEMINI_API_KEY` | `google/*` model ids (also Lyria jingles, image generation) |
| `OPENAI_API_KEY` | `openai/*` ids and the realtime voice call |
| `FANAR_API_KEY` | `Fanar-*` ids (QCRI; no OpenRouter twin, so no fallback) |
| `STRIPE_SECRET_KEY` | `create-checkout`, `check-subscription`, `customer-portal` |

There is no Lovable AI gateway key any more: every model call goes through
`_shared/aiGateway.ts`, which picks a provider off the model id's vendor prefix.

**Speech / audio**

`MUNSIT_API_KEY` (primary ASR + Gulf TTS), `AZURE_SPEECH_KEY`,
`AZURE_SPEECH_REGION` / `AZURE_SPEECH_ENDPOINT`, `ELEVENLABS_API_KEY`,
`SONIOX_API_KEY`, `DEEPGRAM_API_KEY`, `COHERE_API_KEY`. Optional tuning pins:
`MUNSIT_ASR_MODEL`, `MUNSIT_TTS_MODEL_ID`,
`MUNSIT_{GULF,EGYPTIAN,YEMENI,MSA}_VOICE_IDS`, `MUNSIT_GULF_VOICE_ID`,
`TTS_PROVIDER_{GULF,EGYPTIAN,YEMENI,MSA}`,
`TTS_ALLOW_SINGLE_VOICE_EPISODES`, `ELEVENLABS_TTS_MODEL`,
`ELEVENLABS_STT_MODEL`, `COHERE_STT_MODEL`, `REALTIME_VOICE_YEMENI`.

**NLP / content / media**

`FARASA_API_KEY` (required for tashkeel — the WebAPI refuses anonymous
traffic), `HUGGINGFACE_API_KEY` (CAMeL dialect ID), `JINA_API_KEY`,
`FIRECRAWL_API_KEY`, `YOUTUBE_API_KEY`, `RAPIDAPI_KEY`, `COBALT_API_KEY`,
`DIALECT_VALIDATOR_CROSSCHECK`.

**Push and internal jobs**

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`SOCIAL_HARVEST_SECRET`.

`.env.example` stays the canonical, commented list — it explains *why* several
of these exist. This table is the deployment checklist, not a replacement.

## 3. What must change when the domain changes

Three settings name the frontend's origin. Miss one and the failure is
confusing rather than loud: sign-in bounces to the old domain, or every edge
function call fails CORS preflight while the functions themselves look healthy.

1. **`ALLOWED_ORIGINS` edge secret** — comma-separated, no trailing slashes,
   scheme included. `_shared/cors.ts` mirrors `Origin` only when it matches, and
   omits `Access-Control-Allow-Origin` otherwise, so the browser blocks the
   response. The **first entry is treated as the canonical origin**
   (`getProductionOrigin()`) and is what Stripe return URLs and email links use
   — put the real production domain first.
   ```
   ALLOWED_ORIGINS=https://<new-domain>,https://<old-domain-while-migrating>
   ```
   Unset, the built-in default list applies, which still names the old domains.
2. **Auth → URL Configuration → Site URL** — set to the new origin. This is the
   base for password-reset and confirmation links.
3. **Auth → URL Configuration → Redirect URLs** — add
   `https://<new-domain>/**`, plus the OAuth callback the Google button lands
   on. "Continue with Google" calls
   `supabase.auth.signInWithOAuth({ provider: "google" })`, whose
   `redirectTo` must be a same-origin public URL; a redirect URL not on this
   allow-list silently sends the user to Site URL instead.
4. **Google Cloud console → the OAuth 2.0 client** — the *Authorized redirect
   URI* stays the Supabase callback (`https://<ref>.supabase.co/auth/v1/callback`)
   and does not change with the frontend domain. Add the new domain under
   *Authorized JavaScript origins*.

Cut over both domains at once where possible: keep the old origin in
`ALLOWED_ORIGINS` and the redirect allow-list until DNS has fully moved, then
remove it.

## 4. Still Lovable-only

These are inert in production and serve only the Lovable editor. They come out
in the same change that finally switches the Lovable project off:
`componentTagger` in `vite.config.ts`, the `ALLOW_PREVIEW_ORIGINS` branch in
`_shared/cors.ts` (leave that secret **unset** on any non-preview project — it
whitelists every `*.lovable.app` subdomain), and
`src/integrations/supabase/previewAuthStorage.ts`.
