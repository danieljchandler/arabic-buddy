// conversation-practice — dialect-aware practice turn through the AI Brain.
// The brain owns dialect identity + vocab rules; this file appends difficulty
// guidance and buffers the stream server-side because the client expects { reply }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { streamBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function difficultyExtras(difficulty: string): string {
  if (difficulty === "advanced") {
    return "Student Arabic level: advanced. Speak naturally at full speed. Use complex grammar, idioms, and cultural expressions. Challenge the student.";
  }
  if (difficulty === "intermediate") {
    return "Student Arabic level: intermediate. Use moderately complex sentences. Mix common and less common vocabulary. Correct mistakes gently.";
  }
  return "Student Arabic level: beginner. Use very simple, short sentences. Speak slowly. Use only basic vocabulary. Be encouraging and patient.";
}

async function readSseToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const out: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string") out.push(delta);
        } catch { /* skip partial chunk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return out.join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cap = await enforceDailyCap(req, "conversation-practice", 50, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { messages, dialect = "Gulf", difficulty = "beginner" } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const streamed = await streamBrain({
        purpose: "conversation_practice_turn",
        dialect: dialect as Dialect,
        systemPromptExtra: difficultyExtras(difficulty),
        messages,
        model: "google/gemini-3-flash-preview",
        temperature: 0.8,
        maxTokens: 500,
        signal: controller.signal,
      });

      if (!streamed.body) {
        return new Response(
          JSON.stringify({ error: "AI service unavailable" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const reply = await readSseToText(streamed.body);

      if (!reply) {
        return new Response(
          JSON.stringify({ error: "AI service unavailable" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ reply }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    if (e instanceof BrainHttpError) {
      if (e.status === 402) {
        return new Response(
          JSON.stringify({ error: "Not enough AI credits. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (e.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("conversation-practice brain error:", e.status, e.message);
      return new Response(
        JSON.stringify({ error: `AI service error (${e.status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    console.error("conversation-practice error:", message);
    return new Response(
      JSON.stringify({ error: isAbort ? "Request timed out. Please try again." : message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
