// translate-story-dialect — Re-runs the fusha→dialect conversion for a story.
//
// Every import already lands in dialect (import-authentic-story calls the same
// shared converter), so this is the *re-run*: a story whose conversion failed
// at import time, one being moved to another dialect, or one an editor wants
// redone. The conversion itself lives in `_shared/storyDialect.ts` so the two
// entry points cannot drift apart.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { primeDialectPrompt, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireContentManager } from "../_shared/requireRole.ts";
import {
  hasDialectLines,
  storyDialectBodies,
  translateStoryLinesToDialect,
} from "../_shared/storyDialect.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Every write below lands on `authentic_stories` / `authentic_story_lines`
    // — shared editorial content keyed by a `story_id` from the request body,
    // not by the caller. Being signed in was the whole gate, so any account
    // could overwrite the catalogue and run the paid image/TTS generators in a
    // loop. Editing a story takes the content team.
    const gate = await requireContentManager(req, corsHeaders);
    if (gate.denied) return gate.response;

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { story_id, dialect } = await req.json();
    if (!story_id || !dialect) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetDialect = dialect as Dialect;
    await primeDialectPrompt(targetDialect);

    // Fetch story lines
    const { data: lines, error: fetchErr } = await supabaseAdmin
      .from("authentic_story_lines")
      .select("*")
      .eq("story_id", story_id)
      .order("line_index", { ascending: true });

    if (fetchErr || !lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "story_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dialectLines = await translateStoryLinesToDialect(lines, targetDialect);

    // Update each line with its dialect translation. A line the model skipped
    // keeps the dialect it already had rather than being blanked — a re-run
    // that drops a rendering is worse than one that leaves it alone.
    //
    // A line whose words changed also loses its recording. The stored clip was
    // synthesised from the old text, and nothing on the row says which text a
    // clip belongs to, so leaving it would have the page show one sentence and
    // say another. Dropping it costs a re-generation and falls back to
    // on-demand speech in the meantime.
    let translated = 0;
    let audioCleared = 0;
    for (let i = 0; i < lines.length; i++) {
      const rendering = dialectLines[i];
      if (!rendering?.dialect) continue;
      translated++;
      const vocalized = rendering.dialect_vocalized || rendering.dialect;
      const stale = Boolean(lines[i].audio_url) &&
        (lines[i].dialect !== rendering.dialect || lines[i].dialect_vocalized !== vocalized);
      if (stale) audioCleared++;
      const { error: updateErr } = await supabaseAdmin
        .from("authentic_story_lines")
        .update({
          dialect: rendering.dialect,
          dialect_vocalized: vocalized,
          ...(stale ? { audio_url: null, duration_seconds: null } : {}),
        })
        .eq("id", lines[i].id);
      if (updateErr) {
        console.warn(`Failed to update line ${i}:`, updateErr.message);
      }
    }

    if (hasDialectLines(dialectLines)) {
      await supabaseAdmin
        .from("authentic_stories")
        .update({
          ...storyDialectBodies(lines, dialectLines),
          dialect: targetDialect,
          // Say so on the story too, so the edit page stops claiming the
          // narration is ready when half of it has just been thrown away.
          ...(audioCleared > 0
            ? {
              video_status: "none",
              audio_url: null,
              duration_seconds: null,
              line_durations: null,
            }
            : {}),
        })
        .eq("id", story_id);
    }

    return new Response(
      JSON.stringify({ success: true, lines_translated: translated, audio_cleared: audioCleared }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e: unknown) {
    console.error("translate-story-dialect fatal:", e);
    return new Response(JSON.stringify({ error: "internal", detail: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
