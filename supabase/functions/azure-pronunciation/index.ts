/**
 * azure-pronunciation — Azure Cognitive Services Pronunciation Assessment for Arabic.
 *
 * Evaluates learner pronunciation against a reference Arabic text and returns
 * granular scores at the overall, word, and phoneme levels.
 *
 * Supported Gulf Arabic locales (pass as `locale` in request body):
 *   ar-SA  Saudi Arabia (default)
 *   ar-QA  Qatar
 *   ar-KW  Kuwait
 *   ar-BH  Bahrain
 *   ar-AE  UAE
 *   ar-OM  Oman
 *   ar-EG  Egypt (MSA / Egyptian dialect)
 *
 * Request body:
 *   {
 *     audioBase64:  string   // Base64-encoded audio blob (WebM/Opus from MediaRecorder)
 *     referenceText: string  // Arabic text the learner was asked to pronounce
 *     locale?:      string   // BCP-47 locale, default "ar-SA"
 *     audioMimeType?: string // MIME type, default "audio/webm"
 *   }
 *
 * Response:
 *   {
 *     overall:        number   // PronScore 0–100
 *     accuracy:       number   // Phoneme-level accuracy 0–100
 *     fluency:        number   // Speaking rate / pauses 0–100
 *     completeness:   number   // Words spoken vs reference 0–100
 *     words: [{
 *       word:       string
 *       accuracy:   number
 *       errorType:  "None" | "Omission" | "Insertion" | "Mispronunciation"
 *       phonemes: [{ phoneme: string, accuracy: number }]
 *     }]
 *     recognizedText: string   // What Azure actually heard
 *     locale:         string
 *   }
 *
 * Required environment variables:
 *   AZURE_SPEECH_KEY      — Azure Cognitive Services speech resource key
 *
 * Provide ONE of the following to identify the endpoint:
 *   AZURE_SPEECH_ENDPOINT — Custom endpoint URL from Azure AI multi-service
 *                           resource (e.g. https://xxx.cognitiveservices.azure.com/)
 *                           Takes priority over AZURE_SPEECH_REGION when set.
 *   AZURE_SPEECH_REGION   — Azure region for standard Speech resource
 *                           (e.g. "eastus", "uaenorth")
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AZURE_SPEECH_KEY = Deno.env.get('AZURE_SPEECH_KEY') ?? '';
const AZURE_SPEECH_ENDPOINT = Deno.env.get('AZURE_SPEECH_ENDPOINT') ?? '';
const AZURE_SPEECH_REGION = Deno.env.get('AZURE_SPEECH_REGION') ?? 'eastus';

/** Build the STT REST endpoint URL, preferring a custom endpoint if configured */
function getSttEndpoint(): string {
  if (AZURE_SPEECH_ENDPOINT) {
    const base = AZURE_SPEECH_ENDPOINT.replace(/\/$/, '');
    // Azure AI multi-service resources require /stt/ prefix
    return `${base}/stt/speech/recognition/conversation/cognitiveservices/v1`;
  }
  return `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
}

const SUPPORTED_LOCALES = ['ar-SA', 'ar-QA', 'ar-KW', 'ar-BH', 'ar-AE', 'ar-OM', 'ar-EG'];

/** Azure Pronunciation Assessment config sent as base64 header */
interface PronunciationConfig {
  ReferenceText: string;
  GradingSystem: 'HundredMark';
  Granularity: 'Phoneme';
  EnableMiscue: boolean;
}

interface PhonemeResult {
  phoneme: string;
  accuracy: number;
}

interface WordResult {
  word: string;
  accuracy: number;
  errorType: 'None' | 'Omission' | 'Insertion' | 'Mispronunciation';
  phonemes: PhonemeResult[];
}

interface PronunciationResult {
  overall: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  words: WordResult[];
  recognizedText: string;
  locale: string;
}

/** Parse Azure NBest[0] into a clean PronunciationResult */
// deno-lint-ignore no-explicit-any
function parseAzureResponse(nbest: any, locale: string): PronunciationResult {
  const pa = nbest.PronunciationAssessment ?? {};

  const words: WordResult[] = (nbest.Words ?? []).map(
    // deno-lint-ignore no-explicit-any
    (w: any): WordResult => ({
      word: w.Word ?? '',
      accuracy: w.PronunciationAssessment?.AccuracyScore ?? 0,
      errorType: w.PronunciationAssessment?.ErrorType ?? 'None',
      phonemes: (w.Phonemes ?? []).map(
        // deno-lint-ignore no-explicit-any
        (p: any): PhonemeResult => ({
          phoneme: p.Phoneme ?? '',
          accuracy: p.PronunciationAssessment?.AccuracyScore ?? 0,
        })
      ),
    })
  );

  return {
    overall: pa.PronScore ?? 0,
    accuracy: pa.AccuracyScore ?? 0,
    fluency: pa.FluencyScore ?? 0,
    completeness: pa.CompletenessScore ?? 0,
    words,
    recognizedText: nbest.Lexical ?? '',
    locale,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body — return 400 for malformed JSON
    let body: { audioBase64: string; referenceText: string; locale?: string; audioMimeType?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      audioBase64,
      referenceText,
      locale = 'ar-SA',
      audioMimeType = 'audio/webm',
    } = body;

    if (!audioBase64 || !referenceText) {
      return new Response(
        JSON.stringify({ error: 'audioBase64 and referenceText are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPPORTED_LOCALES.includes(locale)) {
      return new Response(
        JSON.stringify({ error: `Unsupported locale '${locale}'. Supported: ${SUPPORTED_LOCALES.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!AZURE_SPEECH_KEY) {
      return new Response(
        JSON.stringify({ error: 'Azure Speech key not configured (AZURE_SPEECH_KEY)' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the Pronunciation-Assessment header (base64-encoded JSON)
    const pronunciationConfig: PronunciationConfig = {
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      EnableMiscue: true,
    };
    // btoa() only handles Latin1 — encode the JSON as UTF-8 bytes, then base64
    const configUtf8 = new TextEncoder().encode(JSON.stringify(pronunciationConfig));
    let binaryStr = '';
    for (let i = 0; i < configUtf8.length; i++) {
      binaryStr += String.fromCharCode(configUtf8[i]);
    }
    const pronunciationHeader = btoa(binaryStr);

    // Decode audio from base64 — return 400 for invalid base64
    let audioBytes: Uint8Array;
    try {
      audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    } catch {
      return new Response(
        JSON.stringify({ error: 'audioBase64 is not valid base64' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine Content-Type — strip any existing codecs param and re-add
    const baseMime = audioMimeType.split(';')[0].trim();
    const contentType = baseMime === 'audio/webm'
      ? 'audio/webm; codecs=opus'
      : baseMime === 'audio/ogg'
      ? 'audio/ogg; codecs=opus'
      : baseMime; // wav, mp4, etc. passed as-is

    // Azure Speech REST endpoint
    const endpoint = getSttEndpoint();
    const params = new URLSearchParams({ language: locale, format: 'detailed' });

    // Bound the Azure call with a 10s timeout to prevent edge worker stalling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    let azureRes: Response;
    try {
      azureRes = await fetch(`${endpoint}?${params}`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
          'Content-Type': contentType,
          'Pronunciation-Assessment': pronunciationHeader,
          'Accept': 'application/json',
        },
        body: new Blob([new Uint8Array(audioBytes.buffer as ArrayBuffer)]),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Azure Speech request timed out' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (!azureRes.ok) {
      const errText = await azureRes.text();
      console.error(`Azure Speech error ${azureRes.status}:`, errText);
      return new Response(
        JSON.stringify({ error: `Azure API error ${azureRes.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await azureRes.json();
    console.log('Azure raw response:', JSON.stringify(data).slice(0, 2000));
    if (data.RecognitionStatus === 'NoMatch' || data.RecognitionStatus === 'InitialSilenceTimeout') {
      return new Response(
        JSON.stringify({
          error: 'No speech detected',
          recognitionStatus: data.RecognitionStatus,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nbest = data.NBest?.[0];
    if (!nbest) {
      return new Response(
        JSON.stringify({ error: 'No assessment results returned', raw: data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = parseAzureResponse(nbest, locale);
    console.log(`Pronunciation assessment [${locale}] overall=${result.overall} accuracy=${result.accuracy} words=${result.words.length}`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('azure-pronunciation error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
