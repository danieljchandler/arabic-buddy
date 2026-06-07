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

    async function firecrawlSearch(tbs: string | null) {
      const body: Record<string, unknown> = {
        query,
        limit: 5,
        lang: "en",
        scrapeOptions: { formats: ["markdown"] },
      };
      if (tbs) body.tbs = tbs;
      const res = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("Firecrawl error:", res.status, errText);
        return { ok: false as const, status: res.status, articles: [] as any[] };
      }
      const json = await res.json();
      let arr: any[] = [];
      if (Array.isArray(json.data)) arr = json.data;
      else if (Array.isArray(json.data?.web)) arr = json.data.web;
      else if (Array.isArray(json.web)) arr = json.web;
      if (json.warning) console.log(`Firecrawl warning (tbs=${tbs}):`, json.warning);
      return { ok: true as const, status: 200, articles: arr };
    }

    // Try last day, then widen to last week, then no time filter.
    let articles: any[] = [];
    for (const tbs of ["qdr:d", "qdr:w", null]) {
      const r = await firecrawlSearch(tbs);
      if (!r.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch news articles" }),
          { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (r.articles.length > 0) {
        articles = r.articles;
        console.log(`Firecrawl returned ${articles.length} articles for ${dialect} (tbs=${tbs ?? "none"})`);
        break;
      }
    }

    if (articles.length === 0) {
      console.log(`No articles found for ${dialect} after fallbacks`);
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
- "body_dialect": The story retold in dialect (Arabic, 3-5 sentences) — this is the full body as one string
- "sentences": Array of {"arabic": "...", "english": "..."} — split body_dialect into its individual sentences and provide a faithful English translation for EACH sentence. The arabic values concatenated must equal body_dialect.
- "title_english": English translation of the headline
- "summary_english": Brief English summary (1-2 sentences)
- "vocabulary": Array of 2-3 key dialect words from your retelling, each as {"word_arabic": "...", "word_english": "..."}

Return ONLY the JSON object, no markdown fencing. CRITICAL: use ONLY ASCII punctuation for JSON structure (commas \`,\`, colons \`:\`, quotes \`"\`). Never use Arabic comma \`،\` or Arabic semicolon \`؛\` as JSON separators — they are valid only inside string values.`;

    let creditsExhausted = false;
    let rateLimited = false;

    const settled = await Promise.all(
      articles.slice(0, 4).map(async (article) => {
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
              response_format: { type: "json_object" },
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
            if (status === 429) rateLimited = true;
            if (status === 402) creditsExhausted = true;
            return null;
          }

          const aiData = await aiRes.json();
          const raw = aiData.choices?.[0]?.message?.content || "";

          let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const firstBrace = cleaned.indexOf("{");
          const lastBrace = cleaned.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.slice(firstBrace, lastBrace + 1);
          }
          let parsed;
          try {
            parsed = JSON.parse(cleaned);
          } catch (_e1) {
            const repaired = cleaned
              .replace(/(["}\]\d])\s*،/g, "$1,")
              .replace(/(["}\]\d])\s*؛/g, "$1;");
            try {
              parsed = JSON.parse(repaired);
            } catch (parseErr) {
              console.error("JSON parse failed. Raw (first 500):", raw.slice(0, 500));
              throw parseErr;
            }
          }

          return {
            ...parsed,
            source_url: article.url || null,
            published_at: new Date().toISOString(),
          };
        } catch (e) {
          console.error("Failed to process article:", article.title, e);
          return null;
        }
      })
    );

    if (creditsExhausted) {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (rateLimited && settled.every((x) => x === null)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rewrittenArticles = settled.filter((x) => x !== null);
    console.log(`Returning ${rewrittenArticles.length} rewritten articles for ${dialect}`);

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
