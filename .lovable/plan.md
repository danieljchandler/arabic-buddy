## Add Sentence Audio to Flashcards from Transcriptions

When a user saves a word from a transcript line, the sentence audio context (the audio clip of the line the word appeared in) should be saved alongside it so they can hear the word used in context during flashcard review.

### How It Works Today

1. User transcribes audio/video on `transcribe tutor meme` 
2. Each transcript line has `startMs`/`endMs` timestamps mapped from ElevenLabs word data
3. User clicks a word token, then "Save to My Words"
4. The `handleSaveToMyWords` callback receives a `VocabItem` with only `arabic`, `english`, and `root`
5. No sentence text, sentence translation, or audio timing info is passed along
6. The `user_vocabulary` table already has `sentence_text`, `sentence_english`, `sentence_audio_url` columns -- but they stay empty for transcription-sourced words

### What Needs to Change

**1. Expand the data passed when saving a word**

- Update the `VocabItem` type (or create an extended version) to include sentence context: `sentence_text`, `sentence_english`, `startMs`, `endMs`
- In `LineByLineTranscript`, the `InlineToken` component knows which `TranscriptLine` it belongs to. Pass the parent line's `arabic`, `translation`, `startMs`, and `endMs` into the `onSaveToMyWords` callback

**2. Clip and store sentence audio**

- When saving a word from a transcript, use the line's `startMs`/`endMs` to clip the relevant audio segment from the full audio file
- Use the existing `tutor-audio-clips` storage bucket (or `flashcard-audio`) to upload the clipped audio
- Store the resulting public URL in `sentence_audio_url` on the `user_vocabulary` record

**3. Update the save mutation**

- Extend `useAddUserVocabulary` to accept optional `sentence_text`, `sentence_english`, and `sentence_audio_url` fields
- Pass these through to the database insert

**4. No review UI changes needed**

- The `MyWordsReview` page already queries `sentence_audio_url` and renders a "Sentence" audio button when available -- this will just start working automatically

### Technical Details

**Files to modify:**


| File                                                 | Change                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/transcript.ts`                            | Add `sentenceText`, `sentenceEnglish`, `startMs`, `endMs` to `VocabItem`                                                                            |
| `src/components/transcript/LineByLineTranscript.tsx` | Pass parent line context into `onSaveToMyWords` callback from `InlineToken`                                                                         |
| `src/pages/Transcribe.tsx`                           | Update `handleSaveToMyWords` to clip audio using the existing `audioClipper` utility and upload to storage, then pass sentence data to the mutation |
| `src/hooks/useUserVocabulary.ts`                     | Extend `useAddUserVocabulary` mutation to accept and insert `sentence_text`, `sentence_english`, `sentence_audio_url`                               |
| `src/lib/audioClipper.ts`                            | Verify/use existing audio clipping utility for extracting the sentence segment                                                                      |


**Audio clipping approach:**

- The project already has `src/lib/audioClipper.ts` -- this will be used to extract the sentence audio segment client-side
- The clipped audio blob will be uploaded to the `flashcard-audio` storage bucket
- The public URL is then saved to `sentence_audio_url`

**Data flow:**

```text
Token click -> "Save to My Words"
  -> VocabItem now includes sentence context (text, translation, startMs, endMs)
  -> Client clips audio segment from full file using audioClipper
  -> Uploads clip to flashcard-audio bucket
  -> Inserts into user_vocabulary with sentence_text, sentence_english, sentence_audio_url
  -> MyWordsReview already shows "Sentence" button when sentence_audio_url exists
```