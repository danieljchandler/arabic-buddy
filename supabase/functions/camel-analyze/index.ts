/**
 * camel-analyze — Arabic text analysis via:
 *   • Farasa REST API (QCRI)  → diacritization, morphological segmentation, POS tagging
 *   • CAMeL-Lab HuggingFace models (NYU Abu Dhabi) → dialect identification
 *
 * Actions:
 *   diacritize  - Add tashkeel (short vowels) to unvoweled Arabic text
 *   segment     - Morphological segmentation (prefix/stem/suffix breakdown)
 *   pos         - Part-of-speech tagging
 *   dialect     - Identify Gulf dialect variant (Kuwait/Qatar/UAE/Saudi/Oman/Bahrain/MSA)
 *
 * Env vars required:
 *   HUGGINGFACE_API_KEY  — for CAMeL-Lab dialect model
 *
 * Env vars optional (Farasa is free/no-auth):
 *   (none — Farasa webapi is public)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Farasa REST API ──────────────────────────────────────────────────────────

const FARASA_BASE = 'https://farasa.qcri.org/webapi';

type FarasaTask = 'diac' | 'seg' | 'pos' | 'NER';

/**
 * Call a Farasa WebAPI endpoint.
 * Returns the processed text string, or null on failure.
 *
 * Farasa returns different formats per task:
 *   diac → plain diacritized string
 *   seg  → space-separated morpheme+ string (prefix+stem+suffix)
 *   pos  → "word/TAG word/TAG ..." string
 */
async function callFarasa(task: FarasaTask, text: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const body = new URLSearchParams({ text });
    const response = await fetch(`${FARASA_BASE}/${task}/`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Farasa ${task} error ${response.status}:`, errText.slice(0, 200));
      return null;
    }

    // Farasa returns JSON: { "text": "...", "output": "..." } — field name varies by task
    const data = await response.json();
    return (data.text ?? data.output ?? data.result ?? null) as string | null;
  } catch (e) {
    console.warn(`Farasa ${task} failed:`, e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── POS tag output parser ────────────────────────────────────────────────────

interface PosToken {
  word: string;
  tag: string;
  tagDescription: string;
}

/** Map common Farasa POS tags to human-readable labels for learners. */
const POS_DESCRIPTIONS: Record<string, string> = {
  'NNP': 'Proper noun',
  'NN':  'Noun',
  'VBP': 'Verb (present)',
  'VBD': 'Verb (past)',
  'VBN': 'Verb (participle)',
  'JJ':  'Adjective',
  'RB':  'Adverb',
  'IN':  'Preposition',
  'CC':  'Conjunction',
  'DT':  'Determiner',
  'PRP': 'Pronoun',
  'CD':  'Number',
  'PUNC':'Punctuation',
  'UH':  'Interjection',
  'FW':  'Foreign word',
};

/** Parse "word/TAG word/TAG ..." output from Farasa POS endpoint. */
function parsePosOutput(raw: string): PosToken[] {
  return raw.trim().split(/\s+/).map(token => {
    const lastSlash = token.lastIndexOf('/');
    if (lastSlash === -1) return { word: token, tag: '?', tagDescription: 'Unknown' };
    const word = token.slice(0, lastSlash);
    const tag  = token.slice(lastSlash + 1);
    return { word, tag, tagDescription: POS_DESCRIPTIONS[tag] ?? tag };
  });
}

// ── Morphological segment parser ─────────────────────────────────────────────

interface MorphSegment {
  /** The raw segmented token, e.g. "و+ذهب+ت" */
  raw: string;
  /** Prefix clitics (e.g. conjunction "و", preposition "ب") */
  prefixes: string[];
  /** Core stem */
  stem: string;
  /** Suffix clitics (e.g. pronoun "ت", definiteness "ال") */
  suffixes: string[];
}

/**
 * Parse Farasa segmentation output.
 * Farasa marks boundaries with "+", e.g. "ب+الكتاب" → prefix ب, stem الكتاب
 */
function parseSegOutput(raw: string): MorphSegment[] {
  return raw.trim().split(/\s+/).map(token => {
    const parts = token.split('+');
    // Heuristic: if first part is short (1-2 chars) it's a prefix; last similarly
    const prefixes: string[] = [];
    const suffixes: string[] = [];
    let stemIdx = 0;
    let stemEnd = parts.length - 1;

    // Common Arabic prefixes (single-char clitics)
    const PREFIX_SET = new Set(['و', 'ف', 'ب', 'ل', 'ك', 'لل', 'ال', 'وال', 'فال', 'بال', 'كال']);
    const SUFFIX_SET = new Set(['ه', 'ها', 'هم', 'هن', 'ي', 'ك', 'نا', 'كم', 'هما', 'تم', 'ت', 'وا', 'ون', 'ين', 'ان']);

    while (stemIdx < stemEnd && PREFIX_SET.has(parts[stemIdx])) {
      prefixes.push(parts[stemIdx++]);
    }
    while (stemEnd > stemIdx && SUFFIX_SET.has(parts[stemEnd])) {
      suffixes.unshift(parts[stemEnd--]);
    }

    return {
      raw: token,
      prefixes,
      stem: parts.slice(stemIdx, stemEnd + 1).join('+'),
      suffixes,
    };
  });
}

// ── CAMeL-Lab Dialect Identification ─────────────────────────────────────────

/**
 * Gulf-relevant MADAR city/country codes used by CAMeL-Lab dialect model.
 * Model: CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter
 */
const GULF_CITY_MAP: Record<string, { country: string; dialect: string; isGulf: boolean }> = {
  // Gulf
  KUW: { country: 'Kuwait',       dialect: 'Kuwaiti',  isGulf: true  },
  DOH: { country: 'Qatar',        dialect: 'Qatari',   isGulf: true  },
  RIY: { country: 'Saudi Arabia', dialect: 'Saudi',    isGulf: true  },
  JED: { country: 'Saudi Arabia', dialect: 'Hijazi',   isGulf: true  },
  ABU: { country: 'UAE',          dialect: 'Emirati',  isGulf: true  },
  DUB: { country: 'UAE',          dialect: 'Emirati',  isGulf: true  },
  MSC: { country: 'Oman',         dialect: 'Omani',    isGulf: true  },
  BAH: { country: 'Bahrain',      dialect: 'Bahraini', isGulf: true  },
  // Non-Gulf Arabic
  CAI: { country: 'Egypt',    dialect: 'Egyptian',    isGulf: false },
  ALE: { country: 'Syria',    dialect: 'Levantine',   isGulf: false },
  BEI: { country: 'Lebanon',  dialect: 'Lebanese',    isGulf: false },
  AMM: { country: 'Jordan',   dialect: 'Jordanian',   isGulf: false },
  TRI: { country: 'Libya',    dialect: 'Libyan',      isGulf: false },
  TUN: { country: 'Tunisia',  dialect: 'Tunisian',    isGulf: false },
  ALG: { country: 'Algeria',  dialect: 'Algerian',    isGulf: false },
  MOR: { country: 'Morocco',  dialect: 'Moroccan',    isGulf: false },
  // MSA
  MSA: { country: 'MSA',  dialect: 'Modern Standard Arabic', isGulf: false },
};

interface DialectResult {
  /** Top predicted label code (e.g. "KUW") */
  code: string;
  /** Human-readable dialect name */
  dialect: string;
  /** Country name */
  country: string;
  /** Confidence score 0–1 */
  confidence: number;
  /** Whether the top prediction is a Gulf dialect */
  isGulf: boolean;
  /** Top-5 predictions */
  topPredictions: { code: string; dialect: string; score: number }[];
  /** Source of prediction: "camel-hf" or "unavailable" */
  source: 'camel-hf' | 'unavailable';
}

async function callCamelDialect(text: string, hfApiKey: string): Promise<DialectResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  // CAMeL-Lab dialect identification — city-level, MADAR dataset
  const MODEL = 'CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter';

  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${MODEL}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${hfApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      // 503 = model loading (cold start) — expected on free tier
      if (response.status === 503) {
        console.warn('CAMeL-Lab dialect model loading (cold start). Retry in ~20s.');
      } else {
        console.warn(`CAMeL dialect error ${response.status}:`, errText.slice(0, 200));
      }
      return null;
    }

    // HF returns: [{ label: "KUW", score: 0.87 }, ...]
    const predictions: { label: string; score: number }[] = await response.json();
    if (!Array.isArray(predictions) || predictions.length === 0) return null;

    const top = predictions[0];
    const code = top.label.toUpperCase();
    const meta = GULF_CITY_MAP[code] ?? { country: 'Unknown', dialect: code, isGulf: false };

    const topPredictions = predictions.slice(0, 5).map(p => ({
      code: p.label.toUpperCase(),
      dialect: GULF_CITY_MAP[p.label.toUpperCase()]?.dialect ?? p.label,
      score: Math.round(p.score * 1000) / 1000,
    }));

    return {
      code,
      dialect: meta.dialect,
      country: meta.country,
      confidence: Math.round(top.score * 1000) / 1000,
      isGulf: meta.isGulf,
      topPredictions,
      source: 'camel-hf',
    };
  } catch (e) {
    console.warn('CAMeL dialect call failed:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, actions } = body as {
      text: string;
      actions?: ('diacritize' | 'segment' | 'pos' | 'dialect')[];
    };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: diacritize only (most universally useful)
    const requestedActions = actions ?? ['diacritize'];

    const wantDiac    = requestedActions.includes('diacritize');
    const wantSegment = requestedActions.includes('segment');
    const wantPos     = requestedActions.includes('pos');
    const wantDialect = requestedActions.includes('dialect');

    console.log(`camel-analyze: text="${text.slice(0, 60)}" actions=[${requestedActions.join(',')}]`);

    // ── Parallel API calls ────────────────────────────────────────────────────

    const hfApiKey = Deno.env.get('HUGGINGFACE_API_KEY') ?? '';

    const [diacResult, segResult, posResult, dialectResult] = await Promise.all([
      wantDiac    ? callFarasa('diac', text)                          : Promise.resolve(null),
      wantSegment ? callFarasa('seg', text)                           : Promise.resolve(null),
      wantPos     ? callFarasa('pos', text)                           : Promise.resolve(null),
      wantDialect && hfApiKey ? callCamelDialect(text, hfApiKey)      : Promise.resolve(null),
    ]);

    // ── Build response ────────────────────────────────────────────────────────

    const result: Record<string, unknown> = {
      inputText: text,
      actions: requestedActions,
    };

    if (wantDiac) {
      result.diacritized = diacResult ?? null;
      result.diacritizeAvailable = diacResult !== null;
    }

    if (wantSegment && segResult) {
      result.segmentedRaw = segResult;
      result.segments = parseSegOutput(segResult);
    } else if (wantSegment) {
      result.segments = null;
    }

    if (wantPos && posResult) {
      result.posTaggedRaw = posResult;
      result.posTokens = parsePosOutput(posResult);
    } else if (wantPos) {
      result.posTokens = null;
    }

    if (wantDialect) {
      result.dialect = dialectResult;
      if (!dialectResult && !hfApiKey) {
        result.dialectError = 'HUGGINGFACE_API_KEY not configured — set this secret in Supabase dashboard';
      } else if (!dialectResult) {
        result.dialectError = 'CAMeL-Lab model unavailable (possible cold start — retry in 30s)';
      }
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('camel-analyze error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
