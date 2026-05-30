import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectVocabRules } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap: 5 jingle generations / user / day (Lyria is expensive).
  const cap = await enforceDailyCap(req, "generate-word-jingle", 50, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { word_arabic, word_english, dialect = "Gulf" } = await req.json();

    if (!word_arabic || !word_english) {
      return new Response(
        JSON.stringify({ error: "word_arabic and word_english are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Generate a dialect-specific music prompt using Lovable AI
    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const dialectStyle = dialect === "Egyptian"
      ? "Egyptian Arabic pop/shaabi style with Egyptian dialect vocals"
      : dialect === "Yemeni"
      ? "Yemeni folk-pop style with Yemeni dialect vocals"
      : "Khaliji/Gulf Arabic pop style with Gulf dialect vocals";

    const promptGenResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a creative music director specializing in Arabic educational songs. You write short, catchy music prompts for AI music generation.

${dialectRules}

Your output should be a single music generation prompt in English that describes a 10-second catchy jingle/song. The song MUST:
- Be in ${dialectLabel} dialect specifically
- Use ${dialectStyle}
- Feature the target Arabic word prominently and repeatedly
- Be fun, upbeat, family-friendly, and educational
- Be exactly 10 seconds long

STRICT SAFETY RULES (the music model has a strict safety filter — violations cause generation to fail):
- NEVER mention violence, war, weapons, captivity, prison, oppression, blood, death, hate, politics, religion, romance, alcohol, drugs, body parts, or anything explicit.
- Even if the target word literally means something heavy (e.g. "captivity", "kill", "fight"), describe it in a soft, abstract, metaphorical, child-friendly way (e.g. "a playful game", "a gentle puzzle", "letting go", "freedom and sunshine").
- Lyrics must be cheerful, wholesome, suitable for a children's TV show.
- Use happy imagery: sunshine, friends, dancing, colors, markets, food, nature.

Output ONLY the music prompt, nothing else.`,
            },
            {
              role: "user",
              content: `Create a wholesome, child-friendly 10-second jingle prompt that teaches the ${dialectLabel} word "${word_arabic}" (meaning "${word_english}"). Repeat the Arabic word catchily using ${dialectStyle}. Keep lyrics cheerful and abstract — no violence, politics, religion, or adult themes, even if the word's literal meaning is heavy.`,
            },
          ],
        }),
      }
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
    const musicPrompt = promptData.choices?.[0]?.message?.content?.trim();

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

    const textAt = (bytes: Uint8Array, offset: number, length: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + length));
    const id3TotalSize = (bytes: Uint8Array) => {
      if (bytes.length < 10 || textAt(bytes, 0, 3) !== "ID3") return 0;
      const payloadSize =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);
      return Math.min(bytes.length, 10 + payloadSize);
    };
    const hasMpegFrameSync = (bytes: Uint8Array, offset = 0) => {
      const limit = Math.min(bytes.length - 4, offset + 16384);
      for (let i = offset; i < limit; i++) {
        const frameLength = mpegFrameLength(bytes, i);
        if (!frameLength) continue;
        const next = i + frameLength;
        if (next + 4 <= bytes.length && mpegFrameLength(bytes, next)) return true;
      }
      return false;
    };
    const isValidMpegHeader = (bytes: Uint8Array, offset: number) => {
      if (offset + 4 > bytes.length) return false;
      if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
      const version = (bytes[offset + 1] >> 3) & 0x03;
      const layer = (bytes[offset + 1] >> 1) & 0x03;
      const bitrate = (bytes[offset + 2] >> 4) & 0x0f;
      const sampleRate = (bytes[offset + 2] >> 2) & 0x03;
      const emphasis = bytes[offset + 3] & 0x03;
      return version !== 0x01 && layer !== 0x00 && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03 && emphasis !== 0x02;
    };
    const mpegFrameLength = (bytes: Uint8Array, offset: number) => {
      if (!isValidMpegHeader(bytes, offset)) return 0;
      const version = (bytes[offset + 1] >> 3) & 0x03;
      const layer = (bytes[offset + 1] >> 1) & 0x03;
      const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
      const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
      const padding = (bytes[offset + 2] >> 1) & 0x01;
      const sampleRates: Record<number, number[]> = { 0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000] };
      const v1 = version === 3;
      const bitrateTable = v1
        ? layer === 3
          ? [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
          : layer === 2
          ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
          : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : layer === 3
        ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const bitrate = bitrateTable[bitrateIndex] * 1000;
      const sampleRate = sampleRates[version]?.[sampleRateIndex] ?? 0;
      if (!bitrate || !sampleRate) return 0;
      if (layer === 3) return Math.floor(((12 * bitrate) / sampleRate + padding) * 4);
      const coefficient = layer === 1 && !v1 ? 72 : 144;
      return Math.floor((coefficient * bitrate) / sampleRate + padding);
    };

    // Lyria returns raw PCM (audio/L16). Browsers can't play raw PCM via <audio>,
    // so wrap it in a WAV container. Parse sample rate from mime, default 48000.
    let outBytes = audioBytes;
    let outMime = mimeType;
    const id3Size = id3TotalSize(audioBytes);
    const looksLikeInvalidMp3 = /^audio\/mpeg/i.test(mimeType) && !hasMpegFrameSync(audioBytes, id3Size);
    if (/^audio\/(l16|pcm)/i.test(mimeType) || looksLikeInvalidMp3 || !/mpeg|mp3|wav|ogg|webm/i.test(mimeType)) {
      const rateMatch = mimeType.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 48000;
      const pcmBytes = looksLikeInvalidMp3 && id3Size > 0 ? audioBytes.slice(id3Size) : audioBytes;
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

    return new Response(outBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": outMime,
        "Content-Disposition": `inline; filename="jingle.wav"`,
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
