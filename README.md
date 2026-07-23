# Hakiya — Learn Spoken Arabic

Hakiya is a web app for learning **spoken (dialectal) Arabic** — Gulf (Khaliji),
Egyptian, and Yemeni — with native audio, spaced-repetition flashcards, and
lessons built from real Arabic media. The emphasis throughout is on authentic
dialect, never Modern Standard Arabic (MSA / فصحى).

## Tech stack

- **Frontend:** Vite + React + TypeScript, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (Postgres + Row-Level Security, Auth, Edge Functions)
- **AI:** dialect-aware generation orchestrated through a shared "Brain"
  (`supabase/functions/_shared/aiBrain.ts`) that layers dialect identity, an
  MSA-leak detector, a repair pass, and an optional native-speaker validator on
  top of the underlying models. Model IDs are centralized in
  `supabase/functions/_shared/modelRegistry.ts` — do not hardcode them in
  feature code.

## Local development

Requires Node.js (or Bun) and the Supabase CLI for the backend.

```sh
# Install dependencies
npm install          # or: bun install

# Start the dev server
npm run dev
```

Copy `.env.example` to `.env` and fill in the client variables
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Server-side secrets for
the edge functions are configured in the Supabase dashboard, not committed.

## Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint the codebase |
| `npm test` | Run the Vitest suite |
| `npm run test:coverage` | Run tests with coverage |

## Project layout

- `src/` — React app (pages, components, hooks, domain logic in `src/lib`)
- `supabase/functions/` — Deno edge functions (AI, TTS/STT, billing, content)
- `supabase/functions/_shared/` — shared helpers (Brain, dialect rules, CORS,
  usage caps, model registry)
- `supabase/migrations/` — database schema and RLS policies
- `docs/` — planning notes and branding assets

## RBAC roles

Roles are assigned in `public.user_roles` (INSERT/UPDATE/DELETE restricted to
admins via RLS; users may only read their own role):

- `admin`: full access everywhere, including admin and Bible management.
- `content_reviewer`: can manage content workflows (transcripts / translations /
  cultural notes / dialect rules) but is blocked from Bible access.
- `beta_tester`: can access beta-only features.
- `bible_reader`: grants Bible reading access (except when the user is also
  `content_reviewer`).

## Deployment

The frontend is a static Vite build; the backend runs as Supabase Edge
Functions. Set `ALLOWED_ORIGINS` (comma-separated) as an edge-function secret to
restrict CORS to your production domain(s).
