import { describe, expect, it } from "vitest";
import {
  AZURE_FALLBACK_VOICES,
  MUNSIT_DIALECT_TAGS,
  REALTIME_VOICE_BY_DIALECT,
  normalizeDialect,
  pickVoiceSlot,
  planVoices,
  slotsNeeded,
  type MunsitVoice,
  type VoiceConfig,
} from "../../supabase/functions/_shared/ttsVoiceRoutingCore";

/**
 * The dialect → voice table, which used to be six tables.
 *
 * Yemeni was the symptom that started this: a learner heard Azure's
 * `ar-YE-MaryamNeural` on a flashcard, Azure's `ar-YE-SalehNeural` in the
 * conversation simulator, and Munsit's Gulf voice from the video-clip fallback —
 * three answers to one question, differing even on the speaker's gender. Every
 * assertion below is really the same assertion: there is one answer now.
 *
 * The IO half (`ttsVoiceRouting`, which reads `Deno.env` and Munsit's catalogue)
 * is exercised from the Deno suite in `supabase/functions/_test/voice_routing_test.ts`.
 */

const gulfVoice = (id: string, gender = "male"): MunsitVoice => ({
  voice_id: id,
  name: id,
  gender,
  dialect: ["khaleeji", "najdi"],
  type: "neural",
});

/** A cloned voice as Munsit actually returns it — every descriptive field null. */
const clonedVoice = (id: string): MunsitVoice => ({
  voice_id: id,
  name: "Yemeni — friend",
  gender: null,
  dialect: null,
  type: null,
});

function config(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    munsitVoices: [gulfVoice("gulf-a"), gulfVoice("gulf-b"), gulfVoice("gulf-c")],
    munsitModelId: "faseeh-v1-preview",
    munsitAvailable: true,
    pinnedVoiceIds: {},
    providerOverride: {},
    allowSingleVoiceEpisodes: false,
    elevenLabsEgyptianVoiceIds: ["eleven-a", "eleven-b", "eleven-c"],
    elevenLabsModelId: "eleven_multilingual_v2",
    elevenLabsAvailable: true,
    azureAvailable: true,
    ...overrides,
  };
}

const egyptianVoice: MunsitVoice = {
  voice_id: "masri-1",
  name: "Masri",
  gender: "male",
  dialect: ["masri"],
  type: "neural",
};

const fushaVoice: MunsitVoice = {
  voice_id: "fusha-1",
  name: "Fusha",
  gender: "male",
  dialect: ["fusha"],
  type: "neural",
};

const yemeniVoice: MunsitVoice = {
  voice_id: "yemeni-1",
  name: "Sanaani",
  gender: "male",
  dialect: ["yemeni"],
  type: "neural",
};

describe("planVoices — every dialect resolves to Munsit", () => {
  // The headline claim of the whole change. If any of these four falls to Azure
  // with a healthy catalogue, the app is back to the voices it moved off.
  it.each([
    ["Gulf", "gulf-a"],
    ["Egyptian", "masri-1"],
    ["MSA", "fusha-1"],
  ])("routes %s to a Munsit voice carrying the right tag", (dialect, expectedVoice) => {
    const plan = planVoices(dialect, config({
      munsitVoices: [gulfVoice("gulf-a"), egyptianVoice, fushaVoice],
    }), { minVoices: 1 });

    expect(plan.provider).toBe("munsit");
    expect(plan.source).toBe("munsit-native");
    expect(plan.ext).toBe("wav");
    expect(plan.contentType).toBe("audio/wav");
    expect(plan.voices[0]).toBe(expectedVoice);
    expect(plan.modelId).toBe("faseeh-v1-preview");
  });

  it("uses a native Yemeni voice when the catalogue has one", () => {
    // Munsit's documented catalogue has no Yemeni voice today. The tag group is
    // checked first anyway so the day they ship one it is picked up with no code
    // change — and no rotation, because it is not borrowed from Gulf.
    const plan = planVoices("Yemeni", config({
      munsitVoices: [gulfVoice("gulf-a"), gulfVoice("gulf-b"), yemeniVoice],
    }), { minVoices: 1 });

    expect(plan.source).toBe("munsit-native");
    expect(plan.voices[0]).toBe("yemeni-1");
  });
});

describe("planVoices — Yemeni borrows a Gulf voice", () => {
  it("falls to Gulf and reports it, rather than to Azure", () => {
    const plan = planVoices("Yemeni", config(), { minVoices: 1 });

    expect(plan.provider).toBe("munsit");
    expect(plan.source).toBe("munsit-gulf-fallback");
  });

  it("does not lead with the same voice as Gulf", () => {
    // A deliberate accent compromise is one thing; Gulf and Yemeni being
    // indistinguishable is another. The rotation is what keeps them apart.
    const cfg = config();
    const gulf = planVoices("Gulf", cfg, { minVoices: 1 });
    const yemeni = planVoices("Yemeni", cfg, { minVoices: 1 });

    expect(yemeni.voices[0]).not.toBe(gulf.voices[0]);
    // Same pool, different order — not a different, worse provider.
    expect(new Set(yemeni.voices)).toEqual(new Set(gulf.voices));
  });

  it("still fills both slots of a two-host episode", () => {
    const plan = planVoices("Yemeni", config(), { minVoices: 2 });
    expect(plan.voices.length).toBeGreaterThanOrEqual(2);
    expect(plan.voices[0]).not.toBe(plan.voices[1]);
  });

  it("matches Gulf when the catalogue has only one Gulf voice", () => {
    // Documented rather than worked around: with one voice there is nothing to
    // rotate, and inventing a second would mean a worse provider.
    const cfg = config({ munsitVoices: [gulfVoice("only-one")] });
    expect(planVoices("Yemeni", cfg, { minVoices: 1 }).voices[0]).toBe("only-one");
    expect(planVoices("Gulf", cfg, { minVoices: 1 }).voices[0]).toBe("only-one");
  });
});

describe("planVoices — the cloned voice", () => {
  it("is selected from the pin, since tag matching can never find it", () => {
    // Munsit returns null for gender, dialect and type on cloned voices, so the
    // catalogue filters skip them entirely. Pinning by ID is not a convenience
    // here, it is the only mechanism that works — this test is what says so.
    const cfg = config({
      munsitVoices: [gulfVoice("gulf-a"), clonedVoice("cl-friend-8f21")],
      pinnedVoiceIds: { Yemeni: ["cl-friend-8f21"] },
    });
    const plan = planVoices("Yemeni", cfg, { minVoices: 1 });

    expect(plan.source).toBe("munsit-pinned");
    expect(plan.voices).toEqual(["cl-friend-8f21"]);
  });

  it("is ignored by tag matching when it is not pinned", () => {
    const cfg = config({
      munsitVoices: [gulfVoice("gulf-a"), gulfVoice("gulf-b"), clonedVoice("cl-friend-8f21")],
    });
    const plan = planVoices("Yemeni", cfg, { minVoices: 1 });

    expect(plan.voices).not.toContain("cl-friend-8f21");
  });

  it("keeps a two-host episode off a single cloned voice by default", () => {
    // One voice playing both hosts is worse than a slightly wrong accent, so an
    // episode stays on the Gulf voices until a second clone exists.
    const cfg = config({ pinnedVoiceIds: { Yemeni: ["cl-friend-8f21"] } });

    expect(planVoices("Yemeni", cfg, { minVoices: 2 }).source).toBe("munsit-gulf-fallback");
    expect(planVoices("Yemeni", cfg, { minVoices: 1 }).source).toBe("munsit-pinned");
  });

  it("lets one clone voice both hosts when told to", () => {
    const cfg = config({
      pinnedVoiceIds: { Yemeni: ["cl-friend-8f21"] },
      allowSingleVoiceEpisodes: true,
    });
    const plan = planVoices("Yemeni", cfg, { minVoices: 2 });

    expect(plan.source).toBe("munsit-pinned");
    expect(plan.voices).toEqual(["cl-friend-8f21", "cl-friend-8f21"]);
  });

  it("takes two pinned voices in the order they were configured", () => {
    const cfg = config({ pinnedVoiceIds: { Yemeni: ["cl-a", "cl-b"] } });
    expect(planVoices("Yemeni", cfg, { minVoices: 2 }).voices).toEqual(["cl-a", "cl-b"]);
  });
});

describe("planVoices — falling back", () => {
  it("drops to Azure only when Munsit is unavailable", () => {
    const plan = planVoices("Yemeni", config({ munsitAvailable: false }), { minVoices: 2 });

    expect(plan.provider).toBe("azure");
    expect(plan.source).toBe("azure-emergency");
    expect(plan.contentType).toBe("audio/mpeg");
    expect(plan.voices).toEqual(AZURE_FALLBACK_VOICES.Yemeni);
  });

  it("drops to Azure when discovery returned an empty catalogue", () => {
    const plan = planVoices("Gulf", config({ munsitVoices: [] }), { minVoices: 1 });
    expect(plan.source).toBe("azure-emergency");
  });

  it("would rather repeat one Munsit voice than drop a two-host episode to Azure", () => {
    // Distinctness is preferred, but not at the cost of a provider tier. A
    // catalogue with a single Gulf voice used to mean the whole episode fell to
    // Azure — two distinct voices, both worse than the one it passed over.
    const plan = planVoices("Gulf", config({ munsitVoices: [gulfVoice("only-one")] }), {
      minVoices: 2,
    });

    expect(plan.provider).toBe("munsit");
    expect(plan.voices).toEqual(["only-one", "only-one"]);
  });

  it("still prefers two distinct voices over one when both are on Munsit", () => {
    // The relaxation is a last resort within the tier, not a shortcut past it:
    // with real Gulf voices available a lone clone still gives way to them.
    const cfg = config({ pinnedVoiceIds: { Yemeni: ["cl-only"] } });
    expect(planVoices("Yemeni", cfg, { minVoices: 2 }).source).toBe("munsit-gulf-fallback");
  });

  it("uses the native Egyptian ElevenLabs voices when Munsit has no Egyptian one", () => {
    // Whether this rung is ever reached depends on the account's catalogue.
    // Downgrading Egyptian to a Gulf voice would be worse than the status quo,
    // so ElevenLabs sits between Munsit and Azure rather than being deleted.
    const plan = planVoices("Egyptian", config(), { minVoices: 2 });

    expect(plan.provider).toBe("elevenlabs");
    expect(plan.source).toBe("elevenlabs-egyptian");
    expect(plan.contentType).toBe("audio/mpeg");
  });

  it("does not offer ElevenLabs to any dialect but Egyptian", () => {
    for (const dialect of ["Gulf", "Yemeni", "MSA"]) {
      const plan = planVoices(dialect, config({ munsitAvailable: false }), { minVoices: 1 });
      expect(plan.provider).not.toBe("elevenlabs");
    }
  });

  it("repeats a short Azure list rather than falling off the end of the chain", () => {
    // MSA has exactly one Azure voice. A two-speaker episode must still get a
    // plan; returning fewer voices than slots would index past the array.
    const plan = planVoices("MSA", config({ munsitAvailable: false }), { minVoices: 2 });
    expect(plan.voices).toHaveLength(2);
  });
});

describe("planVoices — the rollback lever", () => {
  it("honours a per-dialect pin to Azure even with a healthy catalogue", () => {
    const cfg = config({
      pinnedVoiceIds: { Yemeni: ["cl-friend-8f21"] },
      providerOverride: { Yemeni: "azure" },
    });
    const plan = planVoices("Yemeni", cfg, { minVoices: 1 });

    expect(plan.provider).toBe("azure");
    expect(plan.voices[0]).toBe("ar-YE-MaryamNeural");
  });

  it("leaves the other dialects alone when one is pinned", () => {
    const cfg = config({ providerOverride: { Yemeni: "azure" } });
    expect(planVoices("Gulf", cfg, { minVoices: 1 }).provider).toBe("munsit");
  });

  it("still produces audio when pinned to a provider that is unavailable", () => {
    // A pin names where to start, not a cliff to fall off. Pinning Egyptian at
    // ElevenLabs with no ElevenLabs key must degrade to Azure, not to silence.
    const cfg = config({ providerOverride: { Egyptian: "elevenlabs" }, elevenLabsAvailable: false });
    expect(planVoices("Egyptian", cfg, { minVoices: 1 }).provider).toBe("azure");
  });
});

describe("normalizeDialect", () => {
  it.each([
    ["Gulf", "Gulf"], ["gulf", "Gulf"], ["khaleeji", "Gulf"], ["emirati", "Gulf"],
    ["Saudi", "Gulf"], ["kuwaiti", "Gulf"], ["UAE", "Gulf"], ["omani", "Gulf"],
    ["Egyptian", "Egyptian"], ["egypt", "Egyptian"], ["masri", "Egyptian"],
    ["Yemeni", "Yemeni"], ["yemen", "Yemeni"], ["sanaani", "Yemeni"],
    ["MSA", "MSA"], ["fusha", "MSA"], ["standard", "MSA"],
  ])("folds %s onto %s", (input, expected) => {
    expect(normalizeDialect(input)).toBe(expected);
  });

  it("tolerates whitespace and case", () => {
    expect(normalizeDialect("  YEMENI  ")).toBe("Yemeni");
  });

  it.each([[null], [undefined], [""], ["Levantine"], ["Maghrebi"], ["Iraqi"]])(
    "falls back to Gulf for %s",
    (input) => {
      // Levantine, Maghrebi and Iraqi are video tags, never learner modules, and
      // have no voice mapping. Gulf is what every call site already did by
      // omission — this makes it deliberate rather than accidental.
      expect(normalizeDialect(input as string | null | undefined)).toBe("Gulf");
    },
  );
});

describe("voice slots", () => {
  it("puts the second host on a different slot from the first", () => {
    expect(pickVoiceSlot("host_a", 0)).toBe(0);
    expect(pickVoiceSlot("host_b", 1)).toBe(1);
  });

  it("narrates in the host's slot", () => {
    // Slot 1 sounded energetic to the point of shouting on long-form reading.
    expect(pickVoiceSlot("narrator", 3)).toBe(0);
    expect(pickVoiceSlot("speaker", 7)).toBe(0);
  });

  it("counts a two-host script as needing two voices and a story as needing one", () => {
    expect(slotsNeeded(["host_a", "host_b", "host_a"])).toBe(2);
    expect(slotsNeeded(["narrator", "narrator", "narrator"])).toBe(1);
    expect(slotsNeeded([])).toBe(1);
  });
});

describe("the tables themselves", () => {
  it("leads Yemeni with its own tags before borrowing Gulf's", () => {
    const [own, borrowed] = MUNSIT_DIALECT_TAGS.Yemeni;
    expect(own).toContain("yemeni");
    expect(borrowed).toContain("khaleeji");
  });

  it("gives every routed dialect an Azure floor", () => {
    for (const dialect of Object.keys(MUNSIT_DIALECT_TAGS)) {
      expect(AZURE_FALLBACK_VOICES[dialect as keyof typeof AZURE_FALLBACK_VOICES].length)
        .toBeGreaterThan(0);
    }
  });

  it("gives the live call the Gulf persona for Yemeni", () => {
    // Not a TTS voice: OpenAI Realtime ships eight fixed personas and the accent
    // comes from the prompt. `ballad` is the one that was preferred over `verse`.
    expect(REALTIME_VOICE_BY_DIALECT.Yemeni).toBe("ballad");
    expect(REALTIME_VOICE_BY_DIALECT.Yemeni).toBe(REALTIME_VOICE_BY_DIALECT.Gulf);
  });
});
