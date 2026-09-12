# TTS voice routing

Every spoken voice in the app comes from **Munsit's Faseeh model**. Azure Neural
TTS is the emergency floor and nothing else; ElevenLabs survives only as an
Egyptian-specific rung. This document exists mostly to record *why* Yemeni
sounds the way it does, because the obvious-looking fix is the wrong one and has
already been made once.

## Where the decision lives

| File | Role |
| --- | --- |
| `supabase/functions/_shared/ttsVoiceRoutingCore.ts` | The whole dialect→voice table, pure. Vitest drives it against fixtures. |
| `supabase/functions/_shared/ttsVoiceRouting.ts` | Secrets, Munsit catalogue discovery, the three provider calls. |
| `supabase/functions/tts-speak/index.ts` | The endpoint every client calls. Takes a dialect, never a voice. |
| `supabase/functions/_shared/listenTts.ts` | Long-form only: voice slots, prosody, clip assembly. |

Before this, the mapping was hardcoded in six places that disagreed with each
other. Yemeni was `ar-YE-MaryamNeural` from a flashcard, `ar-YE-SalehNeural` in
the conversation simulator, and Munsit's Gulf voice from the video-clip fallback
— three answers to one question, differing even on the speaker's gender.

**Clients name a dialect and nothing else.** Voice IDs come only from server
config, which is what lets a cloned voice be switched on with a secret rather
than a frontend deploy, and why `tts-speak` needs no voice allow-list: there is
no caller-supplied ID to allow or deny.

## The chain

For each dialect, in order:

1. **Pinned IDs** — `MUNSIT_<DIALECT>_VOICE_IDS`. For Yemeni this is the clone.
2. **Munsit native** — first `dialect` tag group with enough voices.
3. **Munsit Gulf** — Yemeni only, when its own tags matched nothing.
4. **ElevenLabs** — Egyptian only, when Munsit has no Egyptian voice.
5. **Azure** — the floor.

Two properties worth knowing:

- **Distinctness never costs a provider tier.** If no Munsit rung can supply the
  requested number of distinct voices, the chain retries asking for one before
  it drops to Azure. A two-host episode read by one natural Munsit voice beats
  the same episode in two Azure voices. Within a tier the preference still
  holds: a single cloned voice gives way to two distinct Gulf ones.
- **An explicit pin survives a discovery outage.** A `/voices` failure must not
  silently disable a voice someone configured by hand.

## Yemeni is deliberately not in a Yemeni accent

Munsit has no Yemeni voice, so Yemeni is read by a **Gulf** voice — rotated one
position off the Gulf list so the two dialects never lead with the same speaker.

This looks like a bug. It is a decision, and it reverses an earlier one.

Commit `bd4e189` moved Yemeni onto Azure's `ar-YE-MaryamNeural` /
`ar-YE-SalehNeural` on the reasoning that a real Yemeni locale beats a Gulf
voice. In listening, the opposite is true: the Azure `ar-YE-*` neurals sound
poor, and Munsit's Gulf voice — wrong accent family and all — is both closer and
far more natural. Quality beat accent accuracy, on the product owner's own
judgement after hearing both.

**So do not "fix" Yemeni back to `ar-YE-*`.** If you want to improve it, the two
real routes are:

1. Set `MUNSIT_YEMENI_VOICE_IDS` to a cloned Yemeni speaker (see below).
2. Wait for Munsit to ship a Yemeni voice. `MUNSIT_DIALECT_TAGS.Yemeni` already
   checks `yemeni`/`sanaani`/`taizzi`/`adeni` before falling through to Gulf, so
   that upgrade needs no code change at all.

The same reasoning does **not** extend to Egyptian: Munsit's Egyptian voices are
used when the account has them, and ElevenLabs' three native `ar-EG` voices are
kept as the rung below. Downgrading Egyptian to a Gulf voice to satisfy "all
Munsit" would be worse than doing nothing.

## Cloning a Yemeni voice

```
curl -X POST https://api.munsit.com/api/v1/voices/clone \
  -H "x-api-key: $MUNSIT_API_KEY" \
  -F "file=@friend.mp3" -F "name=Yemeni — <name>"
# → {"voice_id":"cl-...","status":"ready"}

supabase secrets set MUNSIT_YEMENI_VOICE_IDS=cl-...
```

Source audio: 1–3 minutes, one speaker, no music or room echo, consistent mic,
conversational register rather than read-aloud — that is what the app plays. Get
the speaker's explicit consent on record.

Nothing else changes; each function picks the secret up on its next cold start.
Verify with `x-tts-source: munsit-pinned` (see below). Roll back by unsetting the
secret or with `TTS_PROVIDER_YEMENI=azure`.

**A pin is the only way to reach a cloned voice.** Munsit returns `null` for
`gender`, `dialect` and `type` on clones, so the tag matching in step 2 can never
find one no matter what the catalogue contains.

With exactly one cloned voice, single-speaker surfaces (vocabulary, chat, story
narration, listening quiz, letter audio) get it immediately; two-host Listen
episodes stay on the Gulf voices rather than voicing both hosts identically. Set
`TTS_ALLOW_SINGLE_VOICE_EPISODES=true` to change that, or clone a second speaker.

## Checking what is actually happening

`tts-speak` reports its decision in response headers:

```
x-tts-provider: munsit
x-tts-source:   munsit-native | munsit-pinned | munsit-gulf-fallback
                | elevenlabs-egyptian | azure-emergency
```

**`x-tts-source: azure-emergency` in normal operation is the alarm.** It means
Munsit discovery or credentials are failing and the app has quietly reverted to
the voices this whole arrangement exists to replace — while still playing audio,
which is exactly how that would otherwise go unnoticed. It is also logged at
`warn`.

To see what the account actually offers:

```
curl -s -H "x-api-key: $MUNSIT_API_KEY" https://api.munsit.com/api/v1/voices \
  | jq -r '.[] | [.voice_id, .name, (.gender//"-"), ((.dialect//[])|join("/")), .sample_url] | @tsv'
```

Note that voice IDs have **no format convention** — Munsit's docs say so
explicitly. Most look like `PCtWbxjoNTpVQ6gIPaVZ2Hqm`, some like
`ar-najdi-male-2`, clones like `cl-layla-8f21`. Never pattern-match one; the
`dialect` array is the only safe selector.

## Cached audio

Synthesised audio is persisted, so changing a voice does not change what already
exists. After a routing change, clear:

- `vocabulary_words.audio_url` (re-synthesised on demand via `persist-word-audio`)
- `user_vocabulary.word_audio_url` / `phrase_audio_url`
- `listen_line_audio` rows, and `listen-audio/episodes/<id>/*`
- story audio under `authentic-stories/`

Storage objects are overwritten on regeneration (`upsert: true`), so only the DB
rows need clearing.

## The live voice call is separate

`realtime-session-token` is OpenAI over WebRTC. It accepts only OpenAI's own
built-in personas and the dialect comes from the system prompt, not the voice,
so **Munsit cannot serve it and a cloned voice can never be used there**.
Yemeni shares Gulf's `ballad`; `REALTIME_VOICE_YEMENI` overrides it.

That holds for **both** engines, and it is the first thing anyone asks when
GPT-Live comes up. These are speech-to-speech models: the audio the learner
hears is generated by the model itself, and `audio.output.voice` takes a
built-in name or the id of a custom voice OpenAI has approved. There is no seam
to route TTS into, so Munsit's Faseeh voices — including the cloned Yemeni
speaker — cannot reach a live call on either engine. The custom-voice route does
not open one either: for `gpt-live-1` it is documented as English accents only,
and Arabic is not among the languages its consent flow accepts. If the live
call is ever to use a Munsit voice, it stops being a speech-to-speech call —
ASR, then the Brain, then Munsit TTS — and gives up the sub-second turn-taking
that is the reason it exists.

## Which live engine serves a call

One secret, `VOICE_ENGINE`, picks between two engines behind the same function:

| `VOICE_ENGINE` | Engine | Model | Endpoint |
| --- | --- | --- | --- |
| unset / anything else | GPT-Live | `gpt-live-1` | `POST /v1/live/sessions`, exchanged server-side |
| `realtime` | OpenAI Realtime | `gpt-realtime-2` | `POST /v1/realtime/client_secrets`, then the browser exchanges SDP |

GPT-Live is the default, and an unrecognised value falls back to it rather than
failing — `resolveVoiceEngine` in `_shared/liveVoiceCore.ts`. **To roll back**,
set `VOICE_ENGINE` to exactly `realtime`; that is the only value that does it,
and it is what to reach for if dialect recognition regresses, since GPT-Live is
the engine without the Arabic-tuned ASR and `semantic_vad` described above. The
flag reads as an opt-out rather than an opt-in so which engine serves a call
does not depend on a secret being set correctly on every environment. The
response names the engine it served, so the browser is never configured
separately from the function that built the session; a request without
`client_api: 2` is served Realtime whatever the secret says, because a cached
bundle from before GPT-Live understands only the Realtime event names.

Per-dialect voices are unchanged across the two. GPT-Live added twelve
locale-specific voices (English, Brazilian Portuguese, Filipino English — none
Arabic) but kept the older language-agnostic personas, so `ballad` and
`shimmer` are still what the dialects route to.

**What GPT-Live gives up.** Its session has no `audio.input` block at all, so
two things the Realtime path configures are gone: input transcription
(`gpt-4o-transcribe` with `language: "ar"` and a prompt asking it to preserve
dialect wording) and turn detection (`semantic_vad`). Both are engine behaviour
now, and the ASR that produces the learner's transcript can no longer be told
it is listening to Arabic. That is the main thing to measure before switching
the flag on for anyone: the transcript feeds the mistake drill, and the app's
own notes put dialect word error rates above 60% even when the recogniser is
told the language.
