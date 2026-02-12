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
 };