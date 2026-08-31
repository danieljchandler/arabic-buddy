import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { generateImageDataUrl, hasAnyProvider } from "../_shared/aiGateway.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap: 20 image generations / user / day. Paid users bypass.
  // Image generation is one of the priciest per-call features, so paid tiers
  // get a ladder rather than a bypass — this is part of what All-In buys.
  const cap = await enforceDailyCap(req, "generate-flashcard-image", 20, corsHeaders, {
    standard: 60,
    allin: 200,
  });
  if (cap.limited) return cap.response;

  // Authenticate user (auth header presence already verified by usageCap)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      console.error("Auth failed:", userError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    console.log(`Authenticated user: ${user.id}`);
    const { word_arabic, word_english, storage_path, custom_instructions } = await req.json();
    
    if (!word_english) {
      return new Response(JSON.stringify({ error: "word_english is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasAnyProvider()) throw new Error("No AI provider is configured");

    let prompt = `A single realistic, professional photograph of: ${word_english}.
STYLE GUIDE — follow exactly for every image:
- Photo-realistic stock photo style, centered subject
- Warm neutral background: soft beige, cream, or light wood surface
- Soft diffused lighting, slightly warm color temperature
- Clean minimal composition with no clutter or secondary objects
- Subject fills roughly 60-70% of the frame
- Shallow depth of field with gentle bokeh on background
- No text, labels, watermarks, or overlays
- No lens flare, no light shimmer, no sparkles, no glowing dots, no bokeh circles in the foreground
- Consistent color grading: warm highlights, soft shadows
- Matte finish, no glossy or specular highlights on the image surface`;
    
    if (custom_instructions) {
      prompt += `\nAdditional instructions: ${custom_instructions}`;
    }

    console.log(`Generating image for: ${word_english}`);

    // The Gemini-then-OpenAI ladder that used to live here is now
    // `aiGateway.generateImage`, which walks Google → OpenAI → OpenRouter with
    // the same model ids for every image caller. The retry stays here because
    // it is specific to this endpoint: Gemini returns an empty image often
    // enough on a first pass that one immediate re-ask is cheaper than telling
    // the learner to press the button again.
    let imageBase64: string | null = null;
    for (let attempt = 0; attempt < 2 && !imageBase64; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      imageBase64 = await generateImageDataUrl(prompt, {
        size: "1024x1024",
        label: "generate-flashcard-image",
      });
      if (!imageBase64) console.warn(`Image attempt ${attempt + 1}: no image returned`);
    }

    if (!imageBase64) {
      // Graceful failure so batch callers don't crash on a single word
      return new Response(JSON.stringify({
        success: false,
        error: "IMAGE_GENERATION_FAILED",
        fallback: true,
        message: `Could not generate image for "${word_english}" — please try again or use a custom prompt.`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload directly to storage from the edge function
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Decode base64 to binary
    const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryStr = atob(base64Clean);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const finalPath = storage_path || `tutor/${user.id}/${crypto.randomUUID()}.png`;
    
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

    console.log(`Successfully generated and uploaded image for: ${word_english} -> ${urlData.publicUrl}`);

    return new Response(JSON.stringify({ success: true, imageUrl: urlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-flashcard-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
