import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let reply = "";

    // Primary: Gemini via Lovable gateway
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          max_tokens: 300,
          temperature: 0.8,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        reply = data.choices?.[0]?.message?.content || "";
      } else {
        const errorText = await response.text();
        console.warn("conversation-practice: Gemini error", response.status, errorText.slice(0, 200));
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
      }
    } finally {
      clearTimeout(timeout);
    }

    // Fallback: Jais via RunPod if Gemini failed
    if (!reply) {
      const RUNPOD_API_KEY = Deno.env.get("RUNPOD_API_KEY");
      if (RUNPOD_API_KEY) {
        console.log("conversation-practice: falling back to Jais via RunPod...");
        try {
          const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
          const userMsgs = messages.filter((m: any) => m.role !== "system").map((m: any) => `${m.role}: ${m.content}`).join("\n");
          const jaisPrompt = `### Instruction: ${systemMsg}\n\n### Input: ${userMsgs}\n\n### Response:`;
          const jaisResp = await fetch("https://api.runpod.ai/v2/flt01o21vejrsb/runsync", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RUNPOD_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ input: { prompt: jaisPrompt } }),
          });
          if (jaisResp.ok) {
            const jaisData = await jaisResp.json();
            reply = typeof jaisData.output === "string" ? jaisData.output : jaisData.output?.text ?? "";
          }
        } catch (e) {
          console.warn("Jais conversation fallback failed:", e);
        }
      }
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
