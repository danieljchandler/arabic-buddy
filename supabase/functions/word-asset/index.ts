/**
 * word-asset — the door to the shared asset store (quiz Phase 2).
 *
 * Two actions, both keyed on a word rather than on the caller:
 *
 * - `get`: the asset filed under a word, kind and dialect in the current
 *   style, or null. Costs nothing.
 * - `ensure`: get, else make it, file it, and return it. Only a miss calls a
 *   model, and only a miss is charged — to the caller who missed, on the daily
 *   counter of the kind it made (`CAPS`).
 *
 * `ensure` makes four kinds:
 *
 * - pictures (`kind: "image"`), in the Ink style and from nothing but the
 *   word's sense and dialect (`inkPicturePrompt`), on the flashcard
 *   illustrator's counter, so routing the picture dialog through here does not
 *   hand anyone a second allowance;
 * - exchanges (`kind: "dialogue"`, quiz Phase 4): two lines, the second using
 *   the word, written through the Brain (the CONTENT lineup, `draft_critic`,
 *   the native-speaker validator on) from the key's folded word, sense and
 *   dialect (`dialoguePrompt`), on a counter of their own. One is filed only
 *   when every line passes the leak detector as the Brain runs it (with the
 *   approved rulebook's tokens) and the native validator passed the text that
 *   was shipped; one that fails either is neither filed nor served, and the
 *   quiz asks its fallback (one the validator could not judge at all is
 *   served to the learner who paid for it, unfiled). A dialogue has no learner
 *   row to land on, so while the table is not there nothing is made and
 *   nothing is charged (`store_not_ready`), and a word that is itself on the
 *   dialect's leak lists is turned away before the charge
 *   (`word_not_in_dialect`), since no exchange using it could be filed;
 * - animations (`kind: "animation"`, quiz Phase 5): a four-second looping clip
 *   of an action word, keyed on the English action alone and shared by every
 *   dialect. Made on the trusted path only (below), the content team's on a
 *   daily counter of their own (`ANIMATION_STAFF_CAP`), and never for a learner: a
 *   clip costs a poster and four seconds of Veo, several times a picture, takes
 *   longer to render than any card waits, and is shown to every dialect's
 *   learners of the action, so a learner's miss is not what decides it. A
 *   learner reads clips and is refused an `ensure` (`403
 *   animation_not_for_learners`) before anything is spent. The poster is drawn
 *   first, in the Ink picture style, and the clip animated from it as its first
 *   and last frame, so it loops; both go in the `word-animations` bucket under
 *   fresh names. Nothing is made while the table or that bucket is missing
 *   (`store_not_ready`, `bucket_not_ready`). A render can outlast the caller's
 *   patience, so a clip still rendering after `animationAnswerMs` is finished
 *   in the background (`EdgeRuntime.waitUntil`) and the caller is answered
 *   `202 { pending: true }`, to look it up with `get` later;
 * - story passages (`kind: "story_line"`, quiz Phase 6): two sentences, one of
 *   them using the word, for the quiz's top step. Taken from a published story
 *   in the reading library that already uses the word, where one does
 *   (`findStoryPassage`: the dialect text only, a public-domain or CC0
 *   licence, the story's current rendering), which calls no model and is
 *   charged to nobody; otherwise written exactly as an exchange is
 *   (`storyLinePrompt`, the same `writeText`, the same leak and validator
 *   gates) and charged on the exchange's counter, since it costs the same.
 *   Never while the table is missing (`store_not_ready`), and never for a
 *   word on the dialect's leak lists (`word_not_in_dialect`).
 *
 * Nothing else a learner sends reaches a prompt: the first learner to miss
 * decides what every later learner is shown, so they must not be able to
 * decide anything beyond the word. A learner's saved sentence is their own
 * text, and is not sent.
 *
 * The trusted path (quiz Phase 3) is the one exception, and it is not a
 * learner's: a call made with the service-role key (`isServiceRoleCall` —
 * `scripts/curriculum-pictures.ts`, filling the curriculum's pictures) or by
 * the content team (`requireRole`, read from `user_roles`) may send authored
 * context — `scene` for a picture (a track word's `image_scene`, the `scene`
 * argument of `inkPicturePrompt`) or `example` for an exchange (a curriculum
 * word's authored example sentence, `authoredExample`). Three things follow
 * from who is asking:
 *
 * - nothing is charged. There is no learner to charge under the service
 *   role, and an authored asset is the catalogue's, not a staff member's
 *   own allowance. Authored context from anyone else is ignored, not
 *   refused, and that caller is charged as the learner they are. The one
 *   exception is a clip asked for by the content team, counted on
 *   `ANIMATION_STAFF_CAP` because it costs several pictures;
 * - what it files is `source: "authored"`, with the context in `meta`;
 * - it replaces what a learner's miss filed first under the same key
 *   (curriculum and learners share keys: a curriculum word's sense is its
 *   `word_english`). `isReplaceable` in `_shared/wordAssets.ts` is the rule:
 *   only an unapproved `generated` asset gives way, so an authored, reviewed
 *   or approved one is a hit like any other and a re-run costs nothing. An
 *   old picture file stays where it is, so a learner whose own row carries it
 *   keeps the picture they were given.
 *
 * Writes run under the service role, which is the point of the function: the
 * table is public-read and service-write, so a learner reaches a shared row
 * only through a generation this function made.
 *
 * Until the migration is applied to the live project every lookup misses and
 * every store fails quietly: `get` answers null, `ensure` makes a picture
 * anyway and returns it unfiled (`stored: false`), which is what the dialog
 * did before the store existed, and makes no exchange at all.
 *
 * Body: { action: "get" | "ensure", kind, word, gloss?, dialect?, scene?, example? }
 * Response: { asset, url, cached, stored, payload?, replaced?, authored? }, or
 * for an animation still rendering, 202 { pending: true }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap, resolveUserId } from "../_shared/usageCap.ts";
import {
  generateImage,
  generateVideo,
  hasAnyProvider,
  imageExtension,
  isMp4,
  VIDEO_MIN_ROUTE_MS,
  type GeneratedImage,
  type VideoFrame,
} from "../_shared/aiGateway.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getDialectForbiddenTokens, primeDialectPrompt } from "../_shared/dialectHelpers.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";
import { IMAGE_MODEL_IDS, VIDEO_MODEL_IDS } from "../_shared/modelRegistry.ts";
import { CONTENT_MANAGER_ROLES, isServiceRoleCall, requireRole } from "../_shared/requireRole.ts";
import {
  assetKey,
  authoredScene,
  fileNewAsset,
  inkPicturePrompt,
  isReplaceable,
  kindNeedsSense,
  lookupAsset,
  normaliseGloss,
  putAsset,
  replaceAsset,
  uploadNewFile,
  ASSET_BUCKETS,
  type AssetKey,
  type AssetStorage,
  type NewWordAsset,
  type PutOutcome,
  type WordAsset,
  type WordAssetClient,
} from "../_shared/wordAssets.ts";
import {
  asStoredDialogue,
  authoredExample,
  DIALOGUE_TOOL,
  dialogueArabic,
  dialogueLinesForScan,
  dialoguePrompt,
  dialogueProblem,
  keyWord,
} from "../_shared/wordDialogue.ts";
import {
  asStoredStoryLine,
  findStoryPassage,
  STORY_LINE_TOOL,
  storyLineArabic,
  storyLinePayload,
  storyLinePrompt,
  storyLineProblem,
  storyLineSentencesForScan,
  storyPassageAsset,
  type StoryClient,
  type StoryPassage,
} from "../_shared/wordStoryLine.ts";
import {
  ANIMATION_ASPECT,
  ANIMATION_RESOLUTION,
  ANIMATION_SECONDS,
  inkAnimationPosterPrompt,
  inkAnimationPrompt,
  MAX_ANIMATION_BYTES,
  type AnimationPayload,
} from "../_shared/wordAnimation.ts";

/**
 * Text written through the Brain for a word, per day: an exchange or a story
 * passage. Named for the kind that first used it; renaming it would reset
 * every learner's count.
 */
const TEXT_CAP = { key: "word-asset-dialogue", free: 30, tiers: { standard: 100, allin: 300 } } as const;

/**
 * The kinds `ensure` can make, and who pays for each, per day. Counted only
 * on a miss, and never on the trusted path.
 *
 * - A picture is charged on the flashcard illustrator's key, so the picture
 *   dialog's two paths share one allowance.
 * - An exchange is a different cost (a few short text calls, not an image)
 *   with a counter of its own, so a learner whose pictures are spent for the
 *   day still gets their dialogues, and the reverse. It is reached once per
 *   word, at the quiz's reply steps, which a word only climbs to after a month
 *   of reviews; a free learner's thirty a day is more than any session asks.
 * - A story passage written for a word (quiz Phase 6) is the same cost as an
 *   exchange — the same lineup, strategy and validator, a few hundred tokens
 *   — so it is charged on the same counter. Pictures and exchanges are kept
 *   apart because they cost differently; these two cost alike, and a counter
 *   of their own would have given every learner a second thirty text calls a
 *   day for a step a word reaches after two months. A passage taken from a
 *   published story calls no model and is charged nothing.
 */
const CAPS = {
  image: { key: "generate-flashcard-image", free: 20, tiers: { standard: 60, allin: 200 } },
  dialogue: TEXT_CAP,
  story_line: TEXT_CAP,
} as const;

/**
 * A clip from the content team, per day, per person: about $0.27 each, so
 * ten is at most $2.70 a day for any reviewer, an ID login included. Decided
 * by the owner on 2026-10-10 ("cap it"). The service role — the owner's own
 * run of `scripts/curriculum-animations.ts` — is not counted, and an admin,
 * as for every cap here, is not limited (`enforceDailyCap`). Learners are
 * refused a clip outright, so this is the only counter clips have.
 */
const ANIMATION_STAFF_CAP = { key: "word-asset-animation", perDay: 10 } as const;

/** The kinds `ensure` makes. An animation is made on the trusted path alone. */
const ENSURABLE = ["image", "dialogue", "animation", "story_line"] as const;

type EnsurableKind = (typeof ENSURABLE)[number];

const isEnsurable = (kind: string): kind is EnsurableKind => (ENSURABLE as readonly string[]).includes(kind);

/**
 * How long an animation's caller is held before the clip is finished in the
 * background and they are told to look it up later. Under the platform's
 * 150 s request idle timeout, with the poster drawn inside it; a four-second
 * Lite clip usually renders well within it. `WORD_ASSET_ANIMATION_ANSWER_MS`
 * overrides it.
 */
const ANIMATION_ANSWER_MS = 100_000;

/**
 * The whole of one clip, poster to filed row, from the moment it is asked
 * for. The worker's wall clock is 400 s; this leaves the function's own
 * lookups before it and the uploads and the filing after it inside that.
 */
const ANIMATION_BUDGET_MS = 340_000;

/** One try at the poster. A picture takes about ten seconds; a second try follows a slow first only while time allows. */
const POSTER_TIMEOUT_MS = 60_000;

/** Kept back from the clip's budget for the two uploads and the filing. */
const FILING_RESERVE_MS = 20_000;

function animationAnswerMs(): number {
  const raw = Number(Deno.env.get("WORD_ASSET_ANIMATION_ANSWER_MS"));
  return Number.isFinite(raw) && raw >= 0 ? raw : ANIMATION_ANSWER_MS;
}

/**
 * The Brain's wall-clock budget for one exchange or passage. The quiz waits
 * for it only as long as `DIALOGUE_WRITING_WAIT_MS` (`STORY_LINE_WRITING_WAIT_MS`
 * for a passage) and asks its fallback past that, so this bounds the spend,
 * not the learner's wait.
 */
const DIALOGUE_BUDGET_MS = 40_000;

/** A gloss longer than this is a note, not a sense, and has no business in a prompt. */
const MAX_GLOSS_LENGTH = 80;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return reply({ error: "invalid_json" }, 400);
  }

  const action = body.action;
  if (action !== "get" && action !== "ensure") {
    return reply({ error: "invalid_action", message: 'action must be "get" or "ensure"' }, 400);
  }

  // A signed-in learner for both actions, or the pipeline calling with the
  // service-role key. `get` serves public data, but this is a service-role
  // door and an anonymous caller has no reason to be here; the table itself
  // is readable with the anon key for anyone who needs that.
  const viaServiceRole = await isServiceRoleCall(req);
  const userId = viaServiceRole ? null : await resolveUserId(req);
  if (!viaServiceRole && !userId) {
    return reply({ error: "auth_required", message: "Please sign in to use this feature." }, 401);
  }

  // Authored context, honoured only from a trusted caller: a track word's
  // scene for a picture, a curriculum word's example sentence for an
  // exchange. The role is read only when some was sent, so an ordinary call
  // costs no extra lookup; a learner who sends it is not refused — it is
  // simply not heard, and they go on as the learner they are.
  // (`authoredScene` / `authoredExample`: one line, bounded, and "" for text
  // that is no scene or no example of this word, so a full stop cannot stand
  // in for either.)
  const kind = text(body.kind);
  const sentContext = kind === "image"
    ? authoredScene(text(body.scene))
    : kind === "dialogue" || kind === "story_line"
    ? authoredExample(text(body.example), text(body.word))
    : "";
  // An animation is the catalogue's to make, never a learner's: asking for
  // one to be made is itself the trusted path, as authored context is.
  const asksForClip = action === "ensure" && kind === "animation";
  let staffId: string | null = null;
  if (!viaServiceRole && (sentContext || asksForClip)) {
    const staff = await requireRole(req, CONTENT_MANAGER_ROLES, corsHeaders, { allowServiceRole: false });
    if (!staff.denied) staffId = staff.userId;
  }
  const catalogue = viaServiceRole || staffId !== null;
  const authored = sentContext && catalogue ? sentContext : "";
  if (staffId && (authored || asksForClip)) {
    // The table is public-read, so who authored an asset is not in it.
    // The function log is where a staff member's uncapped draw is kept.
    const what = asksForClip ? "animation asked" : kind === "image" ? "scene authored" : "example authored";
    console.log(`word-asset: ${what} by staff ${staffId} for "${text(body.gloss).trim().slice(0, MAX_GLOSS_LENGTH)}"`);
  }
  // Trusted: nobody's allowance pays for it. A staff member without authored
  // context is asking for their own word's asset, as a learner does — except
  // for a clip, which nobody asks for as a learner.
  const trusted = viaServiceRole || authored !== "" || (asksForClip && catalogue);

  const gloss = text(body.gloss).trim();
  if (gloss.length > MAX_GLOSS_LENGTH) {
    return reply({ error: "gloss_too_long", message: `gloss is limited to ${MAX_GLOSS_LENGTH} characters` }, 400);
  }

  // Checked on the folded sense, not the gloss as typed: a gloss of nothing
  // but emoji or punctuation folds to nothing, and a picture keyed without a
  // meaning is exactly what lets one homograph borrow another's.
  if (kindNeedsSense(kind) && !normaliseGloss(gloss)) {
    return reply({ error: "gloss_required", message: "gloss (the word's English sense) is required" }, 400);
  }

  const key = assetKey({
    kind,
    word: text(body.word),
    gloss,
    dialect: text(body.dialect) || null,
  });
  if (!key && kind === "animation") {
    // `animationConcept`: a note, a verb with nothing to watch, or a description.
    return reply(
      { error: "not_an_action", message: "An animation is keyed on an action, and this gloss names none." },
      400,
    );
  }
  if (!key) {
    return reply(
      {
        error: "invalid_key",
        message: "A known kind and an Arabic word in Gulf, Egyptian or Yemeni are required.",
      },
      400,
    );
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  // The store's own structural slice of the client; `word_assets` is not in
  // any generated type until the migration is applied.
  const store = admin as unknown as WordAssetClient;

  const { asset: found, missingTable } = await lookupAsset(store, key);
  if (action === "get") {
    return reply(found ? served(found, true) : { asset: null, url: null, cached: false, stored: false });
  }
  // Authored context takes the place of an asset made from the gloss alone;
  // everything else that is filed is a hit, for everyone.
  const replace = found && authored && isReplaceable(found) ? found : null;
  if (found && !replace) return reply(served(found, true));

  // ── ensure, on a miss ─────────────────────────────────────────────────────
  if (!isEnsurable(key.kind)) {
    return reply(
      { error: "kind_not_generated", message: `word-asset does not make ${key.kind} assets yet.` },
      400,
    );
  }
  // A clip is made for the catalogue, never on a learner's miss, and nothing
  // has been spent yet: turned away here, uncharged.
  if (key.kind === "animation" && !trusted) {
    return reply(
      {
        error: "animation_not_for_learners",
        message: "Animations are made for the curriculum by the content team, not on request.",
      },
      403,
    );
  }
  // A story passage is looked for in the reading library before anything is
  // written: a published story that already uses the word costs no model call
  // and is charged to nobody (`findStoryPassage`, reads of public data).
  if (key.kind === "story_line") {
    // It has nowhere to live but the store: one made while the table is not
    // there would be made, and charged, again at every encounter.
    if (missingTable) {
      return reply(
        { error: "store_not_ready", fallback: true, message: "Story passages cannot be kept yet, so none is made." },
        503,
      );
    }
    const dialect = key.dialect ?? "Gulf";
    await primeDialectPrompt(dialect);
    const leaksIn = (line: string) => detectMsaLeaks(line, dialect, getDialectForbiddenTokens(dialect)).leaks;
    // The passage must use the word as it is, so a word on the dialect's leak
    // lists could never be filed: turned away before the search and the charge.
    if (leaksIn(keyWord(key)).length > 0) {
      return reply(
        { error: "word_not_in_dialect", message: "This word is not one the dialect's passages can use." },
        400,
      );
    }
    const fromStory = await findStoryPassage(admin as unknown as StoryClient, key, { leaksIn });
    if (fromStory) {
      try {
        return reply(await fileStoryPassage(store, key, fromStory, replace));
      } catch (err) {
        console.error("word-asset story passage error:", err);
        return reply({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
      }
    }
  }

  if (!hasAnyProvider()) {
    return reply(
      {
        error: "ai_unconfigured",
        fallback: true,
        message: key.kind === "image" || key.kind === "animation"
          ? `${key.kind === "image" ? "Image" : "Video"} generation is not configured right now.`
          : "Text generation is not configured right now.",
      },
      503,
    );
  }
  // A picture lands on the learner's own row whether or not the store keeps
  // it. An exchange has nowhere else to live: made while the table is not
  // there, it would be made, and charged, again at every encounter.
  // An animation neither: it is made for every learner of the action or for
  // nobody, and at several times a picture's price it is never made to be
  // thrown away.
  if ((key.kind === "dialogue" || key.kind === "animation") && missingTable) {
    return reply(
      {
        error: "store_not_ready",
        fallback: true,
        message: `${key.kind === "dialogue" ? "Dialogues" : "Animations"} cannot be kept yet, so none is made.`,
      },
      503,
    );
  }
  // Nor while the bucket it would go in is missing (its migration not yet
  // applied): every upload would fail after the poster and the clip were paid.
  if (key.kind === "animation") {
    const bucket = ASSET_BUCKETS.animation!;
    const { error: bucketError } = await admin.storage.getBucket(bucket);
    if (bucketError) {
      return reply(
        { error: "bucket_not_ready", fallback: true, message: `The ${bucket} bucket is not there yet, so nothing is made.` },
        503,
      );
    }
  }
  // The reply must use the word as it is, so a word that is itself on the
  // dialect's leak lists (the rulebook's included) can never pass the check
  // its exchange is filed on: every attempt would be charged and thrown away.
  // Turned away here, before the charge.
  if (key.kind === "dialogue") {
    const dialect = key.dialect ?? "Gulf";
    await primeDialectPrompt(dialect);
    if (detectMsaLeaks(keyWord(key), dialect, getDialectForbiddenTokens(dialect)).leaks.length > 0) {
      return reply(
        { error: "word_not_in_dialect", message: "This word is not one the dialect's exchanges can use." },
        400,
      );
    }
  }

  // A content team member's clip is counted, on a counter of its own and only
  // now, on the miss, with nothing spent yet; the service role's is not.
  if (key.kind === "animation" && !viaServiceRole) {
    const { key: capKey, perDay } = ANIMATION_STAFF_CAP;
    const limited = await enforceDailyCap(req, capKey, perDay, corsHeaders, { standard: perDay, allin: perDay });
    // The cap's own message offers an upgrade, which lifts nothing here: the
    // limit is the same on every plan.
    if (limited.limited) {
      return reply(
        {
          error: "daily_limit_reached",
          message: `The content team can make ${perDay} animations a day each; the count resets tomorrow.`,
        },
        429,
      );
    }
  }

  // Charged only now, on the miss, and only to a learner, on the kind's own
  // counter.
  if (!trusted && key.kind !== "animation") {
    const cap = CAPS[key.kind];
    const limited = await enforceDailyCap(req, cap.key, cap.free, corsHeaders, cap.tiers);
    if (limited.limited) return limited.response;
  }

  if (key.kind === "animation") {
    // Answered within `animationAnswerMs`, or finished in the background and
    // looked up later: the render is paid for either way, so it is never left
    // to die with a dropped connection.
    const job = makeAnimation(admin, store, key).catch((err) => {
      console.error("word-asset animation error:", err);
      return { error: err instanceof Error ? err.message : "Unknown error", fallback: true };
    });
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?(task: Promise<unknown>): void } })
      .EdgeRuntime;
    runtime?.waitUntil?.(job);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      job,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), animationAnswerMs());
      }),
    ]).finally(() => clearTimeout(timer));
    if (first) return reply(first);
    return reply(
      { pending: true, message: "Still rendering; look it up with get in a minute or two." },
      202,
    );
  }

  try {
    if (key.kind === "dialogue") return reply(await makeDialogue(store, key, { example: authored, replace }));
    if (key.kind === "story_line") return reply(await makeStoryLine(store, key, { example: authored, replace }));
    return reply(await makePicture(admin, store, key, { scene: authored, replace }));
  } catch (err) {
    console.error("word-asset error:", err);
    return reply({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

function served(asset: WordAsset, cached: boolean, replaced = false) {
  return { asset, url: asset.url, cached, stored: true, ...(replaced ? { replaced: true } : {}) };
}

async function makePicture(
  storage: AssetStorage,
  store: WordAssetClient,
  key: AssetKey,
  authored: { scene: string; replace: WordAsset | null },
): Promise<Record<string, unknown>> {
  // From the folded sense the key was built from, never the gloss as typed:
  // whatever the folding dropped is not in the key, so it must not be in the
  // picture every learner of the key is shown. The scene is the trusted
  // path's alone, and empty for everyone else.
  const prompt = inkPicturePrompt({ gloss: key.sense, dialect: key.dialect, scene: authored.scene || null });

  // One immediate re-ask, as the flashcard illustrator does: Gemini answers
  // with no image often enough on a first pass that asking again is cheaper
  // than sending the learner back to the button.
  let image: GeneratedImage | null = null;
  for (let attempt = 0; attempt < 2 && !image; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    image = await generateImage(prompt, {
      model: IMAGE_MODEL_IDS.GEMINI,
      size: "1024x1024",
      label: "word-asset",
    });
  }
  if (!image) {
    // The illustrator's graceful shape, so the dialog reads both alike.
    return {
      error: "IMAGE_GENERATION_FAILED",
      fallback: true,
      message: `Could not make a picture for "${key.sense}" — please try again.`,
    };
  }

  // How it was made, for whoever reviews the store later. Never who asked:
  // the table is public-read.
  const asset = {
    meta: {
      prompt,
      model: image.model,
      provider: image.provider,
      style: key.styleVersion,
      ...(authored.scene ? { scene: authored.scene } : {}),
    },
    source: authored.scene ? ("authored" as const) : ("generated" as const),
  };
  const filed = await fileNewAsset(
    storage,
    store,
    key,
    { bytes: image.bytes, contentType: image.contentType, extension: imageExtension(image.contentType) },
    asset,
    { replace: authored.replace },
  );
  if ("error" in filed) throw new Error(`Failed to upload picture: ${filed.error}`);

  let outcome: PutOutcome = filed.filed;
  // A learner missed at the same moment and filed theirs first. For a learner
  // that settles it; an authored scene takes its place, as it would have had
  // the learner been a second earlier.
  if (outcome.status === "taken" && outcome.asset && authored.scene && isReplaceable(outcome.asset)) {
    outcome = await replaceAsset(store, key, outcome.asset, { ...asset, url: filed.url });
  }

  // `authored` says the picture this call drew was drawn from the scene it
  // sent. The script checks it before writing a row, so a deployment that
  // does not know the trusted path is caught on the first word rather than
  // after every word has been drawn from its gloss.
  const made = authored.scene ? { authored: true } : {};
  if (outcome.status === "stored") return { ...served(outcome.asset, false), ...made };
  if (outcome.status === "replaced") return { ...served(outcome.asset, false, true), ...made };
  // Someone filed first (or, for a replacement, authored or approved theirs
  // in the meantime). Serve theirs, so every learner sees the same picture.
  if (outcome.status === "taken" && outcome.asset) return served(outcome.asset, true);
  // Not filed — the table not applied yet. The picture is still the caller's.
  return { asset: null, url: filed.url, cached: false, stored: false, ...made };
}

/**
 * What one text kind is written as: an exchange or a story passage. Both go
 * through `writeText`, so a passage is written, judged and filed exactly as an
 * exchange is; this is all that differs.
 */
interface TextKind<T> {
  purpose: string;
  prompt: string;
  tool: typeof DIALOGUE_TOOL | typeof STORY_LINE_TOOL;
  maxTokens: number;
  /** Why a draft is no question, for the critic; null when it is one. */
  gate: (parsed: unknown) => string | null;
  arabicTextPath: (parsed: unknown) => string;
  /** The usable asset in what the Brain shipped, or null. */
  read: (output: unknown) => T | null;
  /** Each line or sentence as the leak detector must see it. */
  scan: (value: T) => string[];
  payload: (value: T) => unknown;
  /** "line" or "passage", for the messages the caller is answered with. */
  noun: string;
  failedCode: string;
}

async function makeDialogue(
  store: WordAssetClient,
  key: AssetKey,
  authored: { example: string; replace: WordAsset | null },
): Promise<Record<string, unknown>> {
  // From the key, never from what the caller typed: the folded word and
  // sense, the dialect, and the trusted path's example alone.
  const word = keyWord(key);
  return writeText(store, key, authored, {
    purpose: "word_dialogue",
    prompt: dialoguePrompt({ word, sense: key.sense, dialect: key.dialect ?? "Gulf", example: authored.example || null }),
    tool: DIALOGUE_TOOL,
    maxTokens: 700,
    // A reply that does not use the word, or an opener that does, is no
    // question: the critic is sent back to fix exactly that.
    gate: (parsed) => dialogueProblem(parsed, word),
    arabicTextPath: dialogueArabic,
    read: (output) => asStoredDialogue(output, word),
    scan: dialogueLinesForScan,
    payload: (dialogue) => dialogue,
    noun: "line",
    failedCode: "DIALOGUE_GENERATION_FAILED",
  });
}

async function makeStoryLine(
  store: WordAssetClient,
  key: AssetKey,
  authored: { example: string; replace: WordAsset | null },
): Promise<Record<string, unknown>> {
  const word = keyWord(key);
  return writeText(store, key, authored, {
    purpose: "word_story_line",
    prompt: storyLinePrompt({ word, sense: key.sense, dialect: key.dialect ?? "Gulf", example: authored.example || null }),
    tool: STORY_LINE_TOOL,
    maxTokens: 700,
    // Two sentences, the word in one and said nowhere else: anything else is
    // no gap, and the critic is sent back to fix exactly that.
    gate: (parsed) => storyLineProblem(parsed, word),
    arabicTextPath: storyLineArabic,
    read: (output) => asStoredStoryLine(output, word),
    scan: storyLineSentencesForScan,
    payload: storyLinePayload,
    noun: "passage",
    failedCode: "STORY_LINE_GENERATION_FAILED",
  });
}

/**
 * Write a word's text through the Brain and file it, by the rules every text
 * kind keeps: the CONTENT lineup drafted and critiqued, the native-speaker
 * validator on the draft and on whatever is shipped, and filed only when every
 * line passes the leak detector with the rulebook's tokens and the validator
 * passed the shipped text. Anything that fails either is neither filed nor
 * served; one the validator could not judge at all is the paying learner's,
 * unfiled.
 */
async function writeText<T>(
  store: WordAssetClient,
  key: AssetKey,
  authored: { example: string; replace: WordAsset | null },
  spec: TextKind<T>,
): Promise<Record<string, unknown>> {
  const dialect = key.dialect ?? "Gulf";
  const failed = (message: string, error = spec.failedCode) => ({ error, fallback: true, message });
  const The = spec.noun === "line" ? "The line" : "The passage";

  let brain;
  try {
    brain = await askBrain<unknown>({
      purpose: spec.purpose,
      dialect,
      // No models[] override: the CONTENT lineup, drafted and critiqued.
      strategy: "draft_critic",
      userPrompt: spec.prompt,
      tool: spec.tool,
      maxTokens: spec.maxTokens,
      temperature: 0.7,
      budgetMs: DIALOGUE_BUDGET_MS,
      // The native-speaker validator reads the draft and orders a rewrite if
      // it is fusha in grammar or register, which the token detector is blind
      // to. A learner will say or hear this as a model of the dialect.
      enforceDialect: true,
      // And reads whatever is shipped when it did not already: the critic's
      // rewrite, or a draft whose budget left no room for the check above.
      validateDialect: true,
      qualityGate: (parsed) => spec.gate(parsed),
      arabicTextPath: spec.arabicTextPath,
    });
  } catch (err) {
    console.warn(`word-asset: the ${spec.noun} could not be written:`, err instanceof Error ? err.message : err);
    return failed(`Could not write a ${spec.noun} for "${key.sense}" right now.`);
  }

  const value = spec.read(brain.output);
  if (!value) return failed(`Could not write a ${spec.noun} that uses the word for "${key.sense}".`);

  // What the native reviewer made of the text that was shipped. A failed
  // one (a draft whose rewrite could not run, or a rewrite it failed too) is
  // not a model of the dialect: not filed and not served.
  const verdict = brain.validator?.ok === true ? brain.validator.verdict : null;
  if (verdict === "rewrite") {
    console.warn(`word-asset: not filed, the native reviewer asked for a rewrite (${brain.validator?.score}/5)`);
    return failed(`${The} did not read as the dialect.`, "dialect_rejected");
  }

  // Filed only when every line passes the leak detector exactly as the Brain
  // runs it, with the approved rulebook's forbidden tokens, as a shared
  // jingle's lyrics must. Nothing else is served either: the learner is about
  // to choose this, say it, or hear it as the dialect.
  await primeDialectPrompt(dialect);
  const leaks = spec.scan(value).flatMap((line) =>
    detectMsaLeaks(line, dialect, getDialectForbiddenTokens(dialect)).leaks
  );
  if (leaks.length > 0) {
    console.warn(`word-asset: not filed, MSA in the ${spec.noun}: ${leaks.join(", ")}`);
    return failed(`${The} was not in the dialect.`, "msa_leak");
  }

  const payload = spec.payload(value);
  // Filed only once the reviewer has passed it. When the reviewer could not
  // judge it at all (every validator leg down or out of time), it passed the
  // leak detector and the learner paid for it, so it is theirs for this
  // encounter — but it is not kept for anyone else.
  if (verdict !== "pass") {
    console.warn(`word-asset: not filed, the native reviewer could not judge the ${spec.noun}`);
    return { asset: null, url: null, payload, cached: false, stored: false, ...(authored.example ? { authored: true } : {}) };
  }

  // How it was made, for whoever reviews the store later. Never who asked:
  // the table is public-read.
  const asset: NewWordAsset = {
    payload,
    meta: {
      prompt: spec.prompt,
      models: brain.models,
      strategy: brain.strategy,
      style: key.styleVersion,
      dialect_score: brain.validator?.score ?? null,
      ...(authored.example ? { example: authored.example } : {}),
    },
    source: authored.example ? "authored" : "generated",
  };
  let outcome: PutOutcome = authored.replace
    ? await replaceAsset(store, key, authored.replace, asset)
    : await putAsset(store, key, asset);
  // A learner missed at the same moment and filed theirs first; an authored
  // example takes its place, as it would have a second earlier.
  if (outcome.status === "taken" && outcome.asset && authored.example && isReplaceable(outcome.asset)) {
    outcome = await replaceAsset(store, key, outcome.asset, asset);
  }

  const made = authored.example ? { authored: true } : {};
  if (outcome.status === "stored") return { ...served(outcome.asset, false), ...made };
  if (outcome.status === "replaced") return { ...served(outcome.asset, false, true), ...made };
  // Someone filed first: theirs, so every learner is asked the same text.
  if (outcome.status === "taken" && outcome.asset) return served(outcome.asset, true);
  // Not filed (a failure after the table was found): the caller paid for it,
  // so it is theirs for this encounter.
  return { asset: null, url: null, payload, cached: false, stored: false, ...made };
}

/**
 * File a passage taken from a published story (`findStoryPassage`): no model
 * call, nothing charged, `source: "reviewed"` since a person published it.
 * On the trusted path it takes the place of a written passage filed earlier
 * (`replace`); a learner's miss that lost a race to another's is served the
 * winner, so every learner hears the same passage.
 */
async function fileStoryPassage(
  store: WordAssetClient,
  key: AssetKey,
  passage: StoryPassage,
  replace: WordAsset | null,
): Promise<Record<string, unknown>> {
  const asset = storyPassageAsset(passage, key.styleVersion);
  const outcome: PutOutcome = replace ? await replaceAsset(store, key, replace, asset) : await putAsset(store, key, asset);
  if (outcome.status === "stored") return served(outcome.asset, false);
  if (outcome.status === "replaced") return served(outcome.asset, false, true);
  if (outcome.status === "taken" && outcome.asset) return served(outcome.asset, true);
  // Not filed (a failure after the table was found). It cost nothing, so the
  // caller is still asked from it.
  return { asset: null, url: null, payload: asset.payload, cached: false, stored: false };
}

/**
 * A clip of the key's action: a poster in the Ink picture style, then the
 * clip animated from it as its first and last frame, both filed under fresh
 * names in the `word-animations` bucket. Built from the key's action alone —
 * nothing the caller sent reaches either prompt — since every dialect's
 * learners of the action are shown it.
 *
 * What is filed is `source: "generated"`: there is no authored context for a
 * clip (a track word's scene is drawn for one dialect, and a clip is for all
 * three), and it is the trusted path that made it, never a learner's miss.
 */
async function makeAnimation(
  storage: AssetStorage,
  store: WordAssetClient,
  key: AssetKey,
): Promise<Record<string, unknown>> {
  const posterPrompt = inkAnimationPosterPrompt(key.sense);
  const prompt = inkAnimationPrompt(key.sense);
  const failed = (message: string, error = "ANIMATION_GENERATION_FAILED") => ({ error, fallback: true, message });
  // One deadline for the poster and the clip together: a render started
  // without the time to finish inside the worker's wall clock is billed and
  // lost, and paid for again on the next run.
  const deadline = Date.now() + ANIMATION_BUDGET_MS;
  const left = () => deadline - Date.now();

  // The poster, with the picture path's one re-ask, so long as a re-ask still
  // leaves the clip the time it needs.
  let poster: GeneratedImage | null = null;
  for (let attempt = 0; attempt < 2 && !poster; attempt++) {
    const posterBudget = Math.min(POSTER_TIMEOUT_MS, left() - FILING_RESERVE_MS - VIDEO_MIN_ROUTE_MS);
    if (posterBudget < 10_000) break;
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    poster = await generateImage(posterPrompt, {
      model: IMAGE_MODEL_IDS.GEMINI,
      aspectRatio: ANIMATION_ASPECT,
      timeoutMs: posterBudget,
      label: "word-asset animation poster",
    }).catch(() => null);
  }
  if (!poster) return failed(`Could not draw the still for "${key.sense}".`, "ANIMATION_POSTER_FAILED");

  // Uploaded before the clip is asked for: OpenRouter fetches its frames by
  // URL, and the poster is part of what is filed.
  const posterFile = await uploadNewFile(storage, key, {
    bytes: poster.bytes,
    contentType: poster.contentType,
    extension: imageExtension(poster.contentType),
  });
  if ("error" in posterFile) throw new Error(`Failed to upload the poster: ${posterFile.error}`);

  const frame: VideoFrame = { bytes: poster.bytes, contentType: poster.contentType, url: posterFile.url };
  const clip = await generateVideo(prompt, {
    model: VIDEO_MODEL_IDS.VEO_LITE,
    durationSeconds: ANIMATION_SECONDS,
    aspectRatio: ANIMATION_ASPECT,
    resolution: ANIMATION_RESOLUTION,
    firstFrame: frame,
    lastFrame: frame,
    // What is left of the deadline, less the time to file what comes back.
    timeoutMs: Math.max(0, left() - FILING_RESERVE_MS),
    label: "word-asset animation",
  });
  if (!clip) return failed(`Could not animate "${key.sense}" right now.`);
  // The bucket takes MP4s of a clip's size and nothing else. Read off the
  // bytes, not a header a provider sets: the gateway already refused anything
  // else, and this is the last look before an upload the bucket would refuse.
  if (!isMp4(clip.bytes)) return failed("The clip that came back is not an MP4.", "ANIMATION_NOT_MP4");
  if (clip.bytes.length > MAX_ANIMATION_BYTES) return failed("The clip came back larger than any loop should be.", "ANIMATION_TOO_LARGE");

  const payload: AnimationPayload = { poster: posterFile.url, seconds: ANIMATION_SECONDS, aspect: ANIMATION_ASPECT };
  const filed = await fileNewAsset(
    storage,
    store,
    key,
    { bytes: clip.bytes, contentType: "video/mp4", extension: "mp4" },
    {
      payload,
      // How it was made, for whoever reviews the store later. Never who asked:
      // the table is public-read.
      meta: {
        prompt,
        poster_prompt: posterPrompt,
        model: clip.model,
        provider: clip.provider,
        poster_model: poster.model,
        poster_provider: poster.provider,
        style: key.styleVersion,
      },
      source: "generated",
    },
  );
  if ("error" in filed) throw new Error(`Failed to upload the clip: ${filed.error}`);

  const outcome = filed.filed;
  if (outcome.status === "stored") return served(outcome.asset, false);
  // Someone filed one first (a second run at the same moment): theirs, so
  // every learner sees the same clip.
  if (outcome.status === "taken" && outcome.asset) return served(outcome.asset, true);
  // Not filed although the table was there a moment ago. Paid for, so the
  // caller is handed it, and the log says it is not kept.
  console.warn(`word-asset: the clip for "${key.sense}" was made but not filed`);
  return { asset: null, url: filed.url, payload, cached: false, stored: false };
}
