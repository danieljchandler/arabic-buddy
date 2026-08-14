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

`realtime-session-token` is OpenAI Realtime over WebRTC. It accepts only its
eight built-in personas and the dialect comes from the system prompt, not the
voice, so **Munsit cannot serve it and a cloned voice can never be used there**.
Yemeni shares Gulf's `ballad`; `REALTIME_VOICE_YEMENI` overrides it.
