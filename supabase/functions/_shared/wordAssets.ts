/**
 * The shared asset store: one picture, recording, jingle or line per word,
 * made once and served to every learner.
 *
 * A generator that makes something for a word looks it up here first and only
 * generates on a miss; a hit copies the url onto the learner's own row exactly
 * as a fresh generation did, so nothing downstream knows the difference. The
 * table is `word_assets` (migration 20261009130000_word_assets): public read,
 * service-role writes, so a learner can never plant an asset under a key every
 * other learner is served.
 *
 * The key is the word, never the learner:
 *
 * - the Arabic is folded exactly as `src/lib/arabicWord.ts` folds a saved word
 *   (punctuation off, harakat off, hamza carriers, ى and ة evened out), so the
 *   vocalised بَيْت an enrichment returned and the bare بيت a transcript holds
 *   share one picture;
 * - the English sense rides along (`كتاب|book`) on every kind that shows,
 *   sings or uses the meaning, because the harakat that tell a homograph apart
 *   are exactly what the folding removes: حَب "seeds" and حُب "love" fold to
 *   one word, and a learner shown seeds for love has been taught something
 *   wrong. Two glosses for one sense ("house" / "home") only cost a second
 *   generation, which is the safe way for the key to be wrong;
 * - a recording is the exception: it is keyed on exactly what was spoken,
 *   harakat and all, because the harakat are what the voice reads. A word
 *   re-vowelled to fix how it is said is a new recording, not the old one;
 * - the dialect is its own column, folded onto Gulf / Egyptian / Yemeni. MSA is
 *   refused: the store holds nothing a learner of a spoken dialect should not
 *   be shown;
 * - `style_version` is part of the key, so a brand refresh regenerates rather
 *   than mixes two looks in one deck.
 *
 * A language-neutral kind (an animation of jumping, Phase 5) is keyed on the
 * English concept alone, with no dialect, so every dialect's "jump" shares one.
 *
 * Pure apart from the two store calls, which take the client as a parameter:
 * the browser imports this verbatim (the `useWordAsset` hook reads the table
 * with the anon client), the edge functions pass a service-role client, and
 * Vitest drives it against the in-memory PostgREST emulator
 * (`src/test/wordAssets.test.ts`). Until the migration is applied to the live
 * project every lookup is a miss and every store fails quietly, which leaves
 * each generator doing exactly what it did before the store existed.
 */

import { normalizeArabic } from "./msaLeakDetector.ts";
import { normalizeDialect } from "./ttsVoiceRoutingCore.ts";

/**
 * Every kind of asset the store holds. Not a CHECK in the migration on
 * purpose: a new kind is a new phase, and a CHECK would make each one wait on
 * a migration being applied to the live project.
 */
export const ASSET_KINDS = [
  "image",
  "animation",
  "word_audio",
  "sentence_audio",
  "jingle",
  "dialogue",
  "story_line",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === "string" && (ASSET_KINDS as readonly string[]).includes(value);
}

/** Kinds keyed on the English concept alone. Everything else is bound to a dialect. */
const LANGUAGE_NEUTRAL_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(["animation"]);

/**
 * Kinds that are a voice reading text: keyed on the exact text read (harakat
 * kept), with no sense. The voice says what is written, so two homographs
 * written alike sound alike, and a re-vowelled word is a different recording.
 */
const SPOKEN_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(["word_audio", "sentence_audio"]);

/** Whether a kind shows, sings or uses the meaning, and so cannot be keyed without one. */
export function kindNeedsSense(kind: string): boolean {
  return isAssetKind(kind) && !SPOKEN_KINDS.has(kind);
}

/**
 * The style each kind is made in today. Bump one to have every later lookup
 * miss and regenerate in the new style; the old rows stay, unserved.
 *
 * - `ink-1`: the Ink brand's flat screenprint look (`INK_PICTURE_STYLE`).
 * - `voice-1`: the dialect voice chain in `ttsVoiceRouting.ts` as of 2026-10.
 * - `jingle-1`: `generate-word-jingle`'s per-dialect music styles.
 */
export const STYLE_VERSIONS: Readonly<Record<AssetKind, string>> = {
  image: "ink-1",
  animation: "ink-1",
  word_audio: "voice-1",
  sentence_audio: "voice-1",
  jingle: "jingle-1",
  dialogue: "text-1",
  story_line: "text-1",
};

/** The public bucket a kind's file lives in; null for kinds that are only text. */
export const ASSET_BUCKETS: Readonly<Record<AssetKind, string | null>> = {
  image: "flashcard-images",
  animation: "flashcard-images",
  word_audio: "flashcard-audio",
  sentence_audio: "flashcard-audio",
  jingle: "flashcard-audio",
  dialogue: null,
  story_line: null,
};

/** The dialects the store keys on. */
export type AssetDialect = "Gulf" | "Egyptian" | "Yemeni";

/** Longer than any word, sentence or concept a caller has a reason to key on. */
const MAX_CONCEPT_KEY_LENGTH = 300;

/**
 * Sentence punctuation that can ride along on a token. The same set as
 * `ARABIC_PUNCT_RE` in `src/lib/arabicWord.ts`, which this cannot import (the
 * edge functions are bundled from `supabase/functions` alone);
 * `src/test/wordAssets.test.ts` holds the two foldings to one answer.
 */
const ARABIC_PUNCT_RE = /[،؛؟!.,?:;"'«»()[\]…–—-]/g;

/**
 * At least one Arabic letter, so a key is never built from English, digits or
 * a run of tatweel (U+0640, which the folding keeps and which is not a letter).
 */
const ARABIC_LETTER_RE = /[\u0621-\u063F\u0641-\u064A\u066E-\u06D3\u06FA-\u06FF]/;

/** A word folded for the key: `normalizeArabicWord`, exactly. */
export function normaliseAssetWord(word: string | null | undefined): string {
  return normalizeArabic((word ?? "").replace(ARABIC_PUNCT_RE, ""));
}

/**
 * An English sense folded for the key: lower case, punctuation to spaces, and
 * a leading article or infinitive "to" dropped, so "To eat", "eat" and "eat."
 * are one sense and "eye (body part)" stays apart from "eye".
 */
export function normaliseGloss(gloss: string | null | undefined): string {
  return (gloss ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:to|an?|the)\s+(?=\S)/, "");
}

export interface AssetKeyInput {
  kind: string;
  /** The Arabic the asset is for. Ignored for a language-neutral kind. */
  word?: string | null;
  /**
   * The English sense it is made for. Required for every kind but a recording
   * (`kindNeedsSense`); it is the whole key for a language-neutral kind.
   */
  gloss?: string | null;
  /** Any dialect label the app uses; folded onto three. Missing means Gulf. */
  dialect?: string | null;
}

export interface AssetKey {
  conceptKey: string;
  kind: AssetKind;
  dialect: AssetDialect | null;
  styleVersion: string;
  /**
   * The folded English sense the key was built from ("" for a spoken kind).
   * A shared prompt is built from this, never from the gloss as typed:
   * whatever the folding drops (emoji, symbols, punctuation) is not in the key,
   * so it must not be in what every learner of the key is shown either.
   */
  sense: string;
}

/** The exact text a voice reads, for a spoken kind: harakat kept, spacing evened. */
function spokenText(text: string | null | undefined): string {
  return (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Where an asset is filed, or null when there is nothing a learner should be
 * served under it: an unknown kind, no Arabic letter in the word, a `|` in it
 * (the separator, so a word cannot impersonate another word's sense), MSA, or
 * a kind that needs a meaning given none that survives the folding.
 */
export function assetKey(input: AssetKeyInput): AssetKey | null {
  if (!isAssetKind(input.kind)) return null;
  const kind = input.kind;
  const styleVersion = STYLE_VERSIONS[kind];

  if (LANGUAGE_NEUTRAL_KINDS.has(kind)) {
    const sense = normaliseGloss(input.gloss);
    if (!sense || sense.length > MAX_CONCEPT_KEY_LENGTH) return null;
    return { conceptKey: sense, kind, dialect: null, styleVersion, sense };
  }

  const dialect = typeof input.dialect === "string" || input.dialect == null
    ? normalizeDialect(input.dialect)
    : "Gulf";
  if (dialect === "MSA") return null;

  if (SPOKEN_KINDS.has(kind)) {
    const text = spokenText(input.word);
    if (!ARABIC_LETTER_RE.test(text) || text.length > MAX_CONCEPT_KEY_LENGTH) return null;
    return { conceptKey: text, kind, dialect, styleVersion, sense: "" };
  }

  const arabic = normaliseAssetWord(input.word);
  if (!ARABIC_LETTER_RE.test(arabic) || arabic.includes("|")) return null;
  const sense = normaliseGloss(input.gloss);
  if (!sense) return null;

  const conceptKey = `${arabic}|${sense}`;
  if (conceptKey.length > MAX_CONCEPT_KEY_LENGTH) return null;
  return { conceptKey, kind, dialect, styleVersion, sense };
}

/**
 * Where a newly made file goes in its bucket: in a folder named for the key,
 * hashed so a path never carries Arabic or a learner's gloss, under a name of
 * its own. Never reused, because a url handed to a learner must keep playing
 * what they were given: two learners who miss at once (or every learner,
 * while the table is not yet applied) each get their own object, and only the
 * one the table files is served to anyone else.
 */
export async function assetObjectPath(key: AssetKey, extension: string): Promise<string> {
  const ext = /^[a-z0-9]{1,5}$/.test(extension) ? extension : "bin";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${key.dialect ?? ""}\n${key.conceptKey}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const dialect = (key.dialect ?? "any").toLowerCase();
  return `word-assets/${key.kind}/${key.styleVersion}/${dialect}/${hex}/${crypto.randomUUID()}.${ext}`;
}

// ── The Ink picture style ───────────────────────────────────────────────────

/**
 * How every stored picture looks: the Ink brand (`docs/brand-refresh.md`,
 * direction B) as a flat poster illustration. The owner has ruled out
 * photographs and photo-realism; the palette is Ink's oxblood, mustard and
 * near-black on its cream. No text at all, which is also what keeps a picture
 * in dialect: an image model's lettering is Fusha when it is Arabic at all.
 *
 * Changing this changes the look of every new picture, so it goes with a bump
 * of `STYLE_VERSIONS.image`.
 */
export const INK_PICTURE_STYLE = [
  "Style: a flat graphic illustration, like a screenprinted editorial poster.",
  "Three flat inks only — oxblood red #6B1F1F, mustard #E2B65C and near-black #1A1C17 —",
  "on a plain cream #EFE6CF ground. Bold, simple, geometric shapes with crisp edges;",
  "tone shown only by flat areas of colour or simple line hatching, never by gradients,",
  "airbrushing or soft shading. Not a photograph, not photo-realistic, not 3D, not",
  "watercolour, no paper texture, nothing cartoonish or cute.",
  "One clear subject, centred, filling about two thirds of a square frame, with plain",
  "cream around it, so it still reads at the size of a thumbnail.",
  "No text of any kind: no letters, no Arabic or English words, no numbers, no captions,",
  "no signs, no logos, no watermark, no border or frame.",
].join(" ");

/** Where people and places come from when a picture has any. */
const DIALECT_SETTING: Readonly<Record<AssetDialect, string>> = {
  Gulf:
    "If people or places appear, they are from the Arabian Gulf today: kandura and ghutra, abaya, a majlis, palms, the coast.",
  Egyptian:
    "If people or places appear, they are from Egypt today: a Cairo street or café, everyday city clothes or a galabeya, the Nile.",
  Yemeni:
    "If people or places appear, they are from Yemen today: Sana'a tower houses, a futa and shawl, terraced mountains.",
};

/** Glosses are learner-typed; the prompt carries a short, quote-free copy. */
function promptSafe(text: string, max: number): string {
  return text.replace(/["“”]/g, "'").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The longest authored scene a prompt carries; a track's are a sentence or two. */
export const MAX_SCENE_LENGTH = 400;

/**
 * What makes a picture usable as a question. The quiz's picture step deals a
 * word's picture beside three other words' (`QuizCardFrame`), so four pictures
 * that are all "a person in a room" are four right answers. This asks for the
 * one thing that is this word; it is part of the template, not of the look
 * (`INK_PICTURE_STYLE`), so it does not go with a style-version bump.
 */
export const PICTURE_DISTINCT_LINE = [
  "This picture will be shown beside the pictures of three other words, and a learner",
  "has to tell at a glance which of the four is this one. So draw what is particular to",
  "this meaning: one subject with a silhouette of its own, the action or object itself",
  "rather than a general scene that could stand for another word, and nothing in the",
  "background that could be mistaken for the subject.",
].join(" ");

/**
 * The prompt for a word's picture, built only from what the key was built
 * from (the sense and the dialect) plus an optional authored scene. Nothing
 * else a caller says reaches it, so whoever misses first cannot decide what
 * every later learner is shown.
 */
export function inkPicturePrompt(input: {
  gloss: string;
  dialect: AssetDialect | null;
  /** An authored scene (a track word's `image_scene`); never a learner's text. */
  scene?: string | null;
}): string {
  const gloss = promptSafe(input.gloss, 120);
  const scene = promptSafe(input.scene ?? "", MAX_SCENE_LENGTH);
  return [
    `A picture that shows, unmistakably and on its own, the meaning "${gloss}".`,
    scene ? `Scene: ${scene}` : "",
    PICTURE_DISTINCT_LINE,
    INK_PICTURE_STYLE,
    input.dialect ? DIALECT_SETTING[input.dialect] : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── The store ───────────────────────────────────────────────────────────────

/** A stored asset, as every caller sees it. */
export interface WordAsset {
  id: string;
  conceptKey: string;
  kind: AssetKind;
  dialect: AssetDialect | null;
  styleVersion: string;
  url: string | null;
  payload: unknown;
  meta: Record<string, unknown>;
  source: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface NewWordAsset {
  url?: string | null;
  payload?: unknown;
  /** Prompt, model, voice, duration — whatever says how it was made. */
  meta?: Record<string, unknown>;
  source?: "generated" | "authored" | "reviewed";
}

interface Settled {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface AssetQuery extends PromiseLike<Settled> {
  eq(column: string, value: string): AssetQuery;
  is(column: string, value: null): AssetQuery;
  limit(count: number): AssetQuery;
  maybeSingle(): PromiseLike<Settled>;
}

/**
 * The slice of a Supabase client the store needs. Structural, so a
 * service-role client in Deno, the browser's anon client and the test
 * emulator's all fit; the typed browser client needs a cast, since
 * `word_assets` is not in the generated types until the migration is applied.
 */
export interface WordAssetClient {
  from(table: string): {
    select(columns: string): AssetQuery;
    insert(values: Record<string, unknown>): {
      select(columns: string): { single(): PromiseLike<Settled> };
    };
    update(values: Record<string, unknown>): AssetUpdate;
  };
}

/** A filtered update that hands back the row it changed, if it changed one. */
interface AssetUpdate {
  eq(column: string, value: string): AssetUpdate;
  is(column: string, value: null): AssetUpdate;
  select(columns: string): { maybeSingle(): PromiseLike<Settled> };
}

/** Every column a caller is shown, in one place so a read and a write agree. */
const ASSET_COLUMNS =
  "id, concept_key, kind, dialect, style_version, url, payload, meta, source, approved_at, created_at";

/**
 * PostgREST's "no such table" (PGRST205, or 42P01 from Postgres itself): the
 * expected state until the migration is applied, so not worth a warning on
 * every lookup.
 */
function isMissingTable(error: { code?: string; message: string }): boolean {
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /word_assets/.test(error.message) && /not find|does not exist/i.test(error.message);
}

function toWordAsset(row: unknown): WordAsset | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.concept_key !== "string") return null;
  if (!isAssetKind(r.kind) || typeof r.style_version !== "string") return null;
  const dialect = r.dialect === "Gulf" || r.dialect === "Egyptian" || r.dialect === "Yemeni"
    ? r.dialect
    : null;
  return {
    id: r.id,
    conceptKey: r.concept_key,
    kind: r.kind,
    dialect,
    styleVersion: r.style_version,
    url: typeof r.url === "string" && r.url ? r.url : null,
    payload: r.payload ?? null,
    meta: r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : {},
    source: typeof r.source === "string" ? r.source : "generated",
    approvedAt: typeof r.approved_at === "string" ? r.approved_at : null,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * The asset filed under `key` in the current style, or null. Every failure is
 * a miss — the table not yet applied above all — because a caller that cannot
 * find an asset generates one, which is what it did before the store existed.
 */
export async function getAsset(client: WordAssetClient, key: AssetKey): Promise<WordAsset | null> {
  try {
    let query = client
      .from("word_assets")
      .select(ASSET_COLUMNS)
      .eq("concept_key", key.conceptKey)
      .eq("kind", key.kind)
      .eq("style_version", key.styleVersion);
    query = key.dialect === null ? query.is("dialect", null) : query.eq("dialect", key.dialect);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.warn(`[wordAssets] lookup failed: ${error.message}`);
      return null;
    }
    return toWordAsset(data);
  } catch (err) {
    console.warn(`[wordAssets] lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export type PutOutcome =
  /** Filed under the key; this is now what every learner is served. */
  | { status: "stored"; asset: WordAsset }
  /**
   * Filed in the place of a picture drawn from the gloss alone
   * (`replaceAsset`). `previousUrl` still serves whoever was handed it.
   */
  | { status: "replaced"; asset: WordAsset; previousUrl: string | null }
  /** Someone filed one first. Serve theirs, so every learner sees the same. */
  | { status: "taken"; asset: WordAsset | null }
  /** Not filed (the table not yet applied, most likely). Serve your own. */
  | { status: "failed"; error: string };

/**
 * File an asset under `key`. Service-role only — RLS refuses anyone else — and
 * never throws: a generator that made something has a learner waiting for it,
 * and failing to share it is no reason to fail them.
 */
export async function putAsset(
  client: WordAssetClient,
  key: AssetKey,
  asset: NewWordAsset,
): Promise<PutOutcome> {
  const url = asset.url ?? null;
  const payload = asset.payload ?? null;
  if (!url && payload === null) return { status: "failed", error: "nothing to store" };

  try {
    const { data, error } = await client
      .from("word_assets")
      .insert({
        concept_key: key.conceptKey,
        kind: key.kind,
        dialect: key.dialect,
        style_version: key.styleVersion,
        url,
        payload,
        meta: asset.meta ?? {},
        source: asset.source ?? "generated",
      })
      .select(ASSET_COLUMNS)
      .single();
    if (error) {
      // The unique index: another learner missed at the same moment and won.
      if (error.code === "23505") return { status: "taken", asset: await getAsset(client, key) };
      if (!isMissingTable(error)) console.warn(`[wordAssets] store failed: ${error.message}`);
      return { status: "failed", error: error.message };
    }
    const stored = toWordAsset(data);
    return stored ? { status: "stored", asset: stored } : { status: "failed", error: "unreadable row" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[wordAssets] store failed: ${message}`);
    return { status: "failed", error: message };
  }
}

// ── Replacing what a learner's miss filed ───────────────────────────────────

/**
 * Whether a filed asset may be replaced by an authored one.
 *
 * Curriculum words and learners' words share keys, and whichever is made
 * first is filed. A learner's miss is drawn from the gloss alone — "coffee" —
 * while a track word carries a scene its author wrote and checked against the
 * rest of its lesson. So the authored one wins whenever it arrives second,
 * and only then: an asset someone authored, reviewed or approved is never
 * replaced by a script, and one authored asset never replaces another (a
 * re-run with the same scene, or an edited one, is a hit and costs nothing).
 */
export function isReplaceable(asset: WordAsset): boolean {
  return asset.source === "generated" && asset.approvedAt === null;
}

/**
 * Point `existing`'s row at a newly made asset, when it is still replaceable.
 *
 * For the trusted path alone (`word-asset` under the service role or for the
 * content team): what goes in must be `authored` or `reviewed`, so a caller
 * holding only a generation has nothing this will accept, and the update is
 * conditional on the row still being an unapproved `generated` one, so a
 * reviewer who approved it a moment ago is not overwritten.
 *
 * The row is updated in place and the old file is left where it is: a url is
 * never reused or deleted, so a learner whose own row carries the old picture
 * keeps seeing the picture they were given. `meta.replaces` records it.
 * Never throws; `taken` means it was no longer replaceable and carries what
 * is filed now.
 */
export async function replaceAsset(
  client: WordAssetClient,
  key: AssetKey,
  existing: WordAsset,
  asset: NewWordAsset,
): Promise<PutOutcome> {
  if (asset.source !== "authored" && asset.source !== "reviewed") {
    return { status: "failed", error: "only an authored or reviewed asset replaces a filed one" };
  }
  const url = asset.url ?? null;
  const payload = asset.payload ?? null;
  if (!url && payload === null) return { status: "failed", error: "nothing to store" };
  if (!isReplaceable(existing)) return { status: "taken", asset: existing };

  try {
    const { data, error } = await client
      .from("word_assets")
      .update({
        url,
        payload,
        meta: { ...(asset.meta ?? {}), replaces: existing.url },
        source: asset.source,
      })
      .eq("id", existing.id)
      .eq("source", "generated")
      .is("approved_at", null)
      .select(ASSET_COLUMNS)
      .maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.warn(`[wordAssets] replace failed: ${error.message}`);
      return { status: "failed", error: error.message };
    }
    const stored = toWordAsset(data);
    if (stored) return { status: "replaced", asset: stored, previousUrl: existing.url };
    // Nothing matched: it was authored, reviewed or approved in the meantime.
    return { status: "taken", asset: await getAsset(client, key) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[wordAssets] replace failed: ${message}`);
    return { status: "failed", error: message };
  }
}

// ── Filing a newly made file ────────────────────────────────────────────────

/** The slice of a service-role client an upload needs. */
export interface AssetStorage {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export type FiledFile =
  /** `url` is the object this call uploaded; `filed` says what the table did with it. */
  | { url: string; filed: PutOutcome }
  /** Nothing uploaded, so nothing to serve or file. */
  | { error: string };

/**
 * Upload a newly made file under a name of its own in its kind's bucket, then
 * file it under `key`. The one way the generators add a file to the store, so
 * every object is fresh and nothing a learner was handed is ever overwritten.
 *
 * What to serve is the caller's call: on `taken` another learner filed first,
 * and a caller that wants every learner on one asset serves `filed.asset`;
 * one whose learner already heard this one keeps `url`.
 *
 * With `options.replace` the file is made the same way and the row that
 * exists is pointed at it instead (the trusted path's authored scene taking
 * the place of a gloss-only picture); nothing is overwritten then either.
 */
export async function fileNewAsset(
  storage: AssetStorage,
  store: WordAssetClient,
  key: AssetKey,
  file: { bytes: Uint8Array; contentType: string; extension: string },
  asset: Omit<NewWordAsset, "url">,
  /**
   * `replace`: the asset filed under `key` that this one takes the place of
   * (`replaceAsset`, with its rules). The new file is still a new object.
   */
  options: { replace?: WordAsset | null } = {},
): Promise<FiledFile> {
  const bucket = ASSET_BUCKETS[key.kind];
  if (!bucket) return { error: `${key.kind} assets have no file` };
  try {
    const path = await assetObjectPath(key, file.extension);
    const { error } = await storage.storage
      .from(bucket)
      .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (error) return { error: error.message };
    const url = storage.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const filed = options.replace
      ? await replaceAsset(store, key, options.replace, { ...asset, url })
      : await putAsset(store, key, { ...asset, url });
    return { url, filed };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
