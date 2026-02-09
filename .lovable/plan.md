

# Tutor Upload: Audio-to-Flashcard Pipeline

A new feature where users upload tutor audio or video, the system extracts vocabulary candidates with timestamps, and users review/approve them before creating flashcards with clipped audio and optional AI-generated images.

---

## What You'll Get

1. A new **Tutor Upload** page accessible from the Home screen
2. Upload audio/video of a tutor speaking Gulf Arabic
3. The system transcribes, then uses AI to classify segments as vocabulary words vs. example sentences
4. A **Review Screen** where you can play audio clips, edit words, approve or reject candidates
5. Optional AI-generated images (auto-suggested only for concrete/action words)
6. Approved items become flashcards in your **My Words** list with word + sentence audio clips

---

## User Flow

```text
Home Screen
    |
    v
[Tutor Upload] page
    |
    v
Upload audio/video --> Transcribe (dual-engine)
    |
    v
AI classifies segments: VOCAB_WORD / EXAMPLE_SENTENCE / OTHER
    |
    v
Group into candidate pairs (word + sentence)
    |
    v
Review Screen:
  - Play word clip / sentence clip
  - Edit spelling, edit/remove sentence
  - Toggle image generation per item
  - Approve / Reject each candidate
    |
    v
Create flashcards from approved items --> My Words (user_vocabulary)
```

---

## Technical Plan

### Phase 1: Database & Storage Setup

**New table: `tutor_upload_candidates`**
Stores extracted vocabulary candidates linked to the original audio file.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| user_id | uuid | Owner |
| upload_id | uuid | Groups candidates from same upload |
| word_text | text | Spoken word/phrase |
| word_standard | text | Optional standard spelling |
| word_english | text | AI-suggested English meaning |
| sentence_text | text | Associated example sentence |
| sentence_english | text | Sentence translation |
| word_start_ms | int | Word audio start timestamp |
| word_end_ms | int | Word audio end timestamp |
| sentence_start_ms | int | Sentence start timestamp |
| sentence_end_ms | int | Sentence end timestamp |
| confidence | float | AI confidence score |
| classification | text | CONCRETE / ACTION / ABSTRACT |
| status | text | pending / approved / rejected |
| word_audio_url | text | Clipped word audio URL |
| sentence_audio_url | text | Clipped sentence audio URL |
| image_url | text | Optional generated image URL |
| source_audio_url | text | Original uploaded file URL |
| created_at | timestamptz | |

RLS: Users can only access their own rows.

**New storage bucket: `tutor-audio-clips`** (public) for clipped word/sentence audio and source uploads.

**Extend `user_vocabulary` table**: Add columns for `sentence_audio_url`, `word_audio_url`, and `source_upload_id` to link flashcards back to the original upload.

### Phase 2: Edge Function -- `classify-tutor-segments`

A new backend function that takes the timestamped transcript and uses AI (Gemini 2.5 Flash) to:

1. Classify each segment as `VOCAB_WORD`, `EXAMPLE_SENTENCE`, or `OTHER`
2. Pair vocabulary words with their nearest example sentence
3. Provide English translations and confidence scores
4. Classify word type as `CONCRETE`, `ACTION`, or `ABSTRACT` (for image suggestions)

Uses structured output via tool calling to ensure reliable JSON responses.

### Phase 3: Edge Function -- `clip-audio`

A new backend function that:

1. Receives the source audio file URL and timestamp ranges
2. Uses FFmpeg (via Deno) or Web Audio API to extract clips
3. Adds 200-300ms padding before and after each clip
4. Uploads clips to the `tutor-audio-clips` storage bucket
5. Returns the public URLs

**Note**: Since edge functions have limited binary processing, the primary approach will be client-side audio clipping using the Web Audio API (AudioContext + OfflineAudioContext), with the clipped blobs uploaded to storage.

### Phase 4: Edge Function -- `generate-flashcard-image`

A new backend function using `google/gemini-2.5-flash-image` via Lovable AI:

1. Accepts word text and English meaning
2. Generates a realistic photo-style image (4:3, warm neutral background, no text)
3. Returns base64 image data
4. Client uploads to `flashcard-images` bucket (already exists)

Only triggered when user explicitly enables the image toggle.

### Phase 5: New Page -- `/tutor-upload`

**File: `src/pages/TutorUpload.tsx`**

Multi-step page with states:

1. **Upload Step**: Reuses existing file upload/URL import UI patterns from Transcribe page
2. **Processing Step**: Shows progress through transcription + classification pipeline
3. **Review Step**: Candidate list with approve/reject controls

**Review step UI per candidate:**
- Word text (Arabic, editable) + English meaning
- Sentence text (Arabic, editable/removable) + English translation
- Play button for word audio preview (clipped from source using timestamps)
- Play button for sentence audio preview
- Confidence badge with warning for low-confidence items
- Image toggle (OFF by default; auto-suggested ON only for CONCRETE/ACTION words)
- Approve / Reject buttons

4. **Confirm Step**: Summary of approved items, "Create Flashcards" button

### Phase 6: Client-Side Audio Clipping

**File: `src/lib/audioClipper.ts`**

Uses Web Audio API to:
1. Decode the source audio file into an AudioBuffer
2. For each approved candidate, extract word and sentence clips with padding
3. Encode clips as WAV blobs
4. Upload to `tutor-audio-clips` storage bucket

### Phase 7: Flashcard Creation

When user confirms:
1. Clip audio for all approved candidates (client-side)
2. Generate images for items with image toggle ON (via edge function)
3. Insert into `user_vocabulary` with:
   - `word_arabic`, `word_english` from the candidate
   - `word_audio_url`, `sentence_audio_url` from clipped audio
   - `source` = "tutor-upload"
   - Image URL if generated
4. Navigate to My Words page with success toast

### Phase 8: Home Screen Integration

Add a "Tutor Upload" navigation button on the home screen (between Transcribe and My Words), with appropriate icon and description.

---

## Files to Create / Modify

| Action | File |
|--------|------|
| Create | `src/pages/TutorUpload.tsx` |
| Create | `src/lib/audioClipper.ts` |
| Create | `src/hooks/useTutorUpload.ts` |
| Create | `src/components/tutor/CandidateCard.tsx` |
| Create | `src/components/tutor/CandidateList.tsx` |
| Create | `supabase/functions/classify-tutor-segments/index.ts` |
| Create | `supabase/functions/generate-flashcard-image/index.ts` |
| Modify | `src/pages/Index.tsx` -- add nav button |
| Modify | `src/App.tsx` -- add route |
| Modify | `supabase/config.toml` -- register new functions |
| Migration | New table + storage bucket + user_vocabulary columns |

---

## Error Handling & Trust (Prompt 8)

- Low confidence candidates (< 0.6) display a yellow warning badge: "Low confidence -- please verify"
- No flashcards are ever auto-created; every item requires explicit approval
- All fields are editable before approval
- Rejected items are simply skipped (not stored as flashcards)
- If classification fails entirely, the system shows the raw transcript segments and lets the user manually tag them

