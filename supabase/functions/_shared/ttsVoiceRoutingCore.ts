// The one table of dialect → voice truth, as a pure function of (dialect, config).
//
// Before this module the mapping lived in six places that disagreed: Yemeni was
// Azure `ar-YE-MaryamNeural` from a flashcard, Azure `ar-YE-SalehNeural` in the
// conversation simulator, and Munsit's Gulf voice from the video-clip fallback —
// three answers to one question, differing even on the speaker's gender. Every
// surface now asks here instead.
//
// Pure and import-free on purpose, the same constraint `dialectTypes.ts`
// documents: the Deno wrapper feeds it secrets and a live voice catalogue, the
// Vitest suite feeds it fixtures, and neither can drift from the other.

export type TtsProvider = "munsit" | "azure" | "elevenlabs";

/** Which rung of the chain produced a plan. Logged, header-exposed, asserted. */
export type VoiceSource =
  | "munsit-pinned"
  | "munsit-native"
  | "munsit-gulf-fallback"
  | "elevenlabs-egyptian"
  | "azure-emergency";

export type AppDialect = "Gulf" | "Egyptian" | "Yemeni" | "MSA";

/** A voice as Munsit's `GET /voices` returns it. */
export interface MunsitVoice {
  voice_id: string;
  name?: string | null;
  gender?: string | null;
  dialect?: string[] | null;
  type?: string | null;
}

// Munsit's own dialect vocabulary. `khaleeji` is their pan-Gulf tag; `najdi` and
// `hijazi` are Saudi; `fusha` is MSA. The extra country names cost nothing and
// cover the tags their catalogue may grow.
const GULF_TAGS = [
  "khaleeji", "gulf", "emirati", "najdi", "hijazi",
  "saudi", "kuwaiti", "qatari", "bahraini", "omani",
];

/**
 * Munsit `dialect` tags per app dialect, most-specific group first.
 *
 * Yemeni leads with its own tags even though Munsit's documented catalogue has
 * no Yemeni voice today — if they ever ship one it is picked up with no code
 * change, and until then the second group routes Yemeni to a Gulf voice. That
 * is a deliberate accent compromise: the Gulf voice is the wrong dialect family
 * but sounds far closer to Yemeni than Azure's `ar-YE-*` neurals, which is the
 * complaint that prompted all of this. Do not "fix" it back.
 */
export const MUNSIT_DIALECT_TAGS: Record<AppDialect, string[][]> = {
  Yemeni: [["yemeni", "sanaani", "taizzi", "adeni"], GULF_TAGS],
  Gulf: [GULF_TAGS],
  Egyptian: [["masri", "egyptian", "cairene", "egypt"]],
  MSA: [["fusha", "msa", "standard"]],
};

/**
 * Azure voices, reachable only when Munsit is unavailable.
 *
 * This is the bottom of the chain and nothing else. A plan carrying
 * `source: "azure-emergency"` in normal operation means Munsit discovery is
 * failing, not that Azure was chosen.
 */
export const AZURE_FALLBACK_VOICES: Record<AppDialect, string[]> = {
  Gulf: ["ar-AE-HamdanNeural", "ar-AE-FatimaNeural"],
  Egyptian: ["ar-EG-ShakirNeural", "ar-EG-SalmaNeural"],
  Yemeni: ["ar-YE-MaryamNeural", "ar-YE-SalehNeural"],
  MSA: ["ar-SA-HamedNeural"],
};

/**
 * Native Egyptian ElevenLabs voices, kept as the Egyptian-only rung between
 * Munsit and Azure.
 *
 * Munsit advertises Egyptian coverage but their documented catalogue lists only
 * Gulf and fusha voices, so whether this rung is ever reached depends on what
 * `GET /voices` actually returns for the account. If Egyptian voices are there,
 * this is dead weight; if they are not, it is the difference between an Egyptian
 * learner hearing an Egyptian voice and hearing a Gulf one. Runtime decides.
 */
export const ELEVENLABS_EGYPTIAN_VOICE_IDS = [
  "6aXW46RTUz6Y2lkBGQ1a", // Farida — Lively and Radiant (female, ar-EG)
  "rMheqEfwsIJckq2yCdb5", // Ahmed Yahia (male, ar-EG)
  "ckGEQg6YnSVooU5uDRsF", // Tarek — Pleasant and Professional (male, ar-EG)
];

/**
 * OpenAI Realtime personas for the live voice call.
 *
 * Not TTS voices and not swappable for Munsit ones: the Realtime API ships a
 * fixed set of eight and the dialect comes from the system prompt, not the
 * voice. Co-located anyway so every voice decision in the app is in one file.
 *
 * Yemeni shares Gulf's `ballad` because that is the voice that was preferred
 * over the alternatives — `REALTIME_VOICE_YEMENI` overrides it (`ash` is the
 * nearest warm male voice) if the two should be told apart on a call.
 */
export const REALTIME_VOICE_BY_DIALECT: Record<string, string> = {
  Gulf: "ballad",
  Egyptian: "shimmer",
  Yemeni: "ballad",
};

export interface VoiceConfig {
  /** The account's whole `GET /voices` catalogue, as returned. */
  munsitVoices: MunsitVoice[];
  munsitModelId: string | null;
  munsitAvailable: boolean;
  /** Per-dialect explicit voice IDs from secrets. Yemeni's is the cloned voice. */
  pinnedVoiceIds: Partial<Record<AppDialect, string[]>>;
  /** Per-dialect provider pin / rollback lever. */
  providerOverride: Partial<Record<AppDialect, TtsProvider | "auto">>;
  /** Let a single pinned voice speak every role in a multi-speaker episode. */
  allowSingleVoiceEpisodes: boolean;
  elevenLabsEgyptianVoiceIds: string[];
  elevenLabsModelId: string;
  elevenLabsAvailable: boolean;
  azureAvailable: boolean;
}

export interface VoicePlan {
  provider: TtsProvider;
  /** Ordered, always at least one entry. Indexed by `pickVoiceSlot`. */
  voices: string[];
  modelId?: string;
  ext: "wav" | "mp3";
  contentType: "audio/wav" | "audio/mpeg";
  source: VoiceSource;
}

const DIALECT_ALIASES: Record<string, AppDialect> = {
  gulf: "Gulf", khaleeji: "Gulf", khaleji: "Gulf", najdi: "Gulf", hijazi: "Gulf",
  saudi: "Gulf", kuwaiti: "Gulf", uae: "Gulf", emirati: "Gulf",
  bahraini: "Gulf", qatari: "Gulf", omani: "Gulf",
  egyptian: "Egyptian", egypt: "Egyptian", masri: "Egyptian", cairene: "Egyptian",
  yemeni: "Yemeni", yemen: "Yemeni", sanaani: "Yemeni", taizzi: "Yemeni", adeni: "Yemeni",
  msa: "MSA", fusha: "MSA", fus7a: "MSA", standard: "MSA", classical: "MSA",
};

/**
 * Folds every dialect label used anywhere in the app onto the four the voice
 * chain knows about.
 *
 * The labels are genuinely inconsistent upstream: `src/config.ts` expands Gulf
 * into six country names for video filtering, the admin video form adds MSA and
 * three dialects with no voice mapping at all, and the client hooks used to
 * lower-case-compare against two different hand-maintained sets. Unknown labels
 * (Levantine, Maghrebi, Iraqi — tagged on videos, never a learner module) fall
 * back to Gulf, which is what every call site already did implicitly.
 */
export function normalizeDialect(dialect?: string | null): AppDialect {
  if (!dialect) return "Gulf";
  return DIALECT_ALIASES[dialect.trim().toLowerCase()] ?? "Gulf";
}

function munsitPlan(voices: string[], cfg: VoiceConfig, source: VoiceSource): VoicePlan {
  return {
    provider: "munsit",
    voices,
    modelId: cfg.munsitModelId ?? undefined,
    ext: "wav",
    contentType: "audio/wav",
    source,
  };
}

/**
 * Voices from the catalogue carrying any of `tags`, preferring male.
 *
 * The male preference is inherited from story narration, where the mixed set
 * produced episodes that alternated between a calm host and one that sounded
 * like shouting. It is a preference and not a filter: if there are not enough
 * male voices to fill the requested slots, the rest of the matches are used
 * rather than dropping to a worse provider over a gender.
 */
function matchByTag(catalogue: MunsitVoice[], tags: string[], minVoices: number): string[] {
  const wanted = new Set(tags);
  const matched = catalogue.filter((voice) =>
    Array.isArray(voice.dialect) &&
    voice.dialect.some((tag) => wanted.has(String(tag).toLowerCase()))
  );
  if (matched.length === 0) return [];

  const male = matched.filter((voice) => String(voice.gender ?? "").toLowerCase() === "male");
  const ordered = male.length >= minVoices ? male : [...male, ...matched.filter((v) => !male.includes(v))];
  return ordered.map((voice) => voice.voice_id);
}

/**
 * Resolves a dialect to a provider and an ordered voice list.
 *
 * @param minVoices distinct voices the caller needs — 1 for a single word or a
 *   narrator, 2 for a two-host Listen episode. A rung that cannot supply this
 *   many is passed over in favour of one that can — but only down to the bottom
 *   of the Munsit tier. Dropping a provider to win distinctness would trade the
 *   quality this whole chain exists to protect; see the loop below.
 */
export function planVoices(
  dialect: string,
  cfg: VoiceConfig,
  opts: { minVoices?: number } = {},
): VoicePlan {
  const target = normalizeDialect(dialect);
  const minVoices = Math.max(1, opts.minVoices ?? 1);
  const override = cfg.providerOverride[target] ?? "auto";

  // An override names the rung to start at, and the chain still runs from there
  // downward — so a pin to a provider that turns out to be unavailable degrades
  // to the next one instead of returning silence.
  const skipMunsit = override === "azure" || override === "elevenlabs";
  const skipElevenLabs = override === "azure";

  // Distinct voices are preferred, but not at the cost of a provider tier.
  //
  // The first pass asks each rung for `minVoices`; if nothing on Munsit can
  // supply that many, the second asks for one rather than dropping to Azure. A
  // two-host episode read by one natural Munsit voice beats the same episode in
  // two Azure voices — the same judgement that moved Yemeni off `ar-YE-*` in the
  // first place. Within a tier the preference still holds: a single cloned voice
  // gives way to two distinct Gulf ones, because that costs no quality.
  for (const want of minVoices > 1 ? [minVoices, 1] : [minVoices]) {
    if (skipMunsit || !cfg.munsitAvailable || !cfg.munsitModelId) break;

    // 1. Pinned IDs. For Yemeni this is the cloned voice, and it is the only way
    //    a clone can ever be selected: Munsit returns `null` for `gender`,
    //    `dialect` and `type` on cloned voices, so tag matching below can never
    //    find one.
    const pinned = cfg.pinnedVoiceIds[target] ?? [];
    const needed = cfg.allowSingleVoiceEpisodes ? 1 : want;
    if (pinned.length >= needed) {
      return munsitPlan(fill(pinned, minVoices), cfg, "munsit-pinned");
    }

    // 2. Native voices by dialect tag, then 3. the Gulf fallback group, which
    //    only Yemeni has.
    const groups = MUNSIT_DIALECT_TAGS[target];
    for (let group = 0; group < groups.length; group++) {
      const matched = matchByTag(cfg.munsitVoices, groups[group], want);
      if (matched.length < want) continue;

      const isGulfFallback = target === "Yemeni" && group > 0;
      // Yemeni borrowing the Gulf voices reads the same list rotated by one, so
      // the two dialects never lead with the same voice. With a single Gulf
      // voice in the catalogue the rotation is a no-op and they do match — which
      // is a catalogue limit, not something to work around here.
      const voices = isGulfFallback ? rotate(matched) : matched;
      return munsitPlan(
        fill(voices, minVoices),
        cfg,
        isGulfFallback ? "munsit-gulf-fallback" : "munsit-native",
      );
    }
  }

  // 4. ElevenLabs, Egyptian only — reached when the Munsit catalogue has no
  //    Egyptian voices. See ELEVENLABS_EGYPTIAN_VOICE_IDS.
  if (
    !skipElevenLabs && target === "Egyptian" &&
    cfg.elevenLabsAvailable && cfg.elevenLabsEgyptianVoiceIds.length > 0
  ) {
    return {
      provider: "elevenlabs",
      voices: fill(cfg.elevenLabsEgyptianVoiceIds, minVoices),
      modelId: cfg.elevenLabsModelId,
      ext: "mp3",
      contentType: "audio/mpeg",
      source: "elevenlabs-egyptian",
    };
  }

  // 5. Azure. Always satisfies minVoices — every entry has at least one voice
  //    and `fill` repeats it — so the chain can never fall off the end.
  return {
    provider: "azure",
    voices: fill(AZURE_FALLBACK_VOICES[target], minVoices),
    ext: "mp3",
    contentType: "audio/mpeg",
    source: "azure-emergency",
  };
}

/** `[a, b, c]` → `[b, c, a]`. */
function rotate(voices: string[]): string[] {
  return voices.length < 2 ? voices : [...voices.slice(1), voices[0]];
}

/**
 * Repeats the list until it has `minVoices` entries.
 *
 * Only reached once a rung has already been accepted — either because it had
 * enough distinct voices, or because `allowSingleVoiceEpisodes` said one cloned
 * voice may play every role. Azure's lists are short enough that MSA (one voice)
 * needs it for a two-speaker episode.
 */
function fill(voices: string[], minVoices: number): string[] {
  if (voices.length === 0 || voices.length >= minVoices) return voices;
  const out = [...voices];
  while (out.length < minVoices) out.push(voices[out.length % voices.length]);
  return out;
}

/**
 * Which voice in the plan a line is spoken by.
 *
 * Narration deliberately shares the podcast host's slot: that voice is proven on
 * long-form reading, where slot 1 sounded energetic to the point of shouting.
 */
export function pickVoiceSlot(role: string, index: number): number {
  const r = (role || "").toLowerCase();
  if (r.includes("host_b") || r === "guest" || r === "character") return 1;
  if (r === "narrator" || r === "speaker") return 0;
  return index % 2;
}

/** Distinct voice slots a whole script needs, so every line plans identically. */
export function slotsNeeded(roles: string[]): number {
  if (roles.length === 0) return 1;
  return new Set(roles.map((role, index) => pickVoiceSlot(role, index))).size;
}
