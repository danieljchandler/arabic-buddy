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
 * `ensure` makes two kinds:
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
 *   (`word_not_in_dialect`), since no exchange using it could be filed.
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
 *   refused, and that caller is charged as the learner they are;
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
 * Response: { asset, url, cached, stored, payload?, replaced?, authored? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap, resolveUserId } from "../_shared/usageCap.ts";
import { generateImage, hasAnyProvider, imageExtension, type GeneratedImage } from "../_shared/aiGateway.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { getDialectForbiddenTokens, primeDialectPrompt } from "../_shared/dialectHelpers.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";
import { IMAGE_MODEL_IDS } from "../_shared/modelRegistry.ts";
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
 */
const CAPS = {
  image: { key: "generate-flashcard-image", free: 20, tiers: { standard: 60, allin: 200 } },
  dialogue: { key: "word-asset-dialogue", free: 30, tiers: { standard: 100, allin: 300 } },
} as const;

type EnsurableKind = keyof typeof CAPS;

const isEnsurable = (kind: string): kind is EnsurableKind => kind in CAPS;

/**
 * The Brain's wall-clock budget for one exchange. The quiz waits for it only
 * as long as `DIALOGUE_WRITING_WAIT_MS` and asks its fallback past that, so
 * this bounds the spend, not the learner's wait.
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
    : kind === "dialogue"
    ? authoredExample(text(body.example), text(body.word))
    : "";
  let authored = "";
  if (sentContext) {
    if (viaServiceRole) {
      authored = sentContext;
    } else {
      const staff = await requireRole(req, CONTENT_MANAGER_ROLES, corsHeaders, { allowServiceRole: false });
      if (!staff.denied) {
        authored = sentContext;
        // The table is public-read, so who authored an asset is not in it.
        // The function log is where a staff member's uncapped draw is kept.
        console.log(
          `word-asset: ${kind === "image" ? "scene" : "example"} authored by staff ${staff.userId} for "${text(body.gloss).trim().slice(0, MAX_GLOSS_LENGTH)}"`,
        );
      }
    }
  }
  // Trusted: nobody's allowance pays for it. A staff member without authored
  // context is asking for their own word's asset, as a learner does.
  const trusted = viaServiceRole || authored !== "";

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
  if (!hasAnyProvider()) {
    return reply(
      {
        error: "ai_unconfigured",
        fallback: true,
        message: key.kind === "image"
          ? "Image generation is not configured right now."
          : "Text generation is not configured right now.",
      },
      503,
    );
  }
  // A picture lands on the learner's own row whether or not the store keeps
  // it. An exchange has nowhere else to live: made while the table is not
  // there, it would be made, and charged, again at every encounter.
  if (key.kind === "dialogue" && missingTable) {
    return reply(
      { error: "store_not_ready", fallback: true, message: "Dialogues cannot be kept yet, so none is made." },
      503,
    );
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

  // Charged only now, on the miss, and only to a learner, on the kind's own
  // counter.
  if (!trusted) {
    const cap = CAPS[key.kind];
    const limited = await enforceDailyCap(req, cap.key, cap.free, corsHeaders, cap.tiers);
    if (limited.limited) return limited.response;
  }

  try {
    if (key.kind === "dialogue") return reply(await makeDialogue(store, key, { example: authored, replace }));
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

async function makeDialogue(
  store: WordAssetClient,
  key: AssetKey,
  authored: { example: string; replace: WordAsset | null },
): Promise<Record<string, unknown>> {
  // From the key, never from what the caller typed: the folded word and
  // sense, the dialect, and the trusted path's example alone.
  const word = keyWord(key);
  const dialect = key.dialect ?? "Gulf";
  const prompt = dialoguePrompt({ word, sense: key.sense, dialect, example: authored.example || null });
  const failed = (message: string, error = "DIALOGUE_GENERATION_FAILED") => ({ error, fallback: true, message });

  let brain;
  try {
    brain = await askBrain<unknown>({
      purpose: "word_dialogue",
      dialect,
      // No models[] override: the CONTENT lineup, drafted and critiqued.
      strategy: "draft_critic",
      userPrompt: prompt,
      tool: DIALOGUE_TOOL,
      maxTokens: 700,
      temperature: 0.7,
      budgetMs: DIALOGUE_BUDGET_MS,
      // The native-speaker validator reads the draft and orders a rewrite if
      // it is fusha in grammar or register, which the token detector is blind
      // to. A learner will say this line as a model of the dialect.
      enforceDialect: true,
      // And reads whatever is shipped when it did not already: the critic's
      // rewrite, or a draft whose budget left no room for the check above.
      validateDialect: true,
      // A reply that does not use the word, or an opener that does, is no
      // question: the critic is sent back to fix exactly that.
      qualityGate: (parsed) => dialogueProblem(parsed, word),
      arabicTextPath: dialogueArabic,
    });
  } catch (err) {
    console.warn("word-asset: the exchange could not be written:", err instanceof Error ? err.message : err);
    return failed(`Could not write a line for "${key.sense}" right now.`);
  }

  const dialogue = asStoredDialogue(brain.output, word);
  if (!dialogue) return failed(`Could not write a line that uses the word for "${key.sense}".`);

  // What the native reviewer made of the text that was shipped. A failed
  // one (a draft whose rewrite could not run, or a rewrite it failed too) is
  // not a model of the dialect: not filed and not served.
  const verdict = brain.validator?.ok === true ? brain.validator.verdict : null;
  if (verdict === "rewrite") {
    console.warn(`word-asset: not filed, the native reviewer asked for a rewrite (${brain.validator?.score}/5)`);
    return failed("The line did not read as the dialect.", "dialect_rejected");
  }

  // Filed only when every line passes the leak detector exactly as the Brain
  // runs it, with the approved rulebook's forbidden tokens, as a shared
  // jingle's lyrics must. Nothing else is served either: the learner is about
  // to choose this reply, or say it.
  await primeDialectPrompt(dialect);
  const leaks = dialogueLinesForScan(dialogue).flatMap((line) =>
    detectMsaLeaks(line, dialect, getDialectForbiddenTokens(dialect)).leaks
  );
  if (leaks.length > 0) {
    console.warn(`word-asset: not filed, MSA in the exchange: ${leaks.join(", ")}`);
    return failed("The line was not in the dialect.", "msa_leak");
  }

  // Filed only once the reviewer has passed it. When the reviewer could not
  // judge it at all (every validator leg down or out of time), it passed the
  // leak detector and the learner paid for it, so it is theirs for this
  // encounter — but it is not kept for anyone else.
  if (verdict !== "pass") {
    console.warn("word-asset: not filed, the native reviewer could not judge the exchange");
    return { asset: null, url: null, payload: dialogue, cached: false, stored: false, ...(authored.example ? { authored: true } : {}) };
  }

  // How it was made, for whoever reviews the store later. Never who asked:
  // the table is public-read.
  const asset: NewWordAsset = {
    payload: dialogue,
    meta: {
      prompt,
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
  // Someone filed first: theirs, so every learner is asked the same exchange.
  if (outcome.status === "taken" && outcome.asset) return served(outcome.asset, true);
  // Not filed (a failure after the table was found): the caller paid for it,
  // so it is theirs for this encounter.
  return { asset: null, url: null, payload: dialogue, cached: false, stored: false, ...made };
}
