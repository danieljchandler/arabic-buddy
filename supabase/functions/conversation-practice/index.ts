import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GULF_ARABIC_IDENTITY = `You are a native Gulf Arabic conversation partner. Always respond in Gulf Arabic (Khaliji) dialect, NOT Modern Standard Arabic (فصحى). Use authentic vocabulary and expressions from the Gulf region (UAE, Saudi, Kuwait, Qatar, Bahrain, Oman). Include transliteration in parentheses for key phrases. Be warm, encouraging, and culturally authentic. Use dialectal forms like شلونك، وين، هالحين، يالله، إن شاء الله instead of MSA equivalents.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("conversation-practice: LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepend server-side Gulf Arabic identity to ensure consistent dialect output
    const enrichedMessages = [...messages];
    const hasSystemMsg = enrichedMessages[0]?.role === "system";
    if (hasSystemMsg) {
      // Wrap the client system prompt with our Gulf Arabic identity
      enrichedMessages[0] = {
        ...enrichedMessages[0],
        content: `${GULF_ARABIC_IDENTITY}\n\nAdditional context:\n${enrichedMessages[0].content}`,
      };
    } else {
      enrichedMessages.unshift({ role: "system", content: GULF_ARABIC_IDENTITY });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let reply = "";

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: enrichedMessages,
          max_tokens: 500,
          temperature: 0.8,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        reply = data.choices?.[0]?.message?.content || "";
      } else {
        const errorText = await response.text();
        console.warn("conversation-practice: AI error", response.status, errorText.slice(0, 200));
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "Not enough AI credits. Please add credits to your workspace." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ error: `AI service error (${response.status})` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!reply) {
      return new Response(
        JSON.stringify({ error: "AI service unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    console.error("conversation-practice error:", message);
    return new Response(
      JSON.stringify({ error: isAbort ? "Request timed out. Please try again." : message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
