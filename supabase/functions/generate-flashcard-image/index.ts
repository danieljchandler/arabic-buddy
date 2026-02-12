import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
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

  try {
    const { word_arabic, word_english, storage_path } = await req.json();
    
    if (!word_english) {
      return new Response(JSON.stringify({ error: "word_english is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const prompt = `A single realistic, professional photograph of: ${word_english}. Photo-realistic style, high-quality stock photo. Warm neutral background (soft beige, cream, or light wood). No text, labels, or watermarks. Simple, clear composition. Good lighting, slightly warm tone.`;

    console.log(`Generating image for: ${word_english}`);

    // Retry up to 2 times on transient failures
    let imageBase64: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Attempt ${attempt + 1}: Image generation error:`, response.status, errText);
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (attempt < 2) continue;
        throw new Error(`Image generation failed after 3 attempts: ${response.status}`);
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;
      const url = message?.images?.[0]?.image_url?.url;

      if (url) {
        imageBase64 = url;
        break;
      }

      // Check for provider error in choices
      const choiceError = data.choices?.[0]?.error;
      if (choiceError) {
        console.warn(`Attempt ${attempt + 1}: Provider error: ${choiceError.message}`);
      } else {
        console.warn(`Attempt ${attempt + 1}: No image in response`);
      }
      
      if (attempt < 2) {
        // Wait a bit before retry
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!imageBase64) {
      throw new Error("No image generated after 3 attempts");
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
