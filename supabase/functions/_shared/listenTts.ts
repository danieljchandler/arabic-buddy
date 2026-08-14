// Episode and story audio: voice slots, synthesis per line, and clip assembly.
//
// Which provider and which voices serve a dialect is no longer decided here —
// `ttsVoiceRouting.ts` owns that for the whole app, so Listen, the vocabulary
// cards and the conversation simulator can't drift apart again the way they had.
// Every dialect resolves to Munsit's Faseeh voices, with Azure as the floor if
// Munsit is unreachable.
//
// What stays here is what only long-form audio cares about: assigning speakers
// to voice slots, conditioning prosody on neighbouring lines, and concatenating
// the clips.

import {
  planForDialect,
  pickVoiceSlot,
  synthesizeWithPlan,
  type VoicePlan,
} from "./ttsVoiceRouting.ts";

export type Provider = "munsit" | "azure" | "elevenlabs";

/**
 * The shape the six episode/story functions read.
 *
 * They only ever touch `provider`, `ext` and `contentType`; the voice list is
 * read by `synthesizeLine` alone, which is why collapsing the old
 * per-provider arrays into one `voices` field was a local change.
 */
export type ProviderPlan = VoicePlan;

/**
 * Resolves the provider and voices for a dialect.
 *
 * @param opts.minVoices distinct voices the caller needs. Two-host episodes must
 *   pass 2 or a single-voice rung could be chosen and both hosts would share a
 *   voice. Derive it from the whole script with `slotsNeeded`, never from one
 *   line — planning line 0 and line 1 separately can land them on different
 *   providers, and a WAV clip cannot be concatenated with an MP3 one.
 */
export async function planProvider(
  dialect: string,
  opts: { minVoices?: number } = {},
): Promise<ProviderPlan> {
  const plan = await planForDialect(dialect, { minVoices: opts.minVoices ?? 2 });
  return {
    provider: plan.provider,
    ext: plan.ext,
    contentType: plan.contentType,
    voices: plan.voices,
    modelId: plan.modelId,
    source: plan.source,
  };
}

export async function synthesizeLine(
  text: string,
  role: string,
  index: number,
  plan: ProviderPlan,
  // Optional prosody conditioning (ElevenLabs only): surrounding lines of the
  // same narration so intonation carries across line boundaries.
  neighbors: { previousText?: string; nextText?: string } = {},
): Promise<Uint8Array> {
  const slot = pickVoiceSlot(role, index);
  // Narration → higher stability so it doesn't sound like shouting. Munsit only:
  // ElevenLabs reads `stability` on a different scale, where 0.8 flattens the
  // expressive delivery its Egyptian voices were chosen for.
  const stability = plan.provider === "munsit" && (role || "").toLowerCase() === "narrator"
    ? 0.8
    : undefined;
  return synthesizeWithPlan(text, plan, slot, { ...neighbors, stability });
}

// Re-exported so callers and tests have one import for line-level audio.
export { pickVoiceSlot, slotsNeeded } from "./ttsVoiceRouting.ts";
export {
  elevenLabsModel,
  synthesizeAzure,
  synthesizeElevenLabs,
  synthesizeMunsit,
} from "./ttsVoiceRouting.ts";

// ---- WAV concatenation (strip RIFF headers from clips 2..N, rewrite sizes) ----
// Assumes all clips share the same PCM format (true for one Munsit model run).
export function concatWav(clips: Uint8Array[]): Uint8Array {
  if (clips.length === 0) return new Uint8Array();
  if (clips.length === 1) return clips[0];

  // Parse the first clip to find 'data' chunk offset and format chunk.
  const first = clips[0];
  const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
  // RIFF header: "RIFF" <size:4> "WAVE"
  if (
    String.fromCharCode(first[0], first[1], first[2], first[3]) !== "RIFF" ||
    String.fromCharCode(first[8], first[9], first[10], first[11]) !== "WAVE"
  ) {
    // Not a parseable WAV — fall back to naive byte concat.
    return concatBytes(clips);
  }

  // Walk chunks to locate 'data'.
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= first.length) {
    const id = String.fromCharCode(first[offset], first[offset+1], first[offset+2], first[offset+3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) return concatBytes(clips);

  const header = first.slice(0, dataOffset); // RIFF + fmt + ... + "data"<size>
  const firstData = first.slice(dataOffset, dataOffset + dataSize);

  // Extract data payloads from subsequent clips.
  const tails: Uint8Array[] = [firstData];
  let totalData = firstData.length;
  for (let c = 1; c < clips.length; c++) {
    const clip = clips[c];
    if (clip.length < 12) continue;
    if (String.fromCharCode(clip[0], clip[1], clip[2], clip[3]) !== "RIFF") {
      tails.push(clip);
      totalData += clip.length;
      continue;
    }
    const cv = new DataView(clip.buffer, clip.byteOffset, clip.byteLength);
    let off = 12;
    while (off + 8 <= clip.length) {
      const id = String.fromCharCode(clip[off], clip[off+1], clip[off+2], clip[off+3]);
      const sz = cv.getUint32(off + 4, true);
      if (id === "data") {
        const payload = clip.slice(off + 8, off + 8 + sz);
        tails.push(payload);
        totalData += payload.length;
        break;
      }
      off += 8 + sz + (sz % 2);
    }
  }

  // Build output: header (rewritten sizes) + concatenated data
  const out = new Uint8Array(header.length + totalData);
  out.set(header, 0);
  // Update RIFF size = file_size - 8
  const outView = new DataView(out.buffer);
  outView.setUint32(4, out.length - 8, true);
  // Update data chunk size (last 4 bytes of header are the data size)
  outView.setUint32(header.length - 4, totalData, true);
  let p = header.length;
  for (const t of tails) {
    out.set(t, p);
    p += t.length;
  }
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function concatForPlan(parts: Uint8Array[], plan: ProviderPlan): Uint8Array {
  return plan.ext === "wav" ? concatWav(parts) : concatBytes(parts);
}

// Rough duration estimates per provider.
export function estimateSeconds(bytes: number, plan: ProviderPlan): number {
  if (plan.provider === "munsit") {
    // Munsit typically returns 22.05 kHz mono 16-bit PCM ≈ 44100 B/s.
    return Math.max(0, Math.round((bytes - 44) / 44100));
  }
  if (plan.provider === "elevenlabs") {
    // ElevenLabs MP3 at 128 kbps CBR.
    return Math.round((bytes * 8) / 128000);
  }
  // Azure 48 kbps CBR MP3
  return Math.round((bytes * 8) / 48000);
}
