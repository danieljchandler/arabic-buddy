import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { generateImageDataUrl, hasAnyProvider } from "../_shared/aiGateway.ts";

/**
 * The picture half of a mnemonic.
 *
 * `generate-mnemonic` writes the learner a sound-alike hook ("mat'am sounds
 * like a welcome mat outside a restaurant"); this renders that sentence as the
 * scene it describes. The technique it implements — the keyword method — is
 * about a *mental image*, so a learner who cannot picture the sentence gets
 * none of its benefit, and an image is the one part of it a model can hand
 * over directly.
 *
 * It is deliberately not `generate-flashcard-image` with a different prompt.
 * That function illustrates a *meaning*, so its style guide asks for a
 * photo-realistic stock shot of one object; this illustrates an absurd
 * two-clause scene, where realism is actively wrong — the reason a mnemonic
 * sticks is that it is strange, and a plausible photograph is not strange.
 * Hence a separate style guide, a separate daily counter, and no
 * `word_english`-only path: without the mnemonic there is nothing to draw.
 */

const STYLE_GUIDE = `STYLE GUIDE — follow exactly:
- A single vivid illustration of the whole scene, drawn as one moment
- Bold, colourful digital illustration — storybook/comic style, NOT a photograph
- Exaggerated, memorable, gently absurd: the strangeness is the point
- One clear focal action, uncluttered background, strong silhouette
- Bright even lighting, high contrast, saturated colours
- ABSOLUTELY NO text, letters, words, captions, speech bubbles, labels or watermarks anywhere in the image
- No collage, no panels, no split frames — one scene only`;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Its own counter, on the same ladder as the flashcard illustrator: the two
  // cost the same per call, and a learner rescuing a leech should not spend
  // the budget that illustrates their deck.
  const cap = await enforceDailyCap(req, "generate-mnemonic-image", 20, corsHeaders, {
    standard: 60,
    allin: 200,
  });
  if (cap.limited) return cap.response;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      console.error("Auth failed:", userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { mnemonic, word_arabic, word_english, storage_path, custom_instructions } =
      await req.json();

    if (!mnemonic || typeof mnemonic !== "string" || !mnemonic.trim()) {
      return new Response(JSON.stringify({ error: "mnemonic is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasAnyProvider()) throw new Error("No AI provider is configured");

    // The mnemonic leads. The English meaning rides along as context because
    // the hook is usually a pun on the *sound* ("mat'am" → "mat"), and an
    // illustrator given only the pun draws the mat and forgets the restaurant
    // — which is the half the learner actually has to recall.
    let prompt = `Illustrate this memory aid so a language learner can picture it at a glance:
"${mnemonic.trim()}"
${word_english ? `\nThe scene must clearly show the idea of "${word_english}" — that is the meaning the learner has to recall from it.` : ""}
${STYLE_GUIDE}`;

    if (custom_instructions && typeof custom_instructions === "string" && custom_instructions.trim()) {
      // The learner's adjustment comes last so it wins where it contradicts
      // the house style — "make it a photo", "just the mat" are legitimate
      // asks when the first attempt missed what they were picturing.
      prompt += `\nAdditional instructions from the learner (these take priority): ${custom_instructions.trim()}`;
    }

    console.log(`Generating mnemonic image for: ${word_arabic ?? word_english ?? "(unnamed card)"}`);

    // Same one-retry as generate-flashcard-image, for the same measured
    // reason: Gemini returns an empty image often enough on a first pass that
    // an immediate re-ask beats telling the learner to press the button again.
    let imageBase64: string | null = null;
    for (let attempt = 0; attempt < 2 && !imageBase64; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      imageBase64 = await generateImageDataUrl(prompt, {
        size: "1024x1024",
        label: "generate-mnemonic-image",
      });
      if (!imageBase64) console.warn(`Mnemonic image attempt ${attempt + 1}: no image returned`);
    }

    if (!imageBase64) {
      // 200 with success:false, like the flashcard illustrator: the caller
      // shows the message rather than a generic failure, and a refusal is not
      // a fault of the request.
      return new Response(JSON.stringify({
        success: false,
        error: "IMAGE_GENERATION_FAILED",
        fallback: true,
        message: "Could not picture that mnemonic — try again, or reword the hook.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const binaryStr = atob(base64Clean);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // Always under the caller's own id, whatever they asked for: the path is
    // the only thing separating one learner's uploads from another's in a
    // bucket written with the service role.
    const requested = typeof storage_path === "string" ? storage_path.replace(/^\/+/, "") : "";
    const safePath = requested && !requested.includes("..") ? requested : `${crypto.randomUUID()}.png`;
    const finalPath = `mnemonic/${user.id}/${safePath}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("flashcard-images")
      .upload(finalPath, bytes, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("flashcard-images")
      .getPublicUrl(finalPath);

    return new Response(JSON.stringify({ success: true, imageUrl: urlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-mnemonic-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
