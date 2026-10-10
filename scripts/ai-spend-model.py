#!/usr/bin/env python3
"""Hikaya AI spend model — the arithmetic behind docs/ai-spend-2026-10.md.

Run: python3 scripts/ai-spend-model.py

A price table checked 2026-10-10, a token-count assumption per call, the
Brain strategy multipliers, and three personas. Edit PERSONAS or PRICES and
re-run; it prints the markdown tables the document carries. Replace the
assumptions with measurements from llm_usage_logs (queries in the doc, §7).
"""
from collections import OrderedDict

# ---------------------------------------------------------------- prices
# USD per 1M tokens: (input, output, cache_read)
PRICES = {
    "sonnet5":      (2.00, 10.00, 0.20),    # anthropic/claude-sonnet-5 (Anthropic page + OpenRouter)
    "flash":        (0.75, 3.75, 0.075),    # google/gemini-3.7-flash (OpenRouter; Google lists 3.8 Flash at the same promo price, doubling 2027-01-01)
    "pro":          (2.00, 12.00, 0.20),    # google/gemini-3.1-pro-preview
    "luna":         (0.20, 1.20, 0.02),     # openai/gpt-5.6-luna
    "qwen_max":     (2.00, 6.00, 0.25),     # qwen/qwen3.8-max-0902
    "saba":         (0.20, 0.60, 0.02),     # mistralai/mistral-saba
    "m3":           (0.50, 1.50, 0.50),     # humain/humain-m3 — NOT PUBLISHED, placeholder
    "fanar":        (0.0, 0.0, 0.0),        # QCRI research API, rationed not billed
    "embed":        (0.02, 0.0, 0.0),       # text-embedding-3-small
}
IMAGE_USD = 0.067            # gemini-3.1-flash-image, 1K square (batch tier: 0.034)
LYRIA_USD = 0.04             # lyria-3-clip-preview, one 30 s clip
VEO_LITE_USD_PER_S = 0.05    # Google route; 0.03 on OpenRouter
LIVE_VOICE_USD_PER_MIN = 0.05  # gpt-live-1 voice layer, backend model billed separately
REALTIME_AUDIO_IN, REALTIME_AUDIO_OUT = 32.0, 64.0  # gpt-realtime-2 per 1M audio tokens
GPT4O_TRANSCRIBE_PER_MIN = 0.006
MUNSIT_USD_PER_1K_CREDITS = 0.035   # Build $39/1M=0.039, Starter $100/3M=0.033; Basic would be 0.05, Growth 0.025
MUNSIT_STT_CREDITS_PER_MIN = 1000
MUNSIT_TTS_CREDITS_PER_CHAR = 2      # standard voices (faseeh-mini is 1)
AZURE_TTS_USD_PER_1K_CHARS = 0.015
AZURE_PRON_USD_PER_HOUR = 1.30       # $1/h STT + $0.30/h assessment add-on
ELEVEN_USD_PER_1K_CHARS = 0.08
SONIOX_USD_PER_HOUR = 0.10
DEEPGRAM_USD_PER_MIN = 0.0052        # nova-3 multilingual batch
STRIPE_PCT, STRIPE_FIXED = 0.029, 0.30

STABLE_PREFIX = 1200   # dialect identity + rulebook + demonstrations, tokens (assumption)
PROFILE = 700          # learner profile block when a call carries one


def llm(model, tin, tout, cached=0):
    i, o, c = PRICES[model]
    return ((tin - cached) * i + cached * c + tout * o) / 1e6


def munsit_tts(chars):
    return chars * MUNSIT_TTS_CREDITS_PER_CHAR / 1000 * MUNSIT_USD_PER_1K_CREDITS


def munsit_stt(seconds):
    return seconds / 60 * MUNSIT_STT_CREDITS_PER_MIN / 1000 * MUNSIT_USD_PER_1K_CREDITS


def validator():
    """validateDialectCrossChecked: HUMAIN M3 + Gemini 3.1 Pro in parallel, ~200 out each; tiebreak ~15%."""
    strong = llm("pro", 900, 250)
    arabic = llm("m3", 900, 250)
    tiebreak = 0.15 * llm("fanar", 900, 250)
    return strong + arabic + tiebreak


def native_review():
    """arabicReview after a chat turn: one Arabic-native rung (M3, else Fanar/Saba)."""
    return llm("m3", 1200, 300)


# ------------------------------------------------------- per-action costs
# name -> (cost_usd, free_cap, standard_cap, allin_cap, note)
A = OrderedDict()

# Chat-shaped (streamBrain). Chat context: stable prefix (cached on Claude) + page context + retrieval + memory + history.
chat_in = STABLE_PREFIX + 3500
A["assistant-chat turn"] = (
    llm("sonnet5", chat_in, 600, cached=STABLE_PREFIX)      # the reply
    + llm("embed", 60, 0)                                     # retrieval query embedding
    + llm("flash", 1200, 150)                                 # tool plan (askBrain solo, 300 max)
    + native_review()                                         # Arabic-native read of the reply, when it contains Arabic
    + llm("flash", 2000, 300) / 4,                            # learner-memory rewrite, once every four assistant turns (TURNS_BETWEEN_REWRITES)
    40, None, None, "Sonnet 5 reply + embedding + tool plan + native review + memory rewrite every 4th turn")
A["daily-recap / video-debrief step"] = (
    llm("sonnet5", STABLE_PREFIX + 4500, 600, cached=STABLE_PREFIX) + native_review(),
    0, None, None, "paid-only; 3-4 steps per session")
A["free-chat (conversation simulator) turn"] = (
    llm("pro", STABLE_PREFIX + 2500, 500) + llm("flash", 2000, 400),
    30, None, None, "Gemini 3.1 Pro stream + extract-learner-errors after the turn")
A["ask-translation turn"] = (llm("flash", STABLE_PREFIX + 2000, 400), 40, None, None, "Gemini Flash")
A["culture-guide turn"] = (llm("sonnet5", STABLE_PREFIX + 2500, 800, cached=STABLE_PREFIX), 15, None, None, "Sonnet 5")

# Brain tasks
A["how-do-i-say"] = (
    llm("sonnet5", STABLE_PREFIX + 1200, 1000, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 1200, 1000)
    + llm("sonnet5", STABLE_PREFIX + 3800, 1000, cached=STABLE_PREFIX)
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 3000, 1000, cached=STABLE_PREFIX),
    20, None, None, "council: 2 drafters + Sonnet judge + repair ~30%")
A["word-enrichment (save a word)"] = (
    llm("sonnet5", STABLE_PREFIX + 800, 400, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 800, 400)
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 1500, 400, cached=STABLE_PREFIX),
    60, None, None, "ensemble Sonnet + Flash, repair ~30%")
A["generate-sample-sentences"] = (
    llm("sonnet5", STABLE_PREFIX + 800, 500, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 800, 500)
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 1500, 500, cached=STABLE_PREFIX),
    30, None, None, "ensemble, repair ~30%")
A["translate-phrase"] = (
    llm("sonnet5", 600, 80) + 3 * llm("flash", 600, 70), 30, None, None, "4 parallel direct calls")
A["translate-text"] = (llm("flash", STABLE_PREFIX + 1200, 1000), 30, None, None, "solo Flash, no repair")
A["grammar-drill"] = (
    llm("sonnet5", STABLE_PREFIX + 1500, 1500, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 1500, 1500)
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 3500, 1500, cached=STABLE_PREFIX),
    20, None, None, "ensemble, repair ~30%")
A["listening-quiz"] = (
    llm("sonnet5", STABLE_PREFIX + 1500, 1500, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 1500, 1500)
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 3500, 1500, cached=STABLE_PREFIX) + munsit_tts(400),
    15, None, None, "ensemble + repair ~30% + TTS of the lines")
A["souq-news-quiz"] = (A["grammar-drill"][0], 15, None, None, "ensemble, as grammar-drill")
A["phrase-of-the-day"] = (
    llm("sonnet5", STABLE_PREFIX + 800, 500, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 800, 500),
    20, None, None, "ensemble")
A["mistake-drill"] = (llm("flash", STABLE_PREFIX + 2000, 1500) + 0.3 * llm("sonnet5", 4500, 1500), 30, 100, 300, "solo Flash + repair ~30%")
A["monologue-prompts"] = (llm("flash", STABLE_PREFIX + 1000, 700), 15, 60, 150, "solo Flash")
A["writing-coach turn"] = (llm("flash", STABLE_PREFIX + 1800, 1200) + 0.3 * llm("sonnet5", 4500, 1200), 10, 40, 120, "solo Flash + repair ~30%")
A["daily-challenge"] = (llm("flash", STABLE_PREFIX + 1500, 1500) + 0.3 * llm("sonnet5", 4000, 1500), 20, None, None, "solo Flash + repair ~30%")
A["dialect-compare"] = (llm("flash", STABLE_PREFIX + 1500, 1500), 25, None, None, "solo Flash, no repair")
A["souq-news (retelling)"] = (4 * (llm("flash", STABLE_PREFIX + 2000, 1500) + 0.3 * llm("sonnet5", 4500, 1500)), 10, None, None, "Firecrawl search + up to 4 articles, each solo Flash + repair ~30%")
A["reading-passage"] = (
    llm("flash", STABLE_PREFIX + 1500, 2500) + validator()
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 5000, 2500, cached=STABLE_PREFIX)
    + 0.3 * llm("sonnet5", 5500, 2500),
    15, None, None, "draft_critic + native validator; critic ~30%, repair ~30%")
A["reading-qa"] = (llm("flash", 2500, 800), 30, None, None, "direct Flash")
A["daily story (on demand or pregenerated)"] = (
    llm("flash", STABLE_PREFIX + 2000, 2500) + validator()
    + 0.3 * llm("sonnet5", STABLE_PREFIX + 5500, 2500, cached=STABLE_PREFIX)
    + 0.3 * llm("sonnet5", 6000, 2500),
    5, None, None, "draft_critic + native validator; one per learner per day")
A["generate-story (custom)"] = (
    llm("flash", STABLE_PREFIX + 2000, 5000) + 0.5 * llm("luna", STABLE_PREFIX + 8000, 5000)
    + 0.3 * llm("sonnet5", 9000, 5000),
    10, None, None, "Flash draft, Luna critic ~50%, repair ~30%; cover/video extra")
A["story cover image"] = (IMAGE_USD, None, None, None, "one Gemini image")
A["story video scene"] = (IMAGE_USD + munsit_tts(350) + llm("flash", 2000, 800) / 6, None, None, None, "image + narration TTS per scene")
A["listen script (episode)"] = (llm("flash", STABLE_PREFIX + 1500, 6000) + llm("flash", 6500, 3000) + 0.3 * llm("sonnet5", 9000, 6000),
                               5, None, None, "two solo Flash calls (8k + 4k max) + repair ~30%")
A["listen audio (episode)"] = (munsit_tts(2500), 20, None, None, "TTS of a ~2,500-char script")
A["generate-worksheet"] = (llm("flash", STABLE_PREFIX + 1500, 2500) + 0.3 * llm("sonnet5", 5000, 2500), 3, 10, 30, "solo Flash + repair ~30%")
A["placement-quiz"] = (llm("flash", 2000, 1500), 40, None, None, "direct Flash (also anonymous, per IP)")
A["suggest-flashcards"] = (llm("flash", 2000, 800), 15, None, None, "direct Flash")
A["extract-grammar-points"] = (llm("flash", 2500, 1000), 20, None, None, "direct Flash")
A["generate-mnemonic"] = (llm("flash", 1200, 300), 15, None, None, "direct Flash")
A["request-situation-phrases"] = (llm("flash", 1500, 1500), 20, None, None, "direct Flash")
A["set-phrase-quiz"] = (llm("flash", 1500, 1200), 40, None, None, "direct Flash")
A["convert-to-fusha"] = (llm("sonnet5", 1000, 500), 40, None, None, "direct Sonnet (Flash fallback)")
A["analyze-meme"] = (
    llm("sonnet5", STABLE_PREFIX + 2500, 2000, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 2500, 2000)
    + llm("flash", 2000, 1000) + 0.3 * llm("sonnet5", 6000, 2000),
    15, None, None, "ensemble on the image + audio pass + repair ~30%")
A["screen-shared-content"] = (llm("flash", STABLE_PREFIX + 1500, 1000), 30, None, None, "solo Flash")
A["hf-chat turn"] = (llm("sonnet5", STABLE_PREFIX + 1000, 700, cached=STABLE_PREFIX) + llm("flash", STABLE_PREFIX + 1000, 700), 40, None, None, "ensemble")
A["enrich-word-roots"] = (llm("flash", STABLE_PREFIX + 1200, 600), 3, 10, 30, "solo Flash")

# Pictures, exchanges, clips, music
A["quiz picture (word-asset image)"] = (IMAGE_USD, 20, 60, 200, "one Gemini image; NOT shared until word_assets is applied")
A["flashcard / mnemonic image"] = (IMAGE_USD, 20, 60, 200, "one Gemini image, per learner, never shared")
A["word dialogue (word-asset)"] = (
    llm("flash", STABLE_PREFIX + 800, 400) + validator() + 0.3 * llm("sonnet5", STABLE_PREFIX + 2500, 400, cached=STABLE_PREFIX),
    30, 100, 300, "draft + native validator + critic ~30%; refused (nothing charged) while the table is missing")
# While `word_assets` is missing a dialogue is refused before any model call, so the
# "today" personas pay nothing for one; once the table exists it is a shared asset.
STORE_LIVE_TODAY = False
TODAY_UNIT = {"word dialogue (word-asset)": 0.0 if not STORE_LIVE_TODAY else A["word dialogue (word-asset)"][0]}
A["word / phrase jingle"] = (llm("flash", 1500, 400) + 1.2 * LYRIA_USD, 15, 40, 120, "Flash lyrics + Lyria clip (20% retried)")
A["celebration song"] = (llm("flash", 1500, 400) + 1.2 * LYRIA_USD, 3, 10, 30, "same shape as a jingle")
A["word animation (content team only)"] = (IMAGE_USD + 4 * VEO_LITE_USD_PER_S, 0, 0, 10, "poster + 4 s Veo 3.1 Lite; learners refused")

# Speech
A["TTS, one word (Munsit)"] = (munsit_tts(8), 400, None, None, "tts-speak / persist-word-audio; curriculum words cached on the row")
A["TTS, one line (Munsit)"] = (munsit_tts(60), 400, None, None, "listen-line-audio, listening cards")
A["pronunciation attempt (Azure)"] = (4 / 3600 * AZURE_PRON_USD_PER_HOUR, 60, None, None, "~4 s of audio")
A["set-phrase / shadow / chunk score (Munsit ASR)"] = (munsit_stt(5), 60, None, None, "~5 s of audio; anonymous callers capped per IP")
A["practice coach turn (ASR + Flash)"] = (munsit_stt(6) + llm("flash", STABLE_PREFIX + 1200, 600), 40, None, None, "Munsit ASR + solo Flash")
A["monologue score (60 s)"] = (munsit_stt(60) + llm("flash", STABLE_PREFIX + 1800, 800), 12, None, None, "ASR + Flash feedback")
A["pronunciation-feedback"] = (llm("flash", 1500, 500), 60, None, None, "direct Flash")
A["learner upload transcribe (1 min)"] = (munsit_stt(60), 10, None, None, "munsit-transcribe; deepgram/soniox variants ~$0.005/min")
A["live voice, 1 minute (gpt-live-1)"] = (
    LIVE_VOICE_USD_PER_MIN + 3 * llm("luna", 5000, 150, cached=4000),
    30, 120, 300, "voice layer + ~3 backend Luna turns/min; monthly minute allowance")
A["live voice, 1 minute (gpt-realtime-2, rollback)"] = (
    (300 * REALTIME_AUDIO_IN + 600 * REALTIME_AUDIO_OUT) / 1e6 + 2 * 1500 * 0.40 / 1e6 + GPT4O_TRANSCRIBE_PER_MIN * 0.5,
    30, 120, 300, "30 s in + 30 s out per minute; context re-reads cached")


def fmt(x):
    return f"${x:,.4f}" if x < 0.1 else f"${x:,.3f}"


def cap(v):
    return "—" if v is None else ("∞" if v == float("inf") else str(v))


print("## Per-action cost\n")
print("| Action | Est. cost | Free/day | Standard/day | All-In/day | What it is |")
print("|---|---:|---:|---:|---:|---|")
for k, (c, f, s, a, note) in A.items():
    s_ = "∞" if (s is None and f is not None and f != 0) else cap(s)
    a_ = "∞" if (a is None and f is not None and f != 0) else cap(a)
    print(f"| {k} | {fmt(c)} | {cap(f)} | {s_} | {a_} | {note} |")

# --------------------------------------------------------------- personas
# daily counts on an active day; (active days / month)
PERSONAS = OrderedDict()
PERSONAS["Light (free, 12 active days)"] = (12, {
    "assistant-chat turn": 3, "word-enrichment (save a word)": 3, "quiz picture (word-asset image)": 3,
    "TTS, one word (Munsit)": 20, "pronunciation attempt (Azure)": 5, "daily story (on demand or pregenerated)": 1,
    "translate-phrase": 2, "live voice, 1 minute (gpt-live-1)": 2.5,
})
PERSONAS["Typical (Standard, 20 active days)"] = (20, {
    "assistant-chat turn": 8, "daily-recap / video-debrief step": 3, "daily story (on demand or pregenerated)": 1,
    "word-enrichment (save a word)": 6, "quiz picture (word-asset image)": 6, "word dialogue (word-asset)": 4,
    "TTS, one word (Munsit)": 40, "TTS, one line (Munsit)": 10, "pronunciation attempt (Azure)": 10,
    "set-phrase / shadow / chunk score (Munsit ASR)": 6, "how-do-i-say": 2, "grammar-drill": 1, "listening-quiz": 0.5,
    "translate-phrase": 4, "flashcard / mnemonic image": 1, "word / phrase jingle": 0.3,
    "live voice, 1 minute (gpt-live-1)": 6,   # 120 min/month allowance
    "reading-passage": 0.3, "mistake-drill": 0.5, "placement-quiz": 0.05,
})
PERSONAS["Heavy (All-In, 28 active days)"] = (28, {
    "assistant-chat turn": 30, "daily-recap / video-debrief step": 8, "daily story (on demand or pregenerated)": 1,
    "generate-story (custom)": 1, "story cover image": 1, "word-enrichment (save a word)": 15,
    "quiz picture (word-asset image)": 25, "word dialogue (word-asset)": 20, "flashcard / mnemonic image": 10,
    "TTS, one word (Munsit)": 120, "TTS, one line (Munsit)": 40, "pronunciation attempt (Azure)": 40,
    "set-phrase / shadow / chunk score (Munsit ASR)": 20, "practice coach turn (ASR + Flash)": 10,
    "how-do-i-say": 6, "grammar-drill": 3, "listening-quiz": 2, "mistake-drill": 3, "writing-coach turn": 3,
    "translate-phrase": 10, "translate-text": 3, "word / phrase jingle": 3, "free-chat (conversation simulator) turn": 15,
    "live voice, 1 minute (gpt-live-1)": 10.7,  # 300 min/month allowance
    "reading-passage": 1, "listen script (episode)": 0.3, "listen audio (episode)": 0.3, "monologue score (60 s)": 1,
    "souq-news (retelling)": 1, "souq-news-quiz": 1, "analyze-meme": 1, "culture-guide turn": 2,
})

print("\n## Persona monthly cost\n")
print("| Persona | AI cost / month | Top three lines |")
print("|---|---:|---|")
persona_totals = {}
for name, (days, counts) in PERSONAS.items():
    lines = []
    total = 0.0
    for action, n in counts.items():
        c = TODAY_UNIT.get(action, A[action][0]) * n * days
        total += c
        lines.append((c, action))
    lines.sort(reverse=True)
    persona_totals[name] = total
    top = "; ".join(f"{a} {fmt(c)}" for c, a in lines[:3])
    print(f"| {name} | {fmt(total)} | {top} |")

print("\n## Margin\n")
print("| Plan | Price | Net of Stripe | Persona | AI cost | Margin |")
print("|---|---:|---:|---|---:|---:|")
for plan, price, persona in [("Free", 0, "Light (free, 12 active days)"), ("Standard monthly", 5, "Typical (Standard, 20 active days)"),
                             ("Standard annual (per month)", 50 / 12, "Typical (Standard, 20 active days)"),
                             ("All-In monthly", 15, "Heavy (All-In, 28 active days)"), ("All-In annual (per month)", 150 / 12, "Heavy (All-In, 28 active days)")]:
    net = 0 if price == 0 else price * (1 - STRIPE_PCT) - (STRIPE_FIXED if plan.endswith("monthly") else STRIPE_FIXED / 12)
    cost = persona_totals[persona]
    print(f"| {plan} | ${price:.2f} | ${net:.2f} | {persona.split(' (')[0]} | {fmt(cost)} | ${net - cost:,.2f} |")

print("\n## Worst-case daily exposure per learner (caps × unit cost)\n")
print("| Action | Free max/day | Standard max/day | All-In max/day |")
print("|---|---:|---:|---:|")
rows = []
for k, (c, f, s, a, note) in A.items():
    if f is None:
        continue
    fm = c * f
    sm = c * s if s is not None else None
    am = c * a if a is not None else None
    rows.append((fm, k, fm, sm, am))
rows.sort(reverse=True)
for _, k, fm, sm, am in rows[:22]:
    print(f"| {k} | {fmt(fm)} | {'uncapped' if sm is None else fmt(sm)} | {'uncapped' if am is None else fmt(am)} |")

print("\n## Reference: per-1M-token prices used\n")
print("| Model | In | Out | Cache read |")
print("|---|---:|---:|---:|")
for k, (i, o, c) in PRICES.items():
    print(f"| {k} | ${i} | ${o} | ${c} |")

# ------------------------------------------------- after the fixes scenario
print("\n## Typical persona, full breakdown\n")
days, counts = PERSONAS["Typical (Standard, 20 active days)"]
print("| Action | per day | per month |")
print("|---|---:|---:|")
for action, n in sorted(counts.items(), key=lambda kv: -TODAY_UNIT.get(kv[0], A[kv[0]][0]) * kv[1]):
    print(f"| {action} | {n} | {fmt(TODAY_UNIT.get(action, A[action][0]) * n * days)} |")

# Levers: shared asset store live (pictures amortised across learners: a word is drawn once ever),
# flashcard images routed through the store, chat side-calls trimmed (memory update once per session,
# tool plan and memory on Flash-Lite), voice allowance Standard 60 min / All-In 180 min.
SHARED_PICTURE = IMAGE_USD / 40       # one picture serves ~40 learners over its life (assumption)
chat_trimmed = (llm("sonnet5", chat_in, 600, cached=STABLE_PREFIX) + llm("embed", 60, 0)
                + 0.3 * 0.9 * llm("flash", 1200, 150) + native_review() + (llm("flash", 2000, 300) / 8))
AFTER = {
    "quiz picture (word-asset image)": SHARED_PICTURE,
    "flashcard / mnemonic image": SHARED_PICTURE,
    "assistant-chat turn": chat_trimmed,
    "word dialogue (word-asset)": A["word dialogue (word-asset)"][0] / 40,   # shared once the table exists
}
VOICE_AFTER = {"Light (free, 12 active days)": 2.5, "Typical (Standard, 20 active days)": 3, "Heavy (All-In, 28 active days)": 6.4}
print("\n## Persona monthly cost after the fixes\n")
print("| Persona | Before | After | Net revenue | Margin after |")
print("|---|---:|---:|---:|---:|")
NET = {"Light (free, 12 active days)": 0.0, "Typical (Standard, 20 active days)": 4.55, "Heavy (All-In, 28 active days)": 14.26}
for name, (days, counts) in PERSONAS.items():
    total = 0.0
    for action, n in counts.items():
        unit = AFTER.get(action, A[action][0])
        if action.startswith("live voice"):
            n = VOICE_AFTER[name]
        total += unit * n * days
    print(f"| {name} | {fmt(persona_totals[name])} | {fmt(total)} | ${NET[name]:.2f} | ${NET[name] - total:,.2f} |")

# ------------------------------------------------- the lean configuration (§8)
# Unit costs after the strategy changes the launch gate proposes, the cap
# table, and what they produce. Edit LEAN or CAPS and re-run.
PRICES["lite"] = (0.25, 1.50, 0.025)   # Gemini Flash-Lite, for calls whose output is English or a label
SHARE = 40                              # learners one shared asset serves over its life (assumption)

LEAN = OrderedDict()
LEAN["chat Sonnet"] = llm("sonnet5", chat_in, 600, cached=STABLE_PREFIX) + llm("lite", 600, 150) + llm("lite", 2000, 300) / 8
LEAN["chat Flash"] = llm("flash", chat_in, 600) + llm("lite", 600, 150) + llm("lite", 2000, 300) / 8
LEAN["recap step"] = llm("flash", STABLE_PREFIX + 4500, 600)
LEAN["simulator"] = llm("flash", STABLE_PREFIX + 2500, 500) + llm("lite", 2000, 400) / 5
LEAN["how-do-i-say"] = llm("flash", STABLE_PREFIX + 1200, 1000) + 0.3 * llm("sonnet5", STABLE_PREFIX + 2800, 1000, cached=STABLE_PREFIX) + 0.3 * llm("flash", 4000, 1000)
LEAN["save word"] = llm("flash", STABLE_PREFIX + 800, 400) + 0.3 * llm("flash", 2700, 400)
LEAN["practice generator"] = llm("flash", STABLE_PREFIX + 1500, 2000) + 0.5 * llm("pro", 900, 250) + 0.3 * llm("flash", 4500, 2000)
LEAN["daily story"] = llm("flash", STABLE_PREFIX + 2000, 2500) + llm("pro", 900, 250) + 0.3 * llm("flash", 6000, 2500)
LEAN["quiz picture"] = IMAGE_USD / SHARE
LEAN["flashcard image"] = IMAGE_USD / SHARE
LEAN["dialogue"] = A["word dialogue (word-asset)"][0] / SHARE
LEAN["word jingle"] = (llm("flash", 1500, 400) + 1.2 * LYRIA_USD) / SHARE
LEAN["TTS word"] = A["TTS, one word (Munsit)"][0]
LEAN["TTS line"] = A["TTS, one line (Munsit)"][0]
LEAN["pronunciation"] = A["pronunciation attempt (Azure)"][0]
LEAN["shadow"] = A["set-phrase / shadow / chunk score (Munsit ASR)"][0]
LEAN["translate"] = A["translate-phrase"][0]
LEAN["meme"] = A["analyze-meme"][0]
LEAN["custom story"] = A["generate-story (custom)"][0]
LEAN["monologue"] = A["monologue score (60 s)"][0]
LEAN["writing"] = A["writing-coach turn"][0]
LEAN["worksheet"] = A["generate-worksheet"][0]
LEAN["transcribe video"] = 0.01 + 0.16          # Soniox ASR + the analysis block, per 3-minute video
LEAN["listen episode"] = A["listen script (episode)"][0] + A["listen audio (episode)"][0]
LEAN["story video scene"] = A["story video scene"][0]
LEAN["voice minute"] = A["live voice, 1 minute (gpt-live-1)"][0]

# per day (free, standard, allin); voice per month
CAPS = {
    "chat Flash": (5, 20, 0), "chat Sonnet": (0, 0, 40), "recap step": (0, 4, 12), "daily story": (1, 1, 1),
    "how-do-i-say": (3, 10, 30), "save word": (10, 25, 60), "quiz picture": (20, 60, 200), "dialogue": (30, 100, 300),
    "TTS word": (100, 250, 600), "TTS line": (10, 30, 100), "pronunciation": (30, 60, 200), "shadow": (20, 40, 120),
    "practice generator": (1, 3, 8), "translate": (10, 25, 60), "flashcard image": (0, 10, 30), "word jingle": (0, 3, 10),
    "simulator": (0, 15, 40), "meme": (0, 0, 5), "custom story": (0, 0, 3), "monologue": (1, 3, 8), "writing": (2, 6, 20),
    "worksheet": (0, 2, 5), "transcribe video": (0, 0, 3), "listen episode": (0, 0, 1), "story video scene": (0, 0, 6),
}
VOICE_CAP_MIN = (10, 30, 120)
NET_REVENUE = (0.0, 4.55, 14.26)

print("\n## Lean unit costs\n")
print("| Action | Lean cost |")
print("|---|---:|")
for k, v in LEAN.items():
    print(f"| {k} | {fmt(v)} |")

print("\n## Monthly ceiling per tier if every cap is hit every day\n")
print("| Tier | Per day | Per month incl. voice | Net revenue |")
print("|---|---:|---:|---:|")
for i, tier in enumerate(["Free", "Standard", "All-In"]):
    day = sum(LEAN[k] * CAPS[k][i] for k in CAPS)
    month = day * 30 + VOICE_CAP_MIN[i] * LEAN["voice minute"]
    print(f"| {tier} | {fmt(day)} | {fmt(month)} | ${NET_REVENUE[i]:.2f} |")

LEAN_TYPICAL = {"chat Flash": 8, "recap step": 3, "daily story": 1, "save word": 6, "quiz picture": 6, "dialogue": 4, "TTS word": 40,
                "TTS line": 10, "pronunciation": 10, "shadow": 6, "how-do-i-say": 2, "practice generator": 1.5, "translate": 4,
                "flashcard image": 1, "word jingle": 0.3}
LEAN_HEAVY_DAY = {**LEAN_TYPICAL, "chat Flash": 0, "chat Sonnet": 30, "TTS line": 40, "recap step": 8, "save word": 15, "how-do-i-say": 6, "practice generator": 5}
print("\n## Break-even active days under the lean configuration\n")
print("| Plan | Typical active day | Voice per month | Break-even active days |")
print("|---|---:|---:|---:|")
for plan, net, counts, vmin in [("Standard, Flash tutor", 4.55, LEAN_TYPICAL, 30),
                                 ("All-In, Sonnet tutor", 14.26, {**LEAN_TYPICAL, "chat Flash": 0, "chat Sonnet": 8}, 120),
                                 ("All-In, heavy day", 14.26, LEAN_HEAVY_DAY, 120)]:
    day = sum(LEAN[k] * n for k, n in counts.items())
    voice = vmin * LEAN["voice minute"]
    print(f"| {plan} | {fmt(day)} | {fmt(voice)} | {max(0.0, (net - voice) / day):.1f} |")
