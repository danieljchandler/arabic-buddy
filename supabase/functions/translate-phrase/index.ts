import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { MODEL_LINEUPS } from "../_shared/modelRegistry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { chatFetch, tryChatRoute } from "../_shared/aiGateway.ts";


// Strip punctuation from edges of Arabic text
function cleanPhrase(phrase: string): string {
  return phrase
    .replace(/^[،؟.!:؛…\-—–"'()[\]{}«»\s]+|[،؟.!:؛…\-—–"'()[\]{}«»\s]+$/g, '')
    .trim();
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "translate-phrase", 30, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = await req.json();
    const rawPhrase = body.phrase;
    const dialect = body.dialect || 'Gulf';
    const mode = body.mode || 'auto'; // 'word' | 'phrase' | 'auto'
    const sentenceArabic: string | undefined = typeof body.sentenceArabic === 'string' ? body.sentenceArabic.trim() : undefined;
    const sentenceEnglish: string | undefined = typeof body.sentenceEnglish === 'string' ? body.sentenceEnglish.trim() : undefined;
    
    if (!rawPhrase || typeof rawPhrase !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing phrase' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const phrase = cleanPhrase(rawPhrase);
    if (!phrase) {
      return new Response(JSON.stringify({ translation: null, msa: null }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const dialectLabel = dialect === 'Egyptian' ? 'Egyptian Arabic (مصري)' : dialect === 'Yemeni' ? 'Yemeni Arabic (يمني)' : 'Gulf Arabic (Khaliji)';
    
    const isWord = mode === 'word' || (mode === 'auto' && !phrase.includes(' '));

    const contextBlock = sentenceArabic
      ? `\n\nCONTEXT — the word/phrase appears inside this sentence:\nArabic sentence: "${sentenceArabic}"${sentenceEnglish ? `\nAccepted English translation: "${sentenceEnglish}"` : ''}\n\nIMPORTANT: Choose the meaning that fits THIS sentence's context. Many Arabic words have multiple senses — pick the one consistent with the accepted translation above, not the most common dictionary meaning.`
      : '';

    const translationPrompt = isWord
      ? `You are a ${dialectLabel} translator. Translate the given Arabic word to English. Return ONLY the English translation — no explanation, no punctuation around it, just 1-4 words.${contextBlock}`
      : `You are a ${dialectLabel} translator. Translate the given Arabic phrase to natural English. Return ONLY the English translation — no explanation, no punctuation around it, just a brief translation.${contextBlock}`;

    const msaPrompt = `Convert this ${dialectLabel} word/phrase to Modern Standard Arabic (فصحى). Return ONLY the MSA Arabic script, no explanation.${contextBlock}`;

    // For multi-word phrases, also produce a word-for-word literal gloss so
    // learners see how the phrase is built. Single words don't need one.
    const literalPrompt = `You are a ${dialectLabel} translator. Give a word-for-word English gloss of the given Arabic phrase, preserving the Arabic word order (e.g. "what news-your?" for "شخبارك؟"). It may sound stiff — that is expected. Return ONLY the gloss, no explanation.${contextBlock}`;

    async function callModel(model: string, systemPrompt: string, userContent: string, maxTokens: number): Promise<string | null> {
      // Each leg is independently optional — the response ships whichever of
      // translation / MSA / literal came back — so an unroutable model is null,
      // not a throw.
      if (!tryChatRoute(model)) return null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await chatFetch(model, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.1,
        }, { signal: controller.signal, label: 'translate-phrase' });
        if (!response.ok) {
          console.warn(`[translate-phrase] ${model} ${response.status}`);
          return null;
        }
        const data = await response.json();
        return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
      } catch (e) {
        console.warn(`[translate-phrase] ${model} failed:`, e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    // TRANSLATION lineup ensemble (Claude Sonnet 4.5 + Gemini 3.5 Flash).
    // Both run in parallel; Claude preferred when both succeed. MSA conversion
    // is a single cheap Gemini call.
    const [claudeT, geminiT, msa, literalT] = await Promise.all([
      callModel(MODEL_LINEUPS.TRANSLATION.drafters[0], translationPrompt, phrase, 80),
      callModel(MODEL_LINEUPS.TRANSLATION.drafters[1], translationPrompt, phrase, 80),
      callModel(MODEL_LINEUPS.TRANSLATION.drafters[1], msaPrompt, phrase, 50),
      // Literal gloss only for multi-word phrases.
      isWord
        ? Promise.resolve(null)
        : callModel(MODEL_LINEUPS.TRANSLATION.drafters[1], literalPrompt, phrase, 80),
    ]);

    const translation = claudeT ?? geminiT ?? '';

    console.log('Translation:', phrase, '->', translation, `(claude=${!!claudeT}, gemini=${!!geminiT})`);

    // Both models failed (e.g. missing API keys or upstream errors). Surface a
    // real error instead of silently returning an empty translation that looks
    // like "no result" to the learner.
    if (!translation) {
      return new Response(
        JSON.stringify({ error: 'translation_unavailable', message: 'Translation service is temporarily unavailable. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ translation, msa: msa || '', literal: literalT || '' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('translate-phrase error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});