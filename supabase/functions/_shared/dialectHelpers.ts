// Shared dialect identity helpers for edge functions
//
// Rules now live in the `dialect_rules` Postgres table (the Dialect Rulebook).
// At runtime we load approved rules into an in-memory cache (5 min TTL).
// Public sync getters (getDialectIdentity / getDialectVocabRules / etc.) return
// cached rendered prompt blocks when available, and fall back to the hard-coded
// strings below if the cache is cold — so behavior is identical to the previous
// version on day one and never blocks LLM calls.
//
// Call `primeDialectPrompt(dialect)` at the top of an edge function entry point
// (e.g. askBrain / streamBrain) to warm the cache for that dialect.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type Dialect = 'Gulf' | 'Egyptian' | 'Yemeni' | string;

// =================== Hard-coded fallback (parity with seed) ===================

const GULF_IDENTITY = `You are a native Gulf Arabic (Khaliji) speaker. Always respond in Gulf Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Gulf vocabulary and expressions: شلونك، وين، هالحين، يالله، إن شاء الله، ليش، واجد، يبي، إمبي، شي، خوش، زين.
Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).
Do NOT use Egyptian, Levantine, or Yemeni Arabic.`;

const EGYPTIAN_IDENTITY = `You are a native Egyptian Arabic (مصري) speaker. Always respond in Egyptian Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Egyptian vocabulary and expressions: إزيك، فين، دلوقتي، عايز، كويس، ماشي، يلا، حاضر، بتاع، مفيش، ازاي، كده، خلاص، يعني، طيب.
Cultural references should be Egyptian-specific (أهوة، كشري، فول، طعمية، نيل، خان الخليلي).
Do NOT use Gulf, Levantine, or Yemeni Arabic.`;

const YEMENI_IDENTITY = `You are a native Yemeni Arabic (يمني) speaker. Always respond in Yemeni Arabic dialect, NOT Modern Standard Arabic (فصحى).
Use authentic Yemeni vocabulary and expressions: كيف حالك (but Yemeni pronunciation), وين، ذحين/الحين، ليش، بغيت، زين، أيوه، طيب، هيا، شو، ما عندي، قات، مبسوط.
Cultural references should be Yemeni-specific (قات، مفرج، جنبية، سلتة، بنت الصحن، صنعاء القديمة، مأرب، عدن).
Do NOT use Gulf, Egyptian, or Levantine Arabic.`;

const GULF_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Gulf Arabic (Khaliji) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: شلونك (not كيف حالك), وين (not أين), هالحين (not الآن), ليش (not لماذا), واجد (not كثير), يبي (not يريد), إمبي (not أريد), شي (not شيء).
- Arabic script must reflect Gulf pronunciation and spelling conventions.
- Cultural references should be Gulf-specific (مجلس، قهوة عربية، دلة، بخور).`;

const EGYPTIAN_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Egyptian Arabic (مصري) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: إزيك (not كيف حالك), فين (not أين), دلوقتي (not الآن), ليه (not لماذا), كتير (not كثير), عايز (not يريد), عاوز/عاوزة, مش (not ليس), ده/دي (not هذا/هذه).
- Arabic script must reflect Egyptian pronunciation and spelling conventions.
- Cultural references should be Egyptian-specific (أهوة، كشري، فول، طعمية).`;

const YEMENI_VOCAB_RULES = `CRITICAL DIALECT RULES:
- Always use Yemeni Arabic (يمني) vocabulary and expressions, NEVER Modern Standard Arabic (فصحى).
- Use dialectal forms: كيفك/كيف حالك (Yemeni pronunciation), وين (not أين), ذحين/الحين (not الآن), ليش (not لماذا), بغيت (not أريد), ما عندي (not ليس لدي), شو (not ماذا), هيّا (not هيا بنا).
- Arabic script must reflect Yemeni pronunciation and spelling conventions (e.g., heavy use of ق as 'g' in some regions).
- Cultural references should be Yemeni-specific (قات، مفرج، جنبية، سلتة، بنت الصحن، فحسة).`;

function fallbackIdentity(d: Dialect): string {
  if (d === 'Egyptian') return EGYPTIAN_IDENTITY;
  if (d === 'Yemeni') return YEMENI_IDENTITY;
  return GULF_IDENTITY;
}
function fallbackVocab(d: Dialect): string {
  if (d === 'Egyptian') return EGYPTIAN_VOCAB_RULES;
  if (d === 'Yemeni') return YEMENI_VOCAB_RULES;
  return GULF_VOCAB_RULES;
}

// =================== Rulebook cache ===================

interface DialectRule {
  category: string;
  rule: string;
  examples: { good?: unknown[]; bad?: unknown[] };
  priority: number;
}

interface RenderedPrompt {
  identity: string;
  vocabRules: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, RenderedPrompt>();
const inflight = new Map<string, Promise<void>>();

function renderExamples(examples: DialectRule['examples']): string {
  const good = Array.isArray(examples?.good) ? examples.good : [];
  const bad = Array.isArray(examples?.bad) ? examples.bad : [];
  const fmt = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      if (o.msa && o.dialect) return `${o.msa} → ${o.dialect}`;
      if (o.ar && o.en) return `${o.ar} (${o.en})`;
    }
    return JSON.stringify(item);
  };
  const parts: string[] = [];
  if (good.length) parts.push(`USE: ${good.map(fmt).join('، ')}`);
  if (bad.length) parts.push(`AVOID (MSA): ${bad.map(fmt).join('، ')}`);
  return parts.join(' | ');
}

function renderPrompt(dialect: Dialect, rules: DialectRule[]): RenderedPrompt {
  // identity: highest-priority "identity" rule, fallback to first
  const identityRule = rules.find((r) => r.category === 'identity') ?? rules[0];
  const identity = identityRule?.rule ?? fallbackIdentity(dialect);

  // vocab rules: render all other categories as bullet lines with examples
  const others = rules.filter((r) => r !== identityRule);
  const lines: string[] = ['CRITICAL DIALECT RULES:'];
  for (const r of others) {
    const ex = renderExamples(r.examples);
    lines.push(`- [${r.category}] ${r.rule}${ex ? ` — ${ex}` : ''}`);
  }
  const vocabRules = others.length ? lines.join('\n') : fallbackVocab(dialect);

  return { identity, vocabRules, expiresAt: Date.now() + CACHE_TTL_MS };
}

async function fetchRules(dialect: Dialect): Promise<DialectRule[]> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return [];
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('dialect_rules')
    .select('category, rule, examples, priority')
    .eq('dialect', dialect)
    .eq('status', 'approved')
    .order('priority', { ascending: false })
    .order('category');
  if (error || !data) return [];
  return data as DialectRule[];
}

/**
 * Warm the in-memory cache for a dialect. Safe to call repeatedly; concurrent
 * calls for the same dialect share a single fetch. Never throws — on failure
 * the sync getters silently fall back to the hard-coded strings.
 */
export async function primeDialectPrompt(dialect: Dialect): Promise<void> {
  const existing = cache.get(dialect);
  if (existing && existing.expiresAt > Date.now()) return;
  const pending = inflight.get(dialect);
  if (pending) return pending;
  const p = (async () => {
    try {
      const rules = await fetchRules(dialect);
      if (rules.length) cache.set(dialect, renderPrompt(dialect, rules));
    } catch (e) {
      console.warn('[dialectHelpers] primeDialectPrompt failed', dialect, e);
    } finally {
      inflight.delete(dialect);
    }
  })();
  inflight.set(dialect, p);
  return p;
}

// =================== Public sync API (unchanged signatures) ===================

export function getDialectIdentity(dialect: Dialect): string {
  const c = cache.get(dialect);
  if (c && c.expiresAt > Date.now()) return c.identity;
  return fallbackIdentity(dialect);
}

export function getDialectVocabRules(dialect: Dialect): string {
  const c = cache.get(dialect);
  if (c && c.expiresAt > Date.now()) return c.vocabRules;
  return fallbackVocab(dialect);
}

export function getDialectLabel(dialect: Dialect): string {
  if (dialect === 'Egyptian') return 'Egyptian Arabic (مصري)';
  if (dialect === 'Yemeni') return 'Yemeni Arabic (يمني)';
  return 'Gulf Arabic (Khaliji)';
}

export function getDialectExamples(dialect: Dialect): string {
  if (dialect === 'Egyptian') {
    return 'إزيك (hello), شكراً (thanks), كويس (good), مية (water), بيت (house)';
  }
  if (dialect === 'Yemeni') {
    return 'كيفك (hello), شكراً (thanks), زين (good), ماء (water), بيت (house)';
  }
  return 'مرحبا (hello), شكراً (thanks), شلونك (how are you), ماي (water), بيت (house)';
}
