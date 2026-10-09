/**
 * generate-word-jingle — a short sung mnemonic for a word.
 *
 * With `share: true` the jingle is a shared asset (`_shared/wordAssets.ts`):
 * a word, sense and dialect another learner already has a jingle for is served
 * that one — no lyric call, no Lyria call, nothing charged — and a new one is
 * stored in the public bucket and filed for the next learner, provided its
 * lyrics pass the Brain's MSA leak detector. Nothing the store holds is Fusha.
 * The answer then carries `audioUrl`, and the caller copies it onto its own
 * row instead of uploading. A regeneration leaves `share` off: the learner
 * asked for a different jingle, not the one everybody has.
 *
 * `share` is opt-in rather than the default so a client still running an
 * older bundle never receives a hit it cannot read: a hit carries a url and
 * no audio bytes.
 *
 * Until the store's migration is applied the lookup misses and the filing
 * fails quietly; a shared jingle is still uploaded under a name of its own
 * and handed back as `audioUrl`, which the caller stores exactly as it would
 * have stored its own upload.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getDialectLabel, getDialectVocabRules } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap, resolveUserId } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getJingleStyleLine } from "../_shared/jingleStyles.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { chatFetch, hasAnyProvider } from "../_shared/aiGateway.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";
import {
  ASSET_BUCKETS,
  assetKey,
  assetObjectPath,
  getAsset,
  putAsset,
  type AssetKey,
  type WordAssetClient,
} from "../_shared/wordAssets.ts";

/** A gloss longer than this is a note; it can still be sung, but not shared. */
const MAX_SHARED_GLOSS_LENGTH = 80;

/** The lyrics a stored jingle was sung from. */
function storedLyrics(payload: unknown): string | null {
  const lyrics = (payload as { lyrics?: unknown } | null)?.lyrics;
  return typeof lyrics === "string" && lyrics ? lyrics : null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Who is asking comes first. The daily cap below turns anonymous callers
  // away too, but it also charges, and a shared hit costs nothing, so the cap
  // waits until there is something to pay for.
  if (!(await resolveUserId(req))) {
    return new Response(
      JSON.stringify({ error: "auth_required", message: "Please sign in to use this feature." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { word_arabic, word_english, dialect = "Gulf", share = false } = await req.json();

    if (!word_arabic || !word_english) {
      return new Response(
        JSON.stringify({ error: "word_arabic and word_english are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The shared path: the same word, sense and dialect already sung for
    // another learner is served as it is.
    const key = share === true && String(word_english).length <= MAX_SHARED_GLOSS_LENGTH
      ? assetKey({ kind: "jingle", word: String(word_arabic), gloss: String(word_english), dialect })
      : null;
    const admin = key
      ? createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      : null;
    const store = admin as unknown as WordAssetClient | null;
    if (key && store) {
      const stored = await getAsset(store, key);
      if (stored?.url) {
        return new Response(
          JSON.stringify({ audioUrl: stored.url, lyrics: storedLyrics(stored.payload), cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Free-tier daily cap: 5 jingle generations / user / day (Lyria is expensive).
    // Music generation (Lyria) costs real money per call. The free allowance
    // comes down from 50 — which was uncapped-in-practice — and paid tiers get
    // a ladder instead of a bypass.
    const cap = await enforceDailyCap(req, "generate-word-jingle", 15, corsHeaders, {
      standard: 40,
      allin: 120,
    });
    if (cap.limited) return cap.response;

    // Two legs, two keys: the lyric/prompt model routes through aiGateway,
    // while Lyria (the music model) has no route but Google's own API.
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!hasAnyProvider()) {
      return new Response(
        JSON.stringify({ error: "No AI provider configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Generate a dialect-specific music prompt
    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const dialectStyle = getJingleStyleLine(dialect);

    const promptGenResponse = await chatFetch(
      MODEL_IDS.GEMINI_FAST,
      {
          messages: [
            {
              role: "system",
              content: `You are a creative music director for Arabic educational jingles.

${dialectRules}

Return STRICT JSON only (no markdown fences, no commentary), shape:
{
  "lyrics": "<the actual sung lyrics in ${dialectLabel} Arabic with full tashkeel (harakat). 2-4 short lines. Repeat the target word at least 3 times. A tiny bit of simple English is OK if it helps the hook.>",
  "prompt": "<English music-generation prompt for a 10-second jingle in this exact musical style: ${dialectStyle}, describe mood, tempo, voices, instrumentation. Emphasize that the lyrics above must be sung clearly and prominently.>"
}

STRICT SAFETY RULES (the music model has a strict safety filter — violations cause generation to fail):
- NEVER mention violence, war, weapons, captivity, prison, oppression, blood, death, hate, politics, religion, romance, alcohol, drugs, body parts, or anything explicit.
- Even if the target word literally means something heavy (e.g. "captivity", "kill", "fight"), express it in a soft, abstract, child-friendly way.
- Lyrics must be cheerful, wholesome, suitable for a children's TV show.
- Use happy imagery: sunshine, friends, dancing, colors, markets, food, nature.`,
            },
            {
              role: "user",
              content: `Create a wholesome 10-second jingle that teaches the ${dialectLabel} word "${word_arabic}" (meaning "${word_english}"). Arabic must include tashkeel. Return JSON only.`,
            },
          ],
          response_format: { type: "json_object" },
      },
      { label: "generate-word-jingle" },
    );

    if (!promptGenResponse.ok) {
      const status = promptGenResponse.status;
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({ error: status === 429 ? "Rate limited, try again later" : "Credits exhausted" }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await promptGenResponse.text();
      console.error("Prompt generation error:", status, errText);
      return new Response(
        JSON.stringify({ error: "Failed to generate music prompt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const promptData = await promptGenResponse.json();
    const rawContent: string = promptData.choices?.[0]?.message?.content?.trim() ?? "";
    let lyrics = "";
    let stylePrompt = "";
    try {
      const cleaned = rawContent.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      lyrics = String(parsed.lyrics || "").trim();
      stylePrompt = String(parsed.prompt || "").trim();
    } catch (err) {
      console.warn("Failed to parse jingle JSON, using raw content as prompt:", err);
      stylePrompt = rawContent;
    }

    const musicPrompt = lyrics
      ? `${stylePrompt}\n\nLyrics to sing clearly (${dialectLabel} Arabic with tashkeel):\n${lyrics}`
      : stylePrompt;

    if (!musicPrompt) {
      return new Response(
        JSON.stringify({ error: "Empty music prompt generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generated music prompt:", musicPrompt);

    // Step 2: Call Google Lyria 3 Clip to generate the actual song
    const callLyria = async (text: string) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ["AUDIO"] },
          }),
        },
      );

    const safeFallbackPrompt = `A cheerful, family-friendly 10-second ${dialectLabel} children's jingle. ${dialectStyle}. A happy group of kids sings the Arabic word "${word_arabic}" three times in a playful, sing-song way over bright, bouncy percussion and a simple melodic hook. Sunny, wholesome, market-day vibe. No lyrics other than the repeated Arabic word and gentle "la la la" vocables.`;

    let lyriaResponse = await callLyria(musicPrompt);
    // The safe fallback sings only the word, so the lyrics written above are
    // not what is heard and the clip is not shared under them.
    let sungFromFallback = false;
    let lyriaData: any = null;
    let audioPart: any = null;

    const extractAudio = (data: any) =>
      data?.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("audio/"),
      );

    if (lyriaResponse.ok) {
      lyriaData = await lyriaResponse.json();
      audioPart = extractAudio(lyriaData);
    }

    // If blocked by safety filter (or any other "no audio") — retry once with safe prompt.
    if (!audioPart?.inlineData?.data) {
      const blockReason = lyriaData?.promptFeedback?.blockReason;
      const statusText = lyriaResponse.ok ? `no-audio (${blockReason ?? "unknown"})` : `http ${lyriaResponse.status}`;
      console.warn("Lyria first attempt failed:", statusText, "— retrying with safe fallback prompt.");

      if (!lyriaResponse.ok) {
        const status = lyriaResponse.status;
        const errText = await lyriaResponse.text().catch(() => "");
        console.error("Lyria error body:", status, errText);
        if (status === 429) {
          return new Response(
            JSON.stringify({ error: "Music generation rate limited, try again later" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (status === 402) {
          return new Response(
            JSON.stringify({ error: "Music generation credits exhausted" }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      sungFromFallback = true;
      lyriaResponse = await callLyria(safeFallbackPrompt);
      if (!lyriaResponse.ok) {
        const errText = await lyriaResponse.text().catch(() => "");
        console.error("Lyria fallback error:", lyriaResponse.status, errText);
        return new Response(
          JSON.stringify({ error: "Music generation was blocked by safety filter. Try a different word." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      lyriaData = await lyriaResponse.json();
      audioPart = extractAudio(lyriaData);
    }

    if (!audioPart?.inlineData?.data) {
      console.error("No audio in Lyria response (after retry):", JSON.stringify(lyriaData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Music generation was blocked by safety filter. Try a different word." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Decode base64 to binary
    const audioBytes = Uint8Array.from(
      atob(audioPart.inlineData.data),
      (c) => c.charCodeAt(0)
    );
    const mimeType: string = audioPart.inlineData.mimeType || "audio/L16;rate=48000";
    console.log("Lyria mime:", mimeType, "bytes:", audioBytes.length);

    // Return JSON/base64 instead of raw binary. supabase.functions.invoke can
    // coerce raw MP3 bytes through UTF-8 in some environments, which corrupts
    // the file into white noise. Base64 preserves the audio exactly.
    let outBytes = audioBytes;
    let outMime = mimeType;
    if (/^audio\/(l16|pcm)/i.test(mimeType)) {
      const rateMatch = mimeType.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 48000;
      const pcmBytes = audioBytes;
      const channels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * channels * bitsPerSample / 8;
      const blockAlign = channels * bitsPerSample / 8;
      const dataSize = pcmBytes.length - (pcmBytes.length % 2);
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeStr(36, "data");
      view.setUint32(40, dataSize, true);
      new Uint8Array(buffer, 44).set(pcmBytes.slice(0, dataSize));
      outBytes = new Uint8Array(buffer);
      outMime = "audio/wav";
    }

    let audioBase64 = "";
    for (let i = 0; i < outBytes.length; i += 0x8000) {
      audioBase64 += String.fromCharCode(...outBytes.subarray(i, i + 0x8000));
    }

    const extension = outMime.includes("mpeg") || outMime.includes("mp3") ? "mp3" : "wav";

    // Shared only when what is heard is what was written and checked: lyrics
    // the leak detector passes, sung from those lyrics.
    let audioUrl: string | null = null;
    if (key && admin && store && lyrics && !sungFromFallback) {
      const leaks = detectMsaLeaks(lyrics, key.dialect ?? "Gulf").leaks;
      if (leaks.length === 0) {
        audioUrl = await shareJingle(admin, store, key, outBytes, outMime, extension, lyrics, musicPrompt);
      } else {
        console.warn(`generate-word-jingle: not shared, MSA in the lyrics: ${leaks.join(", ")}`);
      }
    }

    return new Response(JSON.stringify({
      audioBase64: btoa(audioBase64),
      mimeType: outMime,
      extension,
      lyrics: lyrics || null,
      ...(audioUrl ? { audioUrl, cached: false } : {}),
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error("generate-word-jingle error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/** The slice of the service-role client the upload needs. */
interface JingleStorage {
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

/**
 * Upload a new jingle under a name of its own and file it for the next
 * learner. Returns the url of what this learner was sung, or null when the
 * upload failed (the caller then uploads its own copy, as it always did).
 * Filing can fail — the table not yet applied, or another learner filing
 * first — without changing what this learner is handed.
 */
async function shareJingle(
  admin: JingleStorage,
  store: WordAssetClient,
  key: AssetKey,
  bytes: Uint8Array,
  contentType: string,
  extension: string,
  lyrics: string,
  musicPrompt: string,
): Promise<string | null> {
  try {
    const bucket = ASSET_BUCKETS.jingle as string;
    const path = await assetObjectPath(key, extension);
    const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
    if (error) {
      console.warn(`generate-word-jingle: shared upload failed: ${error.message}`);
      return null;
    }
    const url = admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    await putAsset(store, key, {
      url,
      payload: { lyrics },
      meta: { prompt: musicPrompt, lyric_model: MODEL_IDS.GEMINI_FAST },
    });
    return url;
  } catch (err) {
    console.warn(`generate-word-jingle: not shared: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
