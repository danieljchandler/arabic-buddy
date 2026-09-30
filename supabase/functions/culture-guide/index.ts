// culture-guide — streams a grounded answer from Gemini using Google Search
// grounding. We call Gemini's native streaming endpoint with GEMINI_API_KEY
// (this bypasses aiGateway's OpenAI-shaped route because googleSearch isn't an
// OpenAI-compatible tool), and re-emit each text chunk in OpenAI SSE shape so
// the existing client parser keeps working. After the model finishes we
// append a "Sources" markdown block built from groundingMetadata.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectIdentity, getDialectVocabRules, getDialectLabel } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { streamBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import type { Dialect } from "../_shared/dialectTypes.ts";


// Native Gemini endpoint takes the bare model name, so strip the registry's
// `google/` routing prefix rather than writing an id here (which would go
// stale, as gemini-2.5-flash did when Google retired it for new callers).
const GROUNDED_MODEL = MODEL_IDS.GEMINI_FLASH.replace(/^google\//, "");

function buildSystemPrompt(dialect: string): string {
  const dialectLabel = getDialectLabel(dialect);
  const identity = getDialectIdentity(dialect);
  const vocabRules = getDialectVocabRules(dialect);

  const regionDesc = dialect === 'Egyptian'
    ? 'Egyptian Arabic (مصري) — focused on Egyptian culture (Cairo, Alexandria, Upper Egypt, Delta region).'
    : dialect === 'Yemeni'
    ? "Yemeni Arabic (يمني) — focused on Yemeni culture (Sana'a, Aden, Hadramaut, Ta'izz, Marib)."
    : 'Gulf Arabic (Saudi, Emirati, Kuwaiti, Qatari, Bahraini, Omani culture).';

  const regionGuidelines = dialect === 'Egyptian'
    ? `- Provide the Egyptian Arabic phrase/response in Arabic script and English translation only
- NEVER include transliteration (no Latin-letter pronunciation guides)
- Explain the cultural reasoning behind your advice
- Mention if customs vary between regions of Egypt
- Cover greetings, hospitality, business etiquette, religious customs, family dynamics, social norms`
    : dialect === 'Yemeni'
    ? `- Provide the Yemeni Arabic phrase/response in Arabic script and English translation only
- NEVER include transliteration
- Explain the cultural reasoning behind your advice
- Mention if customs vary between regions of Yemen
- Cover greetings, hospitality, qat sessions, مفرج etiquette, جنبية traditions, business etiquette, religious customs, family dynamics, social norms`
    : `- Provide the Gulf Arabic phrase/response in Arabic script and English translation only
- NEVER include transliteration
- Explain the cultural reasoning behind your advice
- Mention if customs vary between Gulf countries
- Cover greetings, hospitality, business etiquette, religious customs, family dynamics, social norms`;

  return `${identity}

You are a ${dialectLabel} cultural advisor for "Hikaya" — ${regionDesc}

Your role: Help users navigate real-life social situations with culturally appropriate responses, phrases, and etiquette.

${vocabRules}

Guidelines:
${regionGuidelines}
- Use Google Search to ground time-sensitive or specific cultural questions in real, citable sources.
- If religious or sensitive, be respectful and factual.
- If you're not confident, say so clearly.
- Keep responses warm, practical, and conversational.
- Respond in English or Arabic depending on which language the user writes in.

If the question is completely unrelated to Arabic culture, politely redirect them.`;
}

// Convert chat-style messages to Gemini "contents" array.
function toGeminiContents(messages: Array<{ role: string; content: string }>) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

function openaiChunk(text: string): string {
  const payload = {
    choices: [{ delta: { content: text }, index: 0 }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** What the learner reads when the model returned a stream with no words in it. */
function emptyAnswerText(reason: string | null): string {
  if (reason && /SAFETY|BLOCK|PROHIBITED|RECITATION/i.test(reason)) {
    return "I can't help with that one. Try asking about a custom, a greeting or a situation.";
  }
  return "I couldn't come up with an answer for that. Try asking it another way.";
}

/**
 * The same conversation through the Brain, without Google's search tool.
 * Used when Google itself refuses or fails, so the learner still gets an
 * answer; the model is the registry's non-Google chat model so a Google
 * outage cannot take this path down too.
 */
async function ungroundedAnswer(
  messages: Array<{ role: string; content: string }>,
  dialect: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const history = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  try {
    const answer = await streamBrain({
      purpose: "culture-guide",
      dialect: dialect as Dialect,
      messages: history,
      systemPromptExtra: buildSystemPrompt(dialect).replace(/^- Use Google Search[^\n]*\n?/m, ""),
      model: MODEL_IDS.CLAUDE_CHAT,
      temperature: 0.7,
    });
    // streamBrain builds its own headers; the CORS ones for this request win.
    const headers = new Headers(answer.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
    return new Response(answer.body, { status: answer.status, headers });
  } catch (e) {
    const status = e instanceof BrainHttpError ? e.status : 502;
    console.error("[culture-guide] fallback failed", status, e instanceof Error ? e.message : e);
    const message =
      status === 429
        ? "The AI is busy right now. Try again in a minute."
        : status === 402
          ? "The AI has run out of credit. Try again later."
          : "The AI couldn't answer. Try again.";
    return new Response(
      JSON.stringify({ error: message, message }),
      { status: status >= 400 && status < 600 ? status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

function formatSources(metadata: any): string {
  const chunks: any[] = metadata?.groundingChunks ?? [];
  if (!chunks.length) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of chunks) {
    const web = c?.web;
    if (!web?.uri) continue;
    if (seen.has(web.uri)) continue;
    seen.add(web.uri);
    const title = (web.title || web.uri).replace(/[\[\]]/g, "");
    lines.push(`- [${title}](${web.uri})`);
    if (lines.length >= 6) break;
  }
  if (!lines.length) return "";
  return `\n\n---\n**Sources**\n${lines.join("\n")}`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "culture-guide", 15, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { messages, dialect = "Gulf" } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      // Was a 500 with "Cannot read properties of undefined (reading 'filter')".
      return new Response(
        JSON.stringify({ error: "Ask a question first — messages came through empty." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const systemPrompt = buildSystemPrompt(dialect);

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GROUNDED_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: toGeminiContents(messages),
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.7 },
        }),
      },
    );

    if (!upstream.ok || !upstream.body) {
      const txt = upstream.ok ? "" : await upstream.text();
      console.warn("[culture-guide] upstream", upstream.status, txt.slice(0, 200), "— answering without search grounding");
      // Google refusing the call (no credit, over quota, bad key) or falling
      // over is not a reason to show the learner nothing. Answer through the
      // Brain instead, on the registry's non-Google model, without the
      // search tool: an ungrounded answer beats an error page. This path is
      // what the 2026-09-29 sweep hit — Google out of credit — and the page
      // sat silent for 25 s.
      return await ungroundedAnswer(messages, dialect, corsHeaders);
    }

    // Transform Gemini SSE → OpenAI-shaped SSE chunks the existing client parses.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let lastGroundingMetadata: any = null;

    let emittedText = false;
    let blockedReason: string | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
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
                // A 200 stream can still carry a refusal: a safety block on the
                // prompt, or an error object. Both used to be dropped on the
                // floor, so the client saw a clean empty stream and rendered
                // nothing at all.
                if (json.error?.message) blockedReason = String(json.error.message);
                if (json.promptFeedback?.blockReason) blockedReason = String(json.promptFeedback.blockReason);
                const cand = json.candidates?.[0];
                if (cand?.finishReason && cand.finishReason !== "STOP" && cand.finishReason !== "MAX_TOKENS") {
                  blockedReason = String(cand.finishReason);
                }
                const parts = cand?.content?.parts ?? [];
                for (const p of parts) {
                  if (typeof p?.text === "string" && p.text.length) {
                    emittedText = true;
                    controller.enqueue(encoder.encode(openaiChunk(p.text)));
                  }
                }
                if (cand?.groundingMetadata) {
                  lastGroundingMetadata = cand.groundingMetadata;
                }
              } catch (e) {
                console.warn("[culture-guide] parse skip", e);
              }
            }
          }
          if (!emittedText) {
            console.warn("[culture-guide] empty answer", blockedReason ?? "no text in stream");
            controller.enqueue(encoder.encode(openaiChunk(emptyAnswerText(blockedReason))));
          }
          const sourcesMd = formatSources(lastGroundingMetadata);
          if (sourcesMd) controller.enqueue(encoder.encode(openaiChunk(sourcesMd)));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          console.error("[culture-guide] stream err", e);
          if (!emittedText) {
            controller.enqueue(encoder.encode(openaiChunk(emptyAnswerText(null))));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("culture-guide error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
