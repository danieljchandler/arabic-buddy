import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getDialectIdentity, getDialectLabel } from "../_shared/dialectHelpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Strip HTML tags from a string (bolls.life returns HTML-formatted text).
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch a single chapter from the Bolls.life Bible API (free, no key required).
 *
 * @param translationCode - e.g. "SVD", "NAV", "ESV"
 * @param bookNumber - canonical book number 1-66
 * @param chapter - chapter number
 * @returns Array of verse strings: ["1 In the beginning…", "2 The earth…", …]
 */
async function fetchChapter(
  translationCode: string,
  bookNumber: number,
  chapter: number,
): Promise<string[]> {
  const url = `https://bolls.life/get-text/${translationCode}/${bookNumber}/${chapter}/`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    console.error("Bolls.life API error:", res.status, text);
    throw new Error(`Bible API returned ${res.status}`);
  }

  const data = await res.json();

  // Response: [{ pk, verse, text (HTML) }, …]
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response format from Bible API");
  }

  const verses: string[] = data.map(
    (v: { verse: number; text: string }) =>
      `${v.verse} ${stripHtml(v.text)}`,
  );
  return verses;
}

/**
 * Use the Lovable AI gateway to convert formal Arabic into the selected dialect.
 */
async function convertToDialect(
  formalVerses: string[],
  dialect: string,
  lovableKey: string,
): Promise<string[]> {
  const dialectLabel = getDialectLabel(dialect);
  const dialectIdentity = getDialectIdentity(dialect);

  const systemPrompt = `${dialectIdentity}

You are helping Arabic learners read the Bible in ${dialectLabel}.
Your task is to take formal Arabic Bible text and rewrite it in ${dialectLabel} exactly as a native speaker would say it conversationally.
Preserve the meaning faithfully. Keep verse numbers at the start of each line.
Return ONLY a JSON array of strings – one per verse – with no markdown formatting.`;

  const userPrompt = `Convert the following formal Arabic Bible verses into ${dialectLabel}. Return a JSON array of strings, one per verse.

${JSON.stringify(formalVerses)}`;

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
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    if (response.status === 402) {
      throw Object.assign(new Error("Not enough AI credits."), {
        status: 402,
      });
    }
    if (response.status === 429) {
      throw Object.assign(new Error("Rate limit exceeded. Try again later."), {
        status: 429,
      });
    }
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content || "[]";

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as string[];
    }
    throw new Error("No JSON array found");
  } catch (e) {
    console.error("Failed to parse dialect conversion:", e, content);
    // Return the original verses as a fallback
    return formalVerses;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: ensure caller has bible_reader (or admin) role ──────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Decode the user from the JWT
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check role
    const { data: hasBibleRole } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "bible_reader",
    });
    const { data: hasAdminRole } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (!hasBibleRole && !hasAdminRole) {
      return new Response(
        JSON.stringify({ error: "You do not have access to the Bible reading feature." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Parse body ───────────────────────────────────────────────────
    const {
      arabicVersion,
      englishVersion = "ESV",
      bookNumber,
      bookUsfm,
      chapter,
      dialect = "Gulf",
    } = await req.json();

    if (!arabicVersion || !bookNumber || !chapter) {
      return new Response(
        JSON.stringify({ error: "arabicVersion, bookNumber, and chapter are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Fetch Arabic + English in parallel (Bolls.life — free, no key) ──
    const [arabicVerses, englishVerses] = await Promise.all([
      fetchChapter(arabicVersion, bookNumber, chapter),
      fetchChapter(englishVersion, bookNumber, chapter),
    ]);

    // ── Convert Arabic to dialect via AI ─────────────────────────────
    const dialectVerses = await convertToDialect(
      arabicVerses,
      dialect,
      LOVABLE_API_KEY,
    );

    return new Response(
      JSON.stringify({
        arabicVerses,
        englishVerses,
        dialectVerses,
        bookUsfm: bookUsfm || "",
        chapter,
        dialect,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("bible-passage error:", error);
    const status = (error as Record<string, unknown>).status as number || 500;
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
