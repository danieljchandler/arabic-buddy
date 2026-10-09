/**
 * word-asset — the door to the shared asset store (quiz Phase 2).
 *
 * Two actions, both keyed on a word rather than on the caller:
 *
 * - `get`: the asset filed under a word, kind and dialect in the current
 *   style, or null. Costs nothing.
 * - `ensure`: get, else make it, file it, and return it. Only a miss calls a
 *   model, and only a miss is charged — to the caller who missed, on the same
 *   daily image budget the flashcard illustrator draws on, so routing the
 *   picture dialog through here does not hand anyone a second allowance.
 *
 * Today `ensure` makes pictures (`kind: "image"`), in the Ink style and from
 * nothing but the word's sense and dialect (`inkPicturePrompt`). Nothing else
 * a learner sends reaches the prompt: the first learner to miss decides what
 * every later learner is shown, so they must not be able to decide anything
 * beyond the word. The later phases add their kinds here (dialogue, story
 * lines, animations) as they are built.
 *
 * The trusted path (quiz Phase 3) is the one exception, and it is not a
 * learner's: a call made with the service-role key (`isServiceRoleCall` —
 * `scripts/curriculum-pictures.ts`, filling the curriculum's pictures) or by
 * the content team (`requireRole`, read from `user_roles`) may send `scene`,
 * a track word's authored `image_scene`, which becomes the `scene` argument
 * of `inkPicturePrompt`. Three things follow from who is asking:
 *
 * - nothing is charged. There is no learner to charge under the service
 *   role, and an authored picture is the catalogue's, not a staff member's
 *   own allowance. A `scene` from anyone else is ignored, not refused, and
 *   that caller is charged as the learner they are;
 * - what it files is `source: "authored"`, with the scene in `meta`;
 * - it replaces a picture a learner's miss filed first under the same key
 *   (curriculum and learners share keys: a curriculum word's sense is its
 *   `word_english`). `isReplaceable` in `_shared/wordAssets.ts` is the rule:
 *   only an unapproved `generated` asset gives way, so an authored, reviewed
 *   or approved one is a hit like any other and a re-run costs nothing. The
 *   old file stays where it is, so a learner whose own row carries it keeps
 *   the picture they were given.
 *
 * Writes run under the service role, which is the point of the function: the
 * table is public-read and service-write, so a learner reaches a shared row
 * only through a generation this function made.
 *
 * Until the migration is applied to the live project every lookup misses and
 * every store fails quietly: `get` answers null and `ensure` makes the picture
 * anyway and returns it unfiled (`stored: false`), which is what the dialog
 * did before the store existed.
 *
 * Body: { action: "get" | "ensure", kind, word, gloss?, dialect?, scene? }
 * Response: { asset, url, cached, stored, replaced? }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap, resolveUserId } from "../_shared/usageCap.ts";
import { generateImage, hasAnyProvider, imageExtension, type GeneratedImage } from "../_shared/aiGateway.ts";
import { IMAGE_MODEL_IDS } from "../_shared/modelRegistry.ts";
import { CONTENT_MANAGER_ROLES, isServiceRoleCall, requireRole } from "../_shared/requireRole.ts";
import {
  assetKey,
  fileNewAsset,
  getAsset,
  inkPicturePrompt,
  isReplaceable,
  kindNeedsSense,
  MAX_SCENE_LENGTH,
  normaliseGloss,
  replaceAsset,
  type AssetKey,
  type AssetStorage,
  type PutOutcome,
  type WordAsset,
  type WordAssetClient,
} from "../_shared/wordAssets.ts";

/** The kinds `ensure` can make today. */
const ENSURABLE_KINDS = new Set<string>(["image"]);

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

  // An authored scene, honoured only from a trusted caller. The role is read
  // only when a scene was sent, so an ordinary call costs no extra lookup; a
  // learner who sends one is not refused — their scene is simply not heard,
  // and they go on as the learner they are.
  const sentScene = text(body.scene).replace(/\s+/g, " ").trim().slice(0, MAX_SCENE_LENGTH);
  let scene = "";
  if (sentScene) {
    if (viaServiceRole) {
      scene = sentScene;
    } else {
      const staff = await requireRole(req, CONTENT_MANAGER_ROLES, corsHeaders, { allowServiceRole: false });
      if (!staff.denied) scene = sentScene;
    }
  }
  // Trusted: nobody's allowance pays for it. A staff member without a scene
  // is asking for their own word's picture, as a learner does.
  const trusted = viaServiceRole || scene !== "";

  const gloss = text(body.gloss).trim();
  if (gloss.length > MAX_GLOSS_LENGTH) {
    return reply({ error: "gloss_too_long", message: `gloss is limited to ${MAX_GLOSS_LENGTH} characters` }, 400);
  }

  // Checked on the folded sense, not the gloss as typed: a gloss of nothing
  // but emoji or punctuation folds to nothing, and a picture keyed without a
  // meaning is exactly what lets one homograph borrow another's.
  const kind = text(body.kind);
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

  const found = await getAsset(store, key);
  if (action === "get") {
    return reply(found ? served(found, true) : { asset: null, url: null, cached: false, stored: false });
  }
  // An authored scene takes the place of a picture drawn from the gloss
  // alone; everything else that is filed is a hit, for everyone.
  const replace = found && scene && isReplaceable(found) ? found : null;
  if (found && !replace) return reply(served(found, true));

  // ── ensure, on a miss ─────────────────────────────────────────────────────
  if (!ENSURABLE_KINDS.has(key.kind)) {
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
        message: "Image generation is not configured right now.",
      },
      503,
    );
  }

  // Charged only now, on the miss, and only to a learner. The key is the
  // flashcard illustrator's, so the dialog's two paths share one daily
  // allowance of pictures.
  if (!trusted) {
    const cap = await enforceDailyCap(req, "generate-flashcard-image", 20, corsHeaders, {
      standard: 60,
      allin: 200,
    });
    if (cap.limited) return cap.response;
  }

  try {
    return reply(await makePicture(admin, store, key, { scene, replace }));
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

  if (outcome.status === "stored") return served(outcome.asset, false);
  if (outcome.status === "replaced") return served(outcome.asset, false, true);
  // Someone filed first (or, for a replacement, authored or approved theirs
  // in the meantime). Serve theirs, so every learner sees the same picture.
  if (outcome.status === "taken" && outcome.asset) return served(outcome.asset, true);
  // Not filed — the table not applied yet. The picture is still the caller's.
  return { asset: null, url: filed.url, cached: false, stored: false };
}
