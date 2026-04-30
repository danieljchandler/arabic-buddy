
# Transcription & Translation Pipeline — Improvement Plan (approved, no self-hosting)

## What I'll do

Drop everything that requires self-hosting (Audar-ASR on RunPod). Keep all hosted-API improvements. I'll roll out in the order below — you can stop me after any tier.

### Tier 1 — quick wins (one PR)
1. **Re-prioritize Soniox in the merge prompt.** Tell the LLM Soniox has the lowest WER on Arabic in 2026 production benchmarks; prefer Soniox wording when ASRs disagree, use Deepgram only for word boundaries / timestamps.
2. **Upgrade dedicated translation: Gemini 2.5 Flash → Gemini 2.5 Pro** (existing Qwen + Cerebras llama-3.3-70b stay as fallbacks).
3. **Per-line ASR provenance + agreement score.** Persist `asrProvenance: string[]` and `engineAgreement: number (0–1)` on each line; surface in admin transcript editor as a colored band so QA focuses on disagreement lines.
4. **Dialect-aware Deepgram keyterms + ElevenLabs keyterms.** Pull from `_shared/dialectHelpers.ts` based on `dialectModule` instead of the hard-coded Gulf list.
5. **Dialect-aware cache key.** Add `dialect_module` to `processed_videos.content_hash` so cross-dialect cache collisions stop.

### Tier 2 — dialect-specific accuracy
6. **Add Azure Speech STT as a 4th ASR engine, dialect-routed** (uses existing `AZURE_SPEECH_KEY/REGION/ENDPOINT`):
   - Egyptian → `ar-EG`
   - Yemeni → `ar-YE`
   - Gulf → `ar-SA` as alternate (Deepgram stays primary)
7. **Extend CAMeL city map** to include CAI/ALX (Egyptian) and SAN (Yemeni) so dialect validation works for all three modules.
8. **Branch Claude vocab enrichment + Fanar validation prompts on `DIALECT_MODULE`** (currently Gulf-only text is sent for Egyptian/Yemeni runs).
9. **Munsit health-check cron** in `discover-trending-videos` so it auto-re-enables when the DNS comes back.

### Tier 3 — structural
10. **Weighted round-robin Fanar usage** instead of hard 18/day cutoff (rotate which engines run per video so we never lose Fanar entirely on busy days).
11. **Low-confidence re-ask loop**: if engine agreement < 0.6 on > 20% of lines, re-run only those lines through Soniox + Gemini 2.5 Pro translation.
12. **Replace QCRI Farasa with CAMeL-Tools `disambig` (hosted via HF Inference)** for dialect-aware tashkeel; keep Farasa as fallback.
13. **Switch user-upload `elevenlabs-transcribe` to the same Deepgram + Soniox + Fanar ensemble** (no RunPod needed for non-YouTube uploads). User uploads then get the same quality bar as Discover videos.

## Explicitly dropped
- Self-hosting Audar-ASR-V1 on RunPod — out per your call.

## Decisions still needed
I'll ask these as a single multi-question prompt right after you approve:
- OK to add **Azure Speech STT** as ASR engine #4? (Same Azure key you already pay for — no new secret.)
- OK to **drop ElevenLabs from user uploads** entirely, or keep it as an opt-in fallback?
- Translation upgrade target — **Gemini 2.5 Pro** (cheaper, same family as current) or **GPT-5** (best quality, ~3× cost)?
- Implement all three tiers, or stop after Tier 1 / Tier 2?
