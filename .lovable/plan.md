
# Vocabulary Word Audio Context Enhancement

## Current System Analysis

From exploring the codebase, I can see that:

1. **Existing Infrastructure:**
   - `user_vocabulary` table already has `word_audio_url`, `sentence_audio_url`, `sentence_text`, `sentence_english` columns
   - `flashcard-audio` storage bucket exists for audio files
   - `src/lib/audioClipper.ts` contains Web Audio API utilities for audio clipping

2. **Current Vocabulary Saving:**
   - Multiple entry points: transcript pages, meme analyzer, tutor upload candidates
   - Basic word/translation saving without consistent audio context
   - Some pages have timing data available but not being utilized

3. **Audio/Video Sources:**
   - Transcription pages with timed segments
   - TikTok/YouTube videos with transcript timing
   - Tutor upload audio with word-level timestamps
   - Meme analyzer with potential audio context

## Proposed Enhancement

### 1. Audio Context Detection System
Create a unified system to detect and extract audio context when saving vocabulary:

**New Utility: `src/lib/vocabularyAudioContext.ts`**
- Detect current page context (transcript, video, audio upload)
- Extract relevant timing data for words/sentences
- Generate audio clips using existing Web Audio API
- Upload clips to `flashcard-audio` bucket

### 2. Enhanced Vocabulary Saving Flow

**Updated Save Process:**
1. **Context Detection:** Identify if page has audio/video source
2. **Timing Extraction:** Get word/sentence start/end times from context
3. **Audio Clipping:** Extract relevant audio segment using Web Audio API
4. **Upload & Save:** Store audio clip and update `user_vocabulary` record

**Source-Specific Logic:**
- **Transcript Pages:** Use `TranscriptLine` timing data for sentence audio
- **Video Pages:** Extract from video timeline using segment timestamps  
- **Tutor Uploads:** Use word-level timing from upload candidates
- **Single Words:** Extract just the word audio if sentence unavailable

### 3. Implementation Points

**Core Components to Update:**
- `src/hooks/useUserVocabulary.ts` - Add audio context processing
- `src/components/transcript/` - Enhanced word saving from transcript lines
- `src/pages/Transcribe.tsx` - Integrate with video timeline
- `src/pages/MemeAnalyzer.tsx` - Add audio context extraction
- Tutor upload vocabulary approval flow

**Audio Processing Pipeline:**
1. **Source Audio Access:** Get audio/video element from DOM
2. **Segment Extraction:** Use existing `audioClipper.ts` utilities
3. **File Generation:** Convert to blob and upload to storage
4. **Database Update:** Save audio URLs with vocabulary entry

### 4. User Experience Improvements

**Audio Feedback:**
- Play button preview before saving
- Visual indication when audio context is available
- Fallback to text-only saving when audio unavailable

**Quality Assurance:**
- Verify audio clip quality and audibility
- Handle edge cases (very short words, background noise)
- Graceful degradation when audio extraction fails

### 5. Technical Considerations

**Performance:**
- Client-side audio processing using Web Audio API
- Efficient blob generation and upload
- Progress indicators for audio processing

**Audio Quality:**
- Maintain original audio quality in clips
- Handle different audio formats and sample rates
- Normalize volume levels across clips

**Error Handling:**
- Network failures during upload
- Corrupted or unavailable source audio
- Browser compatibility for Web Audio API

**Storage Management:**
- Unique file naming to prevent conflicts
- Cleanup of unused audio files
- Reasonable file size limits for clips

## Expected Benefits

**Enhanced Learning:**
- Native pronunciation reference for saved words
- Sentence context preserved with audio
- Consistent audio-visual flashcard experience

**User Experience:**
- Seamless audio context preservation
- No additional user effort required
- Improved retention through multi-modal learning

**System Efficiency:**
- Leverages existing infrastructure
- Minimal additional storage requirements
- Consistent across all vocabulary saving flows
