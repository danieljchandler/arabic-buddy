import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectVocabRules } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getJingleStyleLine } from "../_shared/jingleStyles.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { chatFetch, hasAnyProvider } from "../_shared/aiGateway.ts";
import {
  buildFallbackMusicPrompt,
  buildLyricPrompt,
  buildMusicPrompt,
  parseLyricPlan,
  parseAchievement,
  pcmToWav,
  sampleRateFromMime,
  sanitizeSingerName,
} from "../_shared/celebrationSongCore.ts";

const DIALECTS = ["Gulf", "Egyptian", "Yemeni"];

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // A celebration song is a full Lyria generation plus a lyric call, and it is
  // a treat rather than a study tool, so the allowance is tighter than the
  // word jingle's.
  const cap = await enforceDailyCap(req, "generate-celebration-song", 3, corsHeaders, {
    standard: 10,
    allin: 30,
  });
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const name = sanitizeSingerName(body?.name);
    const achievement = parseAchievement(body?.achievement);
    if (!name || !achievement) {
      return reply({ error: "A name and a known achievement are required" }, 400);
    }
    const dialect = DIALECTS.includes(body?.dialect) ? body.dialect : "Gulf";

    // Two legs, two keys: the lyric writer routes through aiGateway, while
    // Lyria has no route but Google's own API. Both are checked before either
    // is called so a half-configured deployment fails before paying.
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!hasAnyProvider()) return reply({ error: "No AI provider configured" }, 500);
    if (!GEMINI_API_KEY) return reply({ error: "GEMINI_API_KEY not configured" }, 500);

    const dialectLabel = getDialectLabel(dialect);
    const styleLine = getJingleStyleLine(dialect);
    const prompt = buildLyricPrompt({
      name,
      achievement,
      dialectLabel,
      dialectRules: getDialectVocabRules(dialect),
      styleLine,
    });

    const lyricResponse = await chatFetch(
      MODEL_IDS.GEMINI_FAST,
      {
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
      },
      { label: "generate-celebration-song" },
    );

    if (!lyricResponse.ok) {
      const status = lyricResponse.status;
      if (status === 429 || status === 402) {
        return reply(
          { error: status === 429 ? "Rate limited, try again later" : "Credits exhausted" },
          status,
        );
      }
      console.error("Lyric generation error:", status, await lyricResponse.text().catch(() => ""));
      return reply({ error: "Failed to write the song" }, 500);
    }

    const lyricData = await lyricResponse.json();
    const plan = parseLyricPlan(lyricData.choices?.[0]?.message?.content ?? "");
    const musicPrompt = buildMusicPrompt(plan, dialectLabel);
    if (!musicPrompt) return reply({ error: "Empty music prompt generated" }, 500);

    const callLyria = (text: string) =>
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

    type LyriaPart = { inlineData?: { data?: string; mimeType?: string } };
    type LyriaResponse = { candidates?: Array<{ content?: { parts?: LyriaPart[] } }> };
    const extractAudio = (data: LyriaResponse | null) =>
      data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("audio/"));

    let lyriaResponse = await callLyria(musicPrompt);
    let lyriaData: LyriaResponse | null = null;
    let audioPart: LyriaPart | undefined;
    if (lyriaResponse.ok) {
      lyriaData = await lyriaResponse.json();
      audioPart = extractAudio(lyriaData);
    }

    // Blocked by the safety filter, or any other "no audio": retry once with a
    // plain prompt that still sings the name.
    if (!audioPart?.inlineData?.data) {
      if (!lyriaResponse.ok) {
        const status = lyriaResponse.status;
        console.error("Lyria error:", status, await lyriaResponse.text().catch(() => ""));
        if (status === 429) return reply({ error: "Music generation rate limited, try again later" }, 429);
        if (status === 402) return reply({ error: "Music generation credits exhausted" }, 402);
      }
      lyriaResponse = await callLyria(buildFallbackMusicPrompt({ name, dialectLabel, styleLine }));
      if (lyriaResponse.ok) {
        lyriaData = await lyriaResponse.json();
        audioPart = extractAudio(lyriaData);
      }
    }

    if (!audioPart?.inlineData?.data) {
      console.error("No audio in Lyria response (after retry):", JSON.stringify(lyriaData)?.slice(0, 500));
      return reply({ error: "The song was blocked by the safety filter. Try a different name." }, 500);
    }

    const audioBytes = Uint8Array.from(atob(audioPart.inlineData.data), (c) => c.charCodeAt(0));
    const mimeType: string = audioPart.inlineData.mimeType || "audio/L16;rate=48000";

    let outBytes: Uint8Array = audioBytes;
    let outMime = mimeType;
    if (/^audio\/(l16|pcm)/i.test(mimeType)) {
      outBytes = pcmToWav(audioBytes, sampleRateFromMime(mimeType));
      outMime = "audio/wav";
    }

    // Base64 in JSON, not raw bytes: functions.invoke can coerce a binary body
    // through UTF-8 and turn the audio into white noise.
    let binary = "";
    for (let i = 0; i < outBytes.length; i += 0x8000) {
      binary += String.fromCharCode(...outBytes.subarray(i, i + 0x8000));
    }

    return reply({
      audioBase64: btoa(binary),
      mimeType: outMime,
      extension: /mpeg|mp3/.test(outMime) ? "mp3" : "wav",
      lyrics: plan.lyrics || null,
      name,
    });
  } catch (e) {
    console.error("generate-celebration-song error:", e);
    return reply({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
