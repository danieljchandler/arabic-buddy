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
    const lyriaResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: musicPrompt }],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
          },
        }),
      }
    );

    if (!lyriaResponse.ok) {
      const status = lyriaResponse.status;
      const errText = await lyriaResponse.text();
      console.error("Lyria 3 error:", status, errText);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Music generation rate limited, try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "Music generation credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to generate music" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lyriaData = await lyriaResponse.json();

    // Extract the audio from the response
    const audioPart = lyriaData.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData?.mimeType?.startsWith("audio/")
    );

    if (!audioPart?.inlineData?.data) {
      console.error("No audio in Lyria response:", JSON.stringify(lyriaData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "No audio generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode base64 to binary
    const audioBytes = Uint8Array.from(
      atob(audioPart.inlineData.data),
      (c) => c.charCodeAt(0)
    );
    const mimeType: string = audioPart.inlineData.mimeType || "audio/L16;rate=48000";
    console.log("Lyria mime:", mimeType, "bytes:", audioBytes.length);

    // Lyria returns raw PCM (audio/L16). Browsers can't play raw PCM via <audio>,
    // so wrap it in a WAV container. Parse sample rate from mime, default 48000.
    let outBytes = audioBytes;
    let outMime = mimeType;
    if (/^audio\/(l16|pcm)/i.test(mimeType) || !/mpeg|mp3|wav|ogg|webm/i.test(mimeType)) {
      const rateMatch = mimeType.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 48000;
      const channels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * channels * bitsPerSample / 8;
      const blockAlign = channels * bitsPerSample / 8;
      const dataSize = audioBytes.length;
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
      new Uint8Array(buffer, 44).set(audioBytes);
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
