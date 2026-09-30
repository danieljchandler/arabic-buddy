import { getTashkeelMandate, getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { hasAnyProvider } from "../_shared/aiGateway.ts";

const FEATURE = "souq-news";

interface Sentence {
  arabic: string;
  transliteration: string;
  english: string;
  literal: string;
}

interface VocabItem {
  word_arabic: string;
  word_english: string;
}

/** What the card renders. Anything the model adds beyond this is dropped. */
interface Retelling {
  title_dialect: string;
  body_dialect: string;
  sentences: Sentence[];
  title_english: string;
  summary_english: string;
  vocabulary: VocabItem[];
}

const RETELLING_TOOL = {
  name: "emit_retelling",
  description: "Return one news story retold as souq gossip in dialect.",
  parameters: {
    type: "object",
    properties: {
      title_dialect: { type: "string", description: "Catchy dialect headline, Arabic script, fully vocalized" },
      body_dialect: { type: "string", description: "The story retold in dialect, 3-5 sentences, fully vocalized, as one string" },
      sentences: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            arabic: { type: "string", description: "One sentence of body_dialect, verbatim" },
            transliteration: { type: "string", description: "Latin-letter transliteration" },
            english: { type: "string", description: "Faithful natural English translation" },
            literal: { type: "string", description: "Word-for-word English gloss in Arabic word order" },
          },
          required: ["arabic", "transliteration", "english", "literal"],
        },
      },
      title_english: { type: "string", description: "English translation of the headline" },
      summary_english: { type: "string", description: "Brief English summary, 1-2 sentences" },
      vocabulary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            word_arabic: { type: "string" },
            word_english: { type: "string" },
          },
          required: ["word_arabic", "word_english"],
        },
        description: "2-3 key dialect words from the retelling",
      },
    },
    required: ["title_dialect", "body_dialect", "sentences", "title_english", "summary_english", "vocabulary"],
  },
};

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * The card reads every one of these fields unconditionally, so a rewrite
 * missing any of them used to render as a card with blanks in it (and the
 * per-sentence player as nothing at all). Returns the reason it was refused,
 * or the retelling.
 */
function validateRetelling(value: unknown): { ok: true; retelling: Retelling } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") return { ok: false, reason: "not an object" };
  const v = value as Record<string, unknown>;
  for (const key of ["title_dialect", "body_dialect", "title_english", "summary_english"] as const) {
    if (!nonEmpty(v[key])) return { ok: false, reason: `missing ${key}` };
  }
  if (!Array.isArray(v.sentences)) return { ok: false, reason: "missing sentences" };
  const sentences: Sentence[] = [];
  for (const raw of v.sentences) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (!nonEmpty(s.arabic)) continue;
    sentences.push({
      arabic: s.arabic,
      transliteration: typeof s.transliteration === "string" ? s.transliteration : "",
      english: typeof s.english === "string" ? s.english : "",
      literal: typeof s.literal === "string" ? s.literal : "",
    });
  }
  if (sentences.length === 0) return { ok: false, reason: "no sentences with Arabic" };
  const vocabulary: VocabItem[] = Array.isArray(v.vocabulary)
    ? v.vocabulary
        .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
        .filter((w) => nonEmpty(w.word_arabic) && nonEmpty(w.word_english))
        .map((w) => ({ word_arabic: w.word_arabic as string, word_english: w.word_english as string }))
    : [];
  return {
    ok: true,
    retelling: {
      title_dialect: v.title_dialect as string,
      body_dialect: v.body_dialect as string,
      sentences,
      title_english: v.title_english as string,
      summary_english: v.summary_english as string,
      vocabulary,
    },
  };
}

const REGION_QUERIES: Record<string, string> = {
  Gulf: "Saudi Arabia UAE Qatar Kuwait Bahrain Oman news today",
  Egyptian: "Egypt Cairo news today",
  Yemeni: "Yemen Sanaa Aden news today",
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // One call runs up to three Firecrawl searches and four model rewrites, and
  // config.toml has verify_jwt = false — so without this gate the endpoint was
  // anonymous, uncapped paid spend for anyone holding the public anon key.
  const cap = await enforceDailyCap(req, FEATURE, 10, corsHeaders);
  if (cap.limited) return cap.response;

  const startedAt = Date.now();
  let dialect: string = "Gulf";

  try {
    const body = await req.json();
    dialect = body?.dialect ?? "Gulf";

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      emitMetric({ feature: FEATURE, event: "config_missing", dialect, status: "error", meta: { missing: "FIRECRAWL_API_KEY" } });
      return new Response(
        JSON.stringify({ error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasAnyProvider()) {
      emitMetric({ feature: FEATURE, event: "config_missing", dialect, status: "error", meta: { missing: "AI_PROVIDER_KEY" } });
      return new Response(
        JSON.stringify({ error: "No AI provider configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const query = REGION_QUERIES[dialect] || REGION_QUERIES.Gulf;
    console.log("Searching news:", query);

    async function firecrawlSearch(tbs: string | null) {
      const fcStart = Date.now();
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
      const elapsed = Date.now() - fcStart;
      if (!res.ok) {
        const errText = await res.text();
        console.error("Firecrawl error:", res.status, errText);
        emitMetric({
          feature: FEATURE,
          event: "firecrawl_search",
          dialect,
          status: "error",
          durationMs: elapsed,
          count: 0,
          meta: { tbs: tbs ?? "none", http_status: res.status, error: errText.slice(0, 500) },
        });
        return { ok: false as const, status: res.status, articles: [] as any[] };
      }
      const json = await res.json();
      let arr: any[] = [];
      if (Array.isArray(json.data)) arr = json.data;
      else if (Array.isArray(json.data?.web)) arr = json.data.web;
      else if (Array.isArray(json.web)) arr = json.web;
      if (json.warning) console.log(`Firecrawl warning (tbs=${tbs}):`, json.warning);
      emitMetric({
        feature: FEATURE,
        event: "firecrawl_search",
        dialect,
        status: arr.length === 0 ? "warn" : "ok",
        durationMs: elapsed,
        count: arr.length,
        meta: { tbs: tbs ?? "none", warning: json.warning ?? null },
      });
      return { ok: true as const, status: 200, articles: arr };
    }

    let articles: any[] = [];
    let chosenTbs: string | null = null;
    for (const tbs of ["qdr:d", "qdr:w", null]) {
      const r = await firecrawlSearch(tbs);
      if (!r.ok) {
        emitMetric({ feature: FEATURE, event: "request_failed", dialect, status: "error", durationMs: Date.now() - startedAt, meta: { stage: "firecrawl" } });
        return new Response(
          JSON.stringify({ error: "Failed to fetch news articles" }),
          { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (r.articles.length > 0) {
        articles = r.articles;
        chosenTbs = tbs;
        console.log(`Firecrawl returned ${articles.length} articles for ${dialect} (tbs=${tbs ?? "none"})`);
        break;
      }
    }

    if (articles.length === 0) {
      console.log(`No articles found for ${dialect} after fallbacks`);
      emitMetric({
        feature: FEATURE,
        event: "no_articles",
        dialect,
        status: "warn",
        count: 0,
        durationMs: Date.now() - startedAt,
      });
      return new Response(
        JSON.stringify({ articles: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The dialect identity, Rulebook and worked examples come from askBrain.
    const brainDialect: Dialect = dialect === "Egyptian" || dialect === "Yemeni" ? dialect : "Gulf";

    const systemPrompt = `You are retelling news stories to a friend at the souq (market). Your tone is:
- Casual, animated, expressive — like real gossip between friends
- You use filler words and exclamations natural to the dialect
- You stay ACCURATE to the facts — no fabrication
- You NEVER use Modern Standard Arabic (فصحى) — everything is in dialect
- Keep it concise: 3-5 sentences per story

${getTashkeelMandate()}
- title_dialect and body_dialect (and each sentence in "sentences") must be fully vocalized.

${getDialectTransliterationRules(dialect as Dialect)}
- Provide a Latin-letter transliteration for each sentence in "sentences", following the rules above.

For each article, return through the emit_retelling function:
- "title_dialect": A catchy dialect headline (Arabic), fully vocalized
- "body_dialect": The story retold in dialect (Arabic, 3-5 sentences, fully vocalized) — this is the full body as one string
- "sentences": Array of {"arabic": "...", "transliteration": "...", "english": "...", "literal": "..."} — split body_dialect into its individual sentences, provide a Latin-letter transliteration, a faithful natural English translation, and a "literal" word-for-word English gloss (preserving Arabic word order; may sound stiff — it shows how each sentence is built) for EACH sentence. The arabic values concatenated must equal body_dialect.
- "title_english": English translation of the headline
- "summary_english": Brief English summary (1-2 sentences)
- "vocabulary": Array of 2-3 key dialect words from your retelling, each as {"word_arabic": "...", "word_english": "..."}

Return ONLY the function call, no prose.`;

    let creditsExhausted = false;
    let rateLimited = false;
    let parseErrors = 0;
    let aiErrors = 0;

    const settled = await Promise.all(
      articles.slice(0, 4).map(async (article) => {
        const content = article.markdown
          ? article.markdown.slice(0, 2000)
          : article.description || article.title || "";

        const aiStart = Date.now();
        try {
          let output: unknown;
          try {
            const brain = await askBrain<unknown>({
              purpose: FEATURE,
              dialect: brainDialect,
              strategy: "solo",
              systemPromptExtra: systemPrompt,
              userPrompt: `Rewrite this news article as souq gossip in dialect:\n\nTitle: ${article.title || "No title"}\n\nContent: ${content}`,
              maxTokens: 2048,
              tool: RETELLING_TOOL,
            });
            output = brain.output;
          } catch (err) {
            // The Brain has already walked its fallback chain (the last rung
            // on another vendor), so a status here is every rung refusing.
            const status = err instanceof BrainHttpError ? err.status : 0;
            const errBody = err instanceof Error ? err.message : String(err);
            console.error("AI error:", status, errBody);
            if (status === 429) rateLimited = true;
            if (status === 402) creditsExhausted = true;
            aiErrors++;
            emitMetric({
              feature: FEATURE,
              event: "ai_rewrite",
              dialect,
              status: "error",
              durationMs: Date.now() - aiStart,
              meta: { http_status: status, error: errBody.slice(0, 400), article: (article.title || "").slice(0, 200) },
            });
            return null;
          }

          const checked = validateRetelling(output);
          if (!checked.ok) {
            parseErrors++;
            console.error("souq-news: unusable rewrite:", checked.reason, JSON.stringify(output)?.slice(0, 500));
            emitMetric({
              feature: FEATURE,
              event: "json_parse",
              dialect,
              status: "error",
              durationMs: Date.now() - aiStart,
              meta: {
                article: (article.title || "").slice(0, 200),
                raw_preview: JSON.stringify(output)?.slice(0, 400) ?? "",
                error: checked.reason,
              },
            });
            return null;
          }

          emitMetric({
            feature: FEATURE,
            event: "ai_rewrite",
            dialect,
            status: "ok",
            durationMs: Date.now() - aiStart,
            meta: { article: (article.title || "").slice(0, 200) },
          });

          return {
            ...checked.retelling,
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
      emitMetric({ feature: FEATURE, event: "request_failed", dialect, status: "error", durationMs: Date.now() - startedAt, meta: { reason: "credits_exhausted" } });
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (rateLimited && settled.every((x) => x === null)) {
      emitMetric({ feature: FEATURE, event: "request_failed", dialect, status: "error", durationMs: Date.now() - startedAt, meta: { reason: "rate_limited" } });
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rewrittenArticles = settled.filter((x) => x !== null);
    console.log(`Returning ${rewrittenArticles.length} rewritten articles for ${dialect}`);

    const successRate = articles.length > 0 ? rewrittenArticles.length / Math.min(articles.length, 4) : 0;
    emitMetric({
      feature: FEATURE,
      event: "request_complete",
      dialect,
      status: rewrittenArticles.length === 0 ? "error" : (parseErrors > 0 || aiErrors > 0 ? "warn" : "ok"),
      durationMs: Date.now() - startedAt,
      count: rewrittenArticles.length,
      score: successRate,
      meta: {
        firecrawl_tbs: chosenTbs ?? "none",
        firecrawl_count: articles.length,
        attempted: Math.min(articles.length, 4),
        parse_errors: parseErrors,
        ai_errors: aiErrors,
      },
    });

    return new Response(
      JSON.stringify({ articles: rewrittenArticles }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("souq-news error:", e);
    emitMetric({
      feature: FEATURE,
      event: "unhandled_error",
      dialect,
      status: "error",
      durationMs: Date.now() - startedAt,
      meta: { error: e instanceof Error ? e.message : String(e) },
    });
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
