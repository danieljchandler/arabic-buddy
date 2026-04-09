

# Souq News — Dialect News Feed

## What We're Building
A new "Souq News" feature where users get current news articles (last 24 hours) rewritten in their active dialect, as if a friend at the souq is telling them about what's happening. The content is accurate but written in authentic colloquial Arabic.

## Architecture

```text
┌─────────────┐      ┌──────────────────────┐      ┌──────────────┐
│  SouqNews   │─────▶│  souq-news (Edge Fn) │─────▶│  Firecrawl   │
│  Page (React)│      │                      │      │  Search API  │
│             │◀─────│  1. Search news       │      └──────────────┘
│  Shows 5    │      │  2. Rewrite in        │      ┌──────────────┐
│  dialect    │      │     dialect via        │─────▶│  Lovable AI  │
│  articles   │      │     Lovable AI         │      │  Gateway     │
└─────────────┘      └──────────────────────┘      └──────────────┘
```

## Plan

### 1. Create `souq-news` Edge Function
- Accepts `{ dialect, region }` from the client
- Uses **Firecrawl Search** (already connected) to find 5 recent news articles about the relevant region (Gulf/Egypt/Yemen) from the last 24 hours
- For each article, calls **Lovable AI** (Gemini 3 Flash) with a system prompt that instructs it to rewrite the headline and summary as souq gossip in the target dialect
- Returns an array of `{ title_dialect, body_dialect, title_english, summary_english, source_url, published_at }`

### 2. Create `src/pages/SouqNews.tsx`
- Pulls news on mount via `supabase.functions.invoke('souq-news')`
- Shows a list of cards with:
  - Arabic dialect headline and body (RTL)
  - English summary toggle
  - Source link
  - "Save words" tap interaction (reuse existing vocab save)
- Loading skeleton while fetching
- Refresh button to pull fresh articles
- Dialect-aware theming (teal/amber/red)

### 3. Add route and homepage entry
- Add `/souq-news` route in `App.tsx`
- Add a feature card on the Index page (e.g., newspaper icon, "أخبار السوق / Souq News")

### 4. Config
- Add `[functions.souq-news]` with `verify_jwt = false` to `supabase/config.toml`

## Technical Details
- **Firecrawl search** with `tbs: 'qdr:d'` for last-24-hour filtering, region-specific queries (e.g., "Saudi Arabia news today", "Egypt news today", "Yemen news today")
- **Lovable AI prompt** enforces dialect identity via shared `dialectHelpers.ts`, instructs the model to write as if gossiping at the souq — casual, animated, authentic dialect with no MSA
- No database tables needed — content is generated on-the-fly
- Handles 429/402 rate limit errors gracefully with user-facing toasts

