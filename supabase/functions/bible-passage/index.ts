import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getDialectIdentity, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  let text = html;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/** Fetch a single chapter from Bolls.life (free, no key). */
async function fetchChapter(
  translationCode: string,
  bookNumber: number,
  chapter: number,
): Promise<string[]> {
  const url = `https://bolls.life/get-text/${translationCode}/${bookNumber}/${chapter}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      console.error("Bolls.life API error:", res.status, text);
      throw new Error(`Bible API returned ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response format from Bible API");
    return data.map((v: { verse: number; text: string }) => `${v.verse} ${stripHtml(v.text)}`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Use Lovable AI to convert formal Arabic into dialect. */
async function convertToDialect(
  formalVerses: string[],
  dialect: string,
  lovableKey: string,
): Promise<{ verses: string[]; fallback: boolean }> {
  const dialectLabel = getDialectLabel(dialect);
  const dialectIdentity = getDialectIdentity(dialect);

  const systemPrompt = `${dialectIdentity}

You are helping Arabic learners read the Bible in ${dialectLabel}.
Your task is to take formal Arabic Bible text and rewrite it in ${dialectLabel} exactly as a native speaker would say it conversationally.
Preserve the meaning faithfully. Keep verse numbers at the start of each line.
Return ONLY a JSON array of strings – one per verse – with no markdown formatting.`;

  const userPrompt = `Convert the following formal Arabic Bible verses into ${dialectLabel}. Return a JSON array of strings, one per verse.

${JSON.stringify(formalVerses)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000); // generous timeout

  try {
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.6,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 402) {
        throw Object.assign(new Error("Not enough AI credits."), { status: 402 });
      }
      if (response.status === 429) {
        throw Object.assign(new Error("Rate limit exceeded. Try again later."), { status: 429 });
      }
      // For 5xx or unknown errors, fall back gracefully
      console.warn("AI unavailable, returning formal Arabic as dialect fallback");
      return { verses: formalVerses, fallback: true };
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content || "[]";

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return { verses: JSON.parse(jsonMatch[0]) as string[], fallback: false };
      }
      throw new Error("No JSON array found");
    } catch (e) {
      console.error("Failed to parse dialect conversion:", e, content);
      return { verses: formalVerses, fallback: true };
    }
  } catch (e) {
    // AbortError = timeout, network errors
    if ((e as Error).name === "AbortError") {
      console.error("AI conversion timed out");
      return { verses: formalVerses, fallback: true };
    }
    // Re-throw credit/rate-limit errors
    if (typeof (e as Record<string, unknown>)?.status === "number") throw e;
    console.error("AI conversion failed:", e);
    return { verses: formalVerses, fallback: true };
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return err(401, "Authentication required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err(401, "Invalid or expired token");

    const { data: hasBibleRole } = await supabase.rpc("has_role", { _user_id: user.id, _role: "bible_reader" });
    const { data: hasAdminRole } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!hasBibleRole && !hasAdminRole) {
      return err(403, "You do not have access to the Bible reading feature.");
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const {
      arabicVersion,
      englishVersion = "ESV",
      bookNumber,
      bookUsfm,
      chapter,
      dialect = "Gulf",
    } = await req.json();

    if (!arabicVersion || !bookNumber || !chapter) {
      return err(400, "arabicVersion, bookNumber, and chapter are required.");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return err(500, "LOVABLE_API_KEY not configured.");

    // ── Fetch Arabic + English in parallel ───────────────────────────────
    const [arabicVerses, englishVerses] = await Promise.all([
      fetchChapter(arabicVersion, bookNumber, chapter),
      fetchChapter(englishVersion, bookNumber, chapter),
    ]);

    // ── Convert to dialect (graceful fallback) ───────────────────────────
    const { verses: dialectVerses, fallback } = await convertToDialect(
      arabicVerses,
      dialect,
      LOVABLE_API_KEY,
    );

    return ok({
      arabicVerses,
      englishVerses,
      dialectVerses,
      bookUsfm: bookUsfm || "",
      chapter,
      dialect,
      fallback,
    });
  } catch (error) {
    console.error("bible-passage error:", error);
    const status =
      typeof (error as Record<string, unknown>)?.status === "number"
        ? ((error as Record<string, unknown>).status as number)
        : 500;
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
