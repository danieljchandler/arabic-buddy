import { getDialectIdentity, getDialectVocabRules, type Dialect } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REGION_QUERIES: Record<string, string> = {
  Gulf: "Saudi Arabia UAE Qatar Kuwait Bahrain Oman news today",
  Egyptian: "Egypt Cairo news today",
  Yemeni: "Yemen Sanaa Aden news today",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dialect = "Gulf" } = await req.json();

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Search for recent news via Firecrawl
    const query = REGION_QUERIES[dialect] || REGION_QUERIES.Gulf;
    console.log("Searching news:", query);

    const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 5,
        lang: "en",
        tbs: "qdr:d",
        scrapeOptions: { formats: ["markdown"] },
      }),
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error("Firecrawl error:", searchRes.status, errText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch news articles" }),
        { status: searchRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchData = await searchRes.json();
    const articles = searchData.data || [];

    if (articles.length === 0) {
      return new Response(
        JSON.stringify({ articles: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Rewrite each article in dialect via Lovable AI
    const dialectIdentity = getDialectIdentity(dialect as Dialect);
    const vocabRules = getDialectVocabRules(dialect as Dialect);

    const systemPrompt = `${dialectIdentity}

${vocabRules}

You are retelling news stories to a friend at the souq (market). Your tone is:
- Casual, animated, expressive — like real gossip between friends
- You use filler words and exclamations natural to the dialect
- You stay ACCURATE to the facts — no fabrication
- You NEVER use Modern Standard Arabic (فصحى) — everything is in dialect
- Keep it concise: 3-5 sentences per story

For each article, return a JSON object with:
- "title_dialect": A catchy dialect headline (Arabic)
- "body_dialect": The story retold in dialect (Arabic, 3-5 sentences)
- "title_english": English translation of the headline
- "summary_english": Brief English summary (1-2 sentences)
- "vocabulary": Array of 2-3 key dialect words from your retelling, each as {"word_arabic": "...", "word_english": "..."}

Return ONLY the JSON object, no markdown fencing.`;

    const rewrittenArticles = [];

    for (const article of articles) {
      const content = article.markdown
        ? article.markdown.slice(0, 2000)
        : article.description || article.title || "";

      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `Rewrite this news article as souq gossip in dialect:\n\nTitle: ${article.title || "No title"}\n\nContent: ${content}`,
              },
            ],
          }),
        });

        if (!aiRes.ok) {
          const status = aiRes.status;
          const errBody = await aiRes.text();
          console.error("AI error:", status, errBody);
          if (status === 429 || status === 402) {
            return new Response(
              JSON.stringify({ error: status === 429 ? "Rate limit exceeded, please try again shortly." : "AI credits exhausted. Please add funds." }),
              { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          continue;
        }

        const aiData = await aiRes.json();
        const raw = aiData.choices?.[0]?.message?.content || "";

        // Parse JSON from response (strip markdown fences if present)
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);

        rewrittenArticles.push({
          ...parsed,
          source_url: article.url || null,
          published_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("Failed to process article:", article.title, e);
        continue;
      }
    }

    return new Response(
      JSON.stringify({ articles: rewrittenArticles }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("souq-news error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
