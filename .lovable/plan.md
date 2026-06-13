# Filter flashcards by source

Add a top-level **Source** filter row on `/my-words`, above the existing Decks and Tags chips, so users can scope cards to where they came from. Pure frontend change to `src/pages/MyWords.tsx` — no schema or hook changes (every card already has a `source` field).

## UI

New chip row at the top of the existing filter block:

```text
Source:  [All]  [📥 Anki · 1728]  [✨ App · 138]
```

- **All** — clears source/category/deck filters.
- **Anki** — keeps the existing Decks row visible (decks only make sense for Anki cards). Hides Category row.
- **App** — shows a new Category chip row instead of Decks, built from `source` values that aren't `anki_import`:

```text
Category:  [All]  [🎬 Videos · 8]  [🎙 Podcast/Listen · N]  [📰 Souq News · 3]
           [📖 Bible · 6]  [📚 Reading · 3]  [📔 Stories · 4]
           [🔍 Discover · 3]  [🎯 Tutor Upload · 99]  [🖼 Picture Scenes · 10]
           [💬 Chat · 1]  [❓ How do I say · 1]
```

Tags row stays visible in all modes.

## Source → Category label map

Built once at the top of `MyWords.tsx`:

| `source` value      | Label              | Group |
| ------------------- | ------------------ | ----- |
| `anki_import`       | Anki               | anki  |
| `transcription`    | Videos             | app   |
| `listen` / `podcast`| Podcast            | app   |
| `souq-news`         | Souq News          | app   |
| `bible`             | Bible              | app   |
| `reading-practice`  | Reading            | app   |
| `daily-story`       | Stories            | app   |
| `discover`          | Discover           | app   |
| `tutor-upload`      | Tutor Upload       | app   |
| `picture_scene`     | Picture Scenes     | app   |
| `free-chat`         | Chat               | app   |
| `how-do-i-say`      | How do I say       | app   |
| anything else       | Other              | app   |

## Filter logic (in `filteredWords` memo)

Add two new state vars: `sourceFilter: 'anki' | 'app' | null` and `categoryFilter: string | null` (a `source` value).

```text
if sourceFilter === 'anki'  → keep only w.source === 'anki_import'
if sourceFilter === 'app'   → keep only w.source !== 'anki_import'
if categoryFilter           → keep only w.source === categoryFilter
if deckFilter               → keep only w.deck_name === deckFilter  (already)
if tagFilter                → keep only w.tags includes tagFilter   (already)
```

Switching source resets `deckFilter` and `categoryFilter` so stale filters don't hide everything.

## Out of scope

- No DB migration, no edits to `useUserVocabulary` or review queue.
- No changes to the smaller `MyWordsSection` on the home page (filter lives on the full My Words page only).
- Counts are computed from the already-loaded `words` array.
