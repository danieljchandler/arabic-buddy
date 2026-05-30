import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectVocabRules } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phrase_arabic, phrase_english, dialect = "Gulf" } = await req.json();

    if (!phrase_arabic || !phrase_english) {
      return new Response(
        JSON.stringify({ error: "phrase_arabic and phrase_english are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!LOVABLE_API_KEY || !GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const dialectStyle = dialect === "Egyptian"
      ? "Egyptian Arabic pop/shaabi style with Egyptian dialect vocals"
      : dialect === "Yemeni"
      ? "Yemeni folk-pop style with Yemeni dialect vocals"
      : "Khaliji/Gulf Arabic pop style with Gulf dialect vocals";

    const promptGen = await fetch(
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
              content: `You write short, catchy music prompts for AI music generation aimed at memorizing Arabic phrases.

${dialectRules}

Output a single English music prompt for a 12-second catchy hook that:
- Repeats the full ${dialectLabel} phrase memorably (chant-like)
- Uses ${dialectStyle}
- Is fun and earwormy

Output only the prompt.`,
            },
            {
              role: "user",
              content: `Create a music prompt for a 12-second jingle that drills the ${dialectLabel} phrase "${phrase_arabic}" (meaning "${phrase_english}"). Use ${dialectStyle}.`,
            },
          ],
        }),
      },
    );

    if (!promptGen.ok) {
      const status = promptGen.status;
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({
            error: status === 429 ? "Rate limited, try again later" : "Credits exhausted",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("Prompt gen error:", status, await promptGen.text());
      return new Response(
        JSON.stringify({ error: "Failed to generate music prompt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const promptData = await promptGen.json();
    const musicPrompt = promptData.choices?.[0]?.message?.content?.trim();

    if (!musicPrompt) {
      return new Response(
        JSON.stringify({ error: "Empty music prompt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lyriaResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: musicPrompt }] }],
          generationConfig: { responseModalities: ["AUDIO"] },
        }),
      },
    );

    if (!lyriaResp.ok) {
      const status = lyriaResp.status;
      console.error("Lyria error:", status, await lyriaResp.text());
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({
            error: status === 429 ? "Music generation rate limited" : "Music credits exhausted",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to generate music" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lyriaData = await lyriaResp.json();
    const audioPart = lyriaData.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData?.mimeType?.startsWith("audio/"),
    );

    if (!audioPart?.inlineData?.data) {
      console.error("No audio in Lyria response");
      return new Response(
        JSON.stringify({ error: "No audio generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const audioBytes = Uint8Array.from(
      atob(audioPart.inlineData.data),
      (c) => c.charCodeAt(0),
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
      for (let i = offset; i < bytes.length - 1; i++) {
        if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return true;
      }
      return false;
    };

    // Lyria returns raw PCM (audio/L16). Wrap as WAV so browsers can decode it.
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
      view.setUint16(20, 1, true);
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
        "Content-Disposition": `inline; filename="phrase-jingle.wav"`,
      },
    });
  } catch (e) {
    console.error("generate-phrase-jingle error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
