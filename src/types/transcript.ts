 export type WordToken = {
   id: string;
   surface: string;         // as spoken in transcript
   standard?: string;       // more standard spelling (optional)
   gloss?: string;          // English meaning for this word (optional)
 };
 
 export type TranscriptLine = {
   id: string;
   arabic: string;          // full sentence as spoken
   translation: string;     // English sentence translation
   tokens: WordToken[];     // clickable words
   startMs?: number;        // for future audio sync
   endMs?: number;
  segmentType?: 'audio' | 'text_overlay';
 };
 
export type VocabItem = {
  arabic: string;
  english: string;
  root?: string;
  sentenceText?: string;
  sentenceEnglish?: string;
  startMs?: number;
  endMs?: number;
};
 
 export type GrammarPoint = {
   title: string;
   explanation: string;
   examples?: string[];
 };
 
export type TranscriptResult = {
  rawTranscriptArabic: string;     // original blob
  lines: TranscriptLine[];
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
  dialectValidation?: { content: string; timestamp: string } | null;
  dialect?: 'Saudi' | 'Kuwaiti' | 'UAE' | 'Bahraini' | 'Qatari' | 'Omani' | 'Gulf';
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  /** Full merged Arabic with tashkeel from Farasa — feed to ElevenLabs TTS for accurate pronunciation. */
  diacritizedTranscript?: string | null;
  /** City-level Gulf dialect from CAMeL-Lab BERT model, independent of LLM detection. */
  camelDialect?: { code: string; dialect: string; confidence: number; isGulf: boolean } | null;
};

// ── Transcript Editor types (ASR word-level segments) ──────────────

/** A single word with timing data from ASR output. */
export type Word = {
  word: string;
  start: number;      // seconds
  end: number;        // seconds
  confidence: number; // 0–1
};

/** A subtitle segment composed of timed words. */
export type Segment = {
  id: string;
  video_id: string;
  start: number;       // seconds
  end: number;         // seconds
  text: string;        // Arabic
  translation: string; // English
  confidence: number;  // average of word confidences
  words: Word[];
  speaker?: string;
};

/** Operation types for the undo stack. */
export type UndoOperation =
  | { type: 'SplitOp'; originalSegment: Segment; resultSegments: [Segment, Segment] }
  | { type: 'MergeOp'; originalSegments: [Segment, Segment]; resultSegment: Segment }
  | { type: 'EditTextOp'; segmentId: string; previousText: string; newText: string }
  | { type: 'ShiftTimestampOp'; segmentId: string; field: 'start' | 'end'; previousValue: number; newValue: number }
  | { type: 'AIReplaceOp'; segmentId: string; previousText: string; newText: string }
  | { type: 'RippleTimestampOp'; changes: Array<{ segmentId: string; field: 'start' | 'end'; previousValue: number; newValue: number }> };

/** Result of gap analysis between segments. */
export type GapWarning = {
  type: 'gap' | 'overlap' | 'too-short' | 'too-long';
  severity: 'warning' | 'error';
  message: string;
  segmentIndex: number;
  /** Second segment index (for gap/overlap between two segments). */
  segmentIndexB?: number;
};

/** Publish-checklist item. */
export type PublishCheckItem = {
  label: string;
  passed: boolean;
};