/**
 * persist-word-audio
 *
 * Caches a synthesised pronunciation onto a shared curriculum word.
 *
 * The personal deck can do this from the client: a learner owns their
 * `user_vocabulary` rows, so useAzureTTS's `persist` callback uploads the blob
 * and stamps `word_audio_url` directly (see MyWordsReview). `vocabulary_words`
 * is admin/recorder-write only (migration 20260704051941), so the same trick
 * can't work for the curriculum deck — which meant the new audio-first card
 * would re-synthesise the same word on every single review, for every learner.
 *
 * So the write happens here, under the service role. This is not a privilege
 * escalation dressed up as a cache: the only thing a caller can do is attach
 * audio to a word that already exists, only when that word has none, and the
 * audio must be of the word's own text (we synthesise it here rather than
 * accepting an uploaded blob, so a caller can't attach arbitrary audio to a
 * shared row).
 *
 * The shared asset store (`_shared/wordAssets.ts`) is looked up before
 * synthesising: one word turns up on several curriculum rows (a Stage 1 word
 * revisited in a later lesson, an imported lesson repeating an authored one),
 * and a row whose exact text — harakat included — already has a recording in
 * its dialect's voice gets that one copied onto it rather than a second
 * synthesis. What is synthesised is filed there for the next row, under a
 * name of its own that nothing ever writes over. Re-synthesising identical
 * text in the same voice would give the same recording, so a hit is not a
 * stale answer: to change how a word is said, upload a recording or change
 * its text (re-vowelling it is a different key). Until the store's migration
 * is applied the lookup misses and the filing fails quietly, which is this
 * function as it was before.
 *
 * Body: { wordId: string, dialect?: string }
 * Response: { audioUrl: string, cached: boolean }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { synthesizeForDialect } from "../_shared/ttsVoiceRouting.ts";
import { assetKey, fileNewAsset, getAsset, type WordAssetClient } from "../_shared/wordAssets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "flashcard-audio";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Generous cap: the whole point is that each word is synthesised once ever,
  // so a learner should never approach this in normal use.
  const cap = await enforceDailyCap(req, "persist-word-audio", 200, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { wordId, dialect } = await req.json();
    if (!wordId || typeof wordId !== "string") {
      return new Response(JSON.stringify({ error: "wordId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Only fill an empty slot — never overwrite a recording an admin uploaded.
    const fillEmptySlot = async (audioUrl: string) => {
      const { error } = await admin
        .from("vocabulary_words")
        .update({ audio_url: audioUrl })
        .eq("id", wordId)
        .is("audio_url", null);
      if (error) throw error;
    };

    const { data: word, error: wordErr } = await admin
      .from("vocabulary_words")
      .select("id, word_arabic, audio_url, dialect_module")
      .eq("id", wordId)
      .maybeSingle();

    if (wordErr) throw wordErr;
    if (!word) {
      return new Response(JSON.stringify({ error: "word not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already cached — another learner (or an earlier session) got there first.
    if (word.audio_url) {
      return new Response(JSON.stringify({ audioUrl: word.audio_url, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const voicedIn = dialect || word.dialect_module;
    const store = admin as unknown as WordAssetClient;
    const key = assetKey({ kind: "word_audio", word: word.word_arabic, dialect: voicedIn });

    // The same text recorded in the same voice for another row: copy it on.
    const stored = key ? await getAsset(store, key) : null;
    if (stored?.url) {
      await fillEmptySlot(stored.url);
      return new Response(JSON.stringify({ audioUrl: stored.url, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Synthesise here rather than accepting a client-uploaded blob: the row is
    // shared across every learner, so its audio must provably be this word.
    //
    // In-process rather than over HTTP to azure-tts. That hop had to forward the
    // caller's Authorization header, because azure-tts gates on a daily cap that
    // resolves a *user* and a service-role key has none — so a service-role call
    // failed 401 auth_required → tts_failed. Calling the router directly removes
    // the second cap check along with the workaround.
    let audio: Uint8Array;
    let plan;
    try {
      ({ bytes: audio, plan } = await synthesizeForDialect(
        word.word_arabic,
        voicedIn,
        { minVoices: 1 },
      ));
    } catch (ttsErr) {
      console.error("persist-word-audio: TTS failed", ttsErr);
      return new Response(JSON.stringify({ error: "tts_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extension and content type follow the provider. Munsit answers in WAV, so
    // hardcoding .mp3/audio/mpeg here would store WAV bytes under an .mp3 name
    // and serve them mislabelled.
    let audioUrl: string;
    if (key) {
      // A fresh object, filed for the next row with this text. Filing never
      // fails the request: the row gets this recording either way.
      const filed = await fileNewAsset(
        admin,
        store,
        key,
        { bytes: audio, contentType: plan.contentType, extension: plan.ext },
        { meta: { provider: plan.provider, voice: plan.voices[0] ?? null, content_type: plan.contentType } },
      );
      if ("error" in filed) throw new Error(filed.error);
      audioUrl = filed.url;
    } else {
      // A word the store cannot key (no Arabic letter in it): the row's own
      // object, as before the store.
      const path = `curriculum/word-${wordId}.${plan.ext}`;
      const { error: uploadErr } = await admin.storage
        .from(BUCKET)
        .upload(path, audio, { contentType: plan.contentType, upsert: true });
      if (uploadErr) throw uploadErr;
      audioUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }

    await fillEmptySlot(audioUrl);

    return new Response(JSON.stringify({ audioUrl, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("persist-word-audio error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
