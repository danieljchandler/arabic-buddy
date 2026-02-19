 import { useState, useRef, useEffect, useCallback } from "react";
 import { ChevronDown, ChevronUp, Eye, EyeOff, Play, Pause, Plus, BookOpen, Check, Link2 } from "lucide-react";
 import { cn } from "@/lib/utils";
 import { Switch } from "@/components/ui/switch";
 import {
   Popover,
   PopoverContent,
   PopoverTrigger,
 } from "@/components/ui/popover";
 import { Button } from "@/components/ui/button";
 import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";
import { supabase } from "@/integrations/supabase/client";
 
 interface LineByLineTranscriptProps {
   lines: TranscriptLine[];
   audioUrl?: string;
   currentTimeMs?: number;
   onAddToVocabSection?: (word: VocabItem) => void;
   onSaveToMyWords?: (word: VocabItem) => void;
   savedWords?: Set<string>;
   vocabSectionWords?: Set<string>;
 }
 
interface InlineTokenProps {
  token: WordToken;
  parentLine: TranscriptLine;
  isHighlighted?: boolean;
  isSelected?: boolean;
  onAddToVocabSection?: (word: VocabItem) => void;
  onSaveToMyWords?: (word: VocabItem) => void;
  isSavedToMyWords?: boolean;
  isInVocabSection?: boolean;
  onTokenClick?: (token: WordToken) => void;
  // compound popover
  compoundOpen?: boolean;
  compoundGloss?: string;
  compoundSurface?: string;
  onCompoundOpenChange?: (open: boolean) => void;
  onAddCompoundToVocab?: () => void;
  onSaveCompoundToMyWords?: () => void;
  isCompoundSavedToMyWords?: boolean;
  isCompoundInVocabSection?: boolean;
  isLoadingCompound?: boolean;
}
 
const InlineToken = ({ 
  token, 
  parentLine,
  isHighlighted, 
  isSelected,
  onAddToVocabSection,
  onSaveToMyWords,
  isSavedToMyWords,
  isInVocabSection,
  onTokenClick,
  compoundOpen,
  compoundGloss,
  compoundSurface,
  onCompoundOpenChange,
  onAddCompoundToVocab,
  onSaveCompoundToMyWords,
  isCompoundSavedToMyWords,
  isCompoundInVocabSection,
  isLoadingCompound,
}: InlineTokenProps) => {
  const [singleOpen, setSingleOpen] = useState(false);
  const hasGloss = !!token.gloss;
  
  const vocabItem: VocabItem = {
    arabic: token.surface,
    english: token.gloss || "",
    sentenceText: parentLine.arabic,
    sentenceEnglish: parentLine.translation,
    startMs: parentLine.startMs,
    endMs: parentLine.endMs,
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onTokenClick) {
      onTokenClick(token);
    } else {
      setSingleOpen(true);
    }
  };

  // If this token is the anchor for a compound popover, render that
  if (compoundOpen !== undefined) {
    return (
      <Popover open={compoundOpen} onOpenChange={onCompoundOpenChange}>
        <PopoverTrigger asChild>
          <span
            className={cn(
              "cursor-pointer transition-colors duration-150",
              "hover:text-primary hover:underline hover:decoration-primary/40 hover:underline-offset-4",
            isSelected && "bg-secondary/20 text-secondary rounded px-0.5",
              isHighlighted && "bg-primary/20 text-primary rounded px-0.5"
            )}
            role="button"
            tabIndex={0}
            onClick={handleClick}
          >
            {token.surface}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="w-auto min-w-[220px] p-3 z-[100]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-3">
            <div className="text-center border-b border-border pb-2">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Link2 className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">compound phrase</span>
              </div>
              <p
                className="text-xl font-bold text-foreground mb-1"
                style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                dir="rtl"
              >
                {compoundSurface}
              </p>
              {isLoadingCompound ? (
                <div className="flex items-center justify-center gap-2 mt-1">
                  <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <span className="text-xs text-muted-foreground">Translating…</span>
                </div>
              ) : compoundGloss ? (
                <p className="text-sm text-muted-foreground">{compoundGloss}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">Could not translate</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {onAddCompoundToVocab && !isLoadingCompound && compoundGloss && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => { onAddCompoundToVocab(); onCompoundOpenChange?.(false); }}
                  disabled={isCompoundInVocabSection}
                >
                  {isCompoundInVocabSection ? <><Check className="h-4 w-4 text-primary" />In vocab section</> : <><Plus className="h-4 w-4" />Add to vocab section</>}
                </Button>
              )}
              {onSaveCompoundToMyWords && !isLoadingCompound && compoundGloss && (
                <Button
                  variant="default"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => { onSaveCompoundToMyWords(); onCompoundOpenChange?.(false); }}
                  disabled={isCompoundSavedToMyWords}
                >
                  {isCompoundSavedToMyWords ? <><Check className="h-4 w-4" />Saved to My Words</> : <><BookOpen className="h-4 w-4" />Save to My Words</>}
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Normal single-word popover
  return (
    <Popover open={singleOpen} onOpenChange={setSingleOpen}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "cursor-pointer transition-colors duration-150",
            "hover:text-primary hover:underline hover:decoration-primary/40 hover:underline-offset-4",
            "active:text-primary active:underline active:decoration-primary/60",
            isSelected && "bg-secondary/20 text-secondary rounded px-0.5",
            isHighlighted && "bg-primary/20 text-primary rounded px-0.5"
          )}
          role="button"
          tabIndex={0}
          onClick={handleClick}
        >
          {token.surface}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto min-w-[200px] p-3 z-[100]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          {/* Word display */}
          <div className="text-center border-b border-border pb-2">
            <p 
              className="text-xl font-bold text-foreground mb-1"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              {token.surface}
            </p>
            {hasGloss && (
              <p className="text-sm text-muted-foreground">{token.gloss}</p>
            )}
            {token.standard && (
             <p className="text-xs text-muted-foreground/70" dir="rtl">
               (Standard: {token.standard})
             </p>
            )}
            {!hasGloss && (
              <p className="text-xs text-muted-foreground italic">
                No definition — tap 1–2 adjacent words to combine
              </p>
            )}
          </div>
          
          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {onAddToVocabSection && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  onAddToVocabSection(vocabItem);
                  setSingleOpen(false);
                }}
                disabled={isInVocabSection}
              >
                {isInVocabSection ? (
                  <>
                    <Check className="h-4 w-4 text-primary" />
                    In vocab section
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Add to vocab section
                  </>
                )}
              </Button>
            )}
            
            {onSaveToMyWords && (
              <Button
                variant="default"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  onSaveToMyWords(vocabItem);
                  setSingleOpen(false);
                }}
                disabled={isSavedToMyWords}
              >
                {isSavedToMyWords ? (
                  <>
                    <Check className="h-4 w-4" />
                    Saved to My Words
                  </>
                ) : (
                  <>
                    <BookOpen className="h-4 w-4" />
                    Save to My Words
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
 
interface TranscriptLineCardProps {
   line: TranscriptLine;
   isActive: boolean;
   isPlaying: boolean;
   showTranslation: boolean;
   onToggle: () => void;
   onPlay: () => void;
   hasAudio: boolean;
   currentTimeMs?: number;
   onAddToVocabSection?: (word: VocabItem) => void;
   onSaveToMyWords?: (word: VocabItem) => void;
   savedWords?: Set<string>;
   vocabSectionWords?: Set<string>;
 }
 
 const TranscriptLineCard = ({
   line,
   isActive,
   isPlaying,
   showTranslation,
   onToggle,
   onPlay,
   hasAudio,
   currentTimeMs,
   onAddToVocabSection,
   onSaveToMyWords,
   savedWords,
   vocabSectionWords,
 }: TranscriptLineCardProps) => {
   const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
   const [compoundPopoverIdx, setCompoundPopoverIdx] = useState<number | null>(null);
   const [liveCompound, setLiveCompound] = useState<{
     firstIdx: number;
     surface: string;
     wordCount: number;
     translation: string | null;
     loading: boolean;
   } | null>(null);
   const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

   // Lookup compound gloss for a range [firstIdx, lastIdx] (inclusive).
   // Supports bigrams (span=1) and trigrams (span=2).
   // The backend marks 2nd (and 3rd) compound tokens with "(→ firstWord)" in their gloss.
   const getCompoundGloss = useCallback((firstIdx: number, lastIdx: number): string | undefined => {
     if (!line.tokens) return undefined;
     const span = lastIdx - firstIdx;
     if (span < 1 || span > 2) return undefined;

     const t1 = line.tokens[firstIdx];
     const t2 = line.tokens[firstIdx + 1];
     if (!t1 || !t2) return undefined;

     if (span === 1) {
       // Bigram: second token carries "(→ ..." marker, first token has the compound gloss
       if (t2.gloss?.startsWith("(→")) return t1.gloss;
       if (t1.gloss?.startsWith("(→")) return t2.gloss;
       return undefined;
     }

     // Trigram: both second and third tokens carry "(→ ..." markers
     const t3 = line.tokens[firstIdx + 2];
     if (!t3) return undefined;
     if (t2.gloss?.startsWith("(→") && t3.gloss?.startsWith("(→")) return t1.gloss;
     return undefined;
   }, [line.tokens]);

   const handleTokenClick = useCallback((token: WordToken) => {
     const idx = line.tokens.findIndex(t => t.id === token.id);
     if (idx === -1) return;

     if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);

     if (selectedIndices.length === 0) {
       // First tap — select this token, close any existing compound popup, auto-clear after 3s
       setCompoundPopoverIdx(null);
       setLiveCompound(null);
       setSelectedIndices([idx]);
       selectionTimerRef.current = setTimeout(() => setSelectedIndices([]), 3000);
       return;
     }

     const minSel = Math.min(...selectedIndices);
     const maxSel = Math.max(...selectedIndices);

     // Tapped the same single selected token — deselect
     if (selectedIndices.length === 1 && idx === selectedIndices[0]) {
       setSelectedIndices([]);
       return;
     }

     // Check if adjacent to current selection range
     const isAdjacentLeft = idx === minSel - 1;
     const isAdjacentRight = idx === maxSel + 1;

     if (!isAdjacentLeft && !isAdjacentRight) {
       // Not adjacent — start fresh selection
       setCompoundPopoverIdx(null);
       setLiveCompound(null);
       setSelectedIndices([idx]);
       selectionTimerRef.current = setTimeout(() => setSelectedIndices([]), 3000);
       return;
     }

     const newMin = isAdjacentLeft ? idx : minSel;
     const newMax = isAdjacentRight ? idx : maxSel;
     const newSpan = newMax - newMin; // 1 = bigram, 2 = trigram

     if (newSpan > 2) {
       // Max 3 words — start fresh
       setSelectedIndices([idx]);
       selectionTimerRef.current = setTimeout(() => setSelectedIndices([]), 3000);
       return;
     }

     // Commit the selection — always show compound popup
     const preComputedGloss = getCompoundGloss(newMin, newMax);
     setCompoundPopoverIdx(newMin);
     setSelectedIndices([]);

     if (preComputedGloss) {
       // Pre-computed compound — clear any live lookup
       setLiveCompound(null);
     } else {
       // No pre-computed compound — trigger live translation
       const combinedSurface = line.tokens
         .slice(newMin, newMax + 1)
         .map(t => t.surface)
         .join(' ');
       setLiveCompound({ firstIdx: newMin, surface: combinedSurface, wordCount: newSpan + 1, translation: null, loading: true });
       supabase.functions
         .invoke('analyze-gulf-arabic', { body: { phrase: combinedSurface } })
         .then(({ data, error }) => {
           if (!error && data?.translation) {
             setLiveCompound({ firstIdx: newMin, surface: combinedSurface, wordCount: newSpan + 1, translation: data.translation, loading: false });
           } else {
             console.warn('phrase translation failed:', error);
             setLiveCompound({ firstIdx: newMin, surface: combinedSurface, wordCount: newSpan + 1, translation: null, loading: false });
           }
         })
         .catch((err) => {
           console.warn('phrase translation error:', err);
           setLiveCompound(prev => prev ? { ...prev, loading: false } : null);
         });
     }
   }, [selectedIndices, line.tokens, getCompoundGloss]);

   const isTokenHighlighted = (_token: WordToken, _index: number): boolean => false;

   return (
     <div
       className={cn(
         "rounded-xl bg-card border border-border p-4 transition-all duration-200",
         "hover:shadow-md",
         isActive && "ring-2 ring-primary/50 border-primary bg-primary/5"
       )}
     >
       {/* Header row with play button */}
       <div className="flex items-start gap-3">
         {/* Play button */}
         {hasAudio && (
           <Button
             variant="ghost"
             size="icon"
             className={cn(
               "h-8 w-8 shrink-0 rounded-full transition-colors",
               isActive 
                 ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                 : "bg-muted hover:bg-muted/80"
             )}
             onClick={(e) => {
               e.stopPropagation();
               onPlay();
             }}
           >
             {isActive && isPlaying ? (
               <Pause className="h-4 w-4" />
             ) : (
               <Play className="h-4 w-4 ml-0.5" />
             )}
           </Button>
         )}
 
         {/* Arabic sentence with tokens */}
         <div
           className="flex-1 text-lg leading-loose cursor-pointer"
           dir="rtl"
           style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
           onClick={(e) => {
             if ((e.target as HTMLElement).closest("[data-token]")) return;
             onToggle();
           }}
         >
          {line.tokens && line.tokens.length > 0 ? (
             line.tokens.map((token, index) => {
               const isThisCompoundAnchor = compoundPopoverIdx === index;
               // Live compound data for this anchor (if a live lookup is in progress or done)
               const thisLiveCompound = isThisCompoundAnchor && liveCompound?.firstIdx === index
                 ? liveCompound
                 : null;
               // Determine compound word count: from live lookup OR from backend "(→" markers
               const compoundWordCount = isThisCompoundAnchor
                 ? (thisLiveCompound
                     ? thisLiveCompound.wordCount
                     : (() => {
                         let count = 1;
                         let next = index + 1;
                         while (
                           next < line.tokens.length &&
                           line.tokens[next]?.gloss?.startsWith("(→") &&
                           count < 3
                         ) { count++; next++; }
                         return count;
                       })())
                 : 1;
               const compoundSurface = isThisCompoundAnchor
                 ? (thisLiveCompound?.surface ?? line.tokens.slice(index, index + compoundWordCount).map(t => t.surface).join(' '))
                 : undefined;
               const compoundGloss = isThisCompoundAnchor
                 ? (thisLiveCompound
                     ? (thisLiveCompound.translation ?? undefined)
                     : getCompoundGloss(index, index + compoundWordCount - 1))
                 : undefined;
               const isLoadingCompound = isThisCompoundAnchor && !!thisLiveCompound?.loading;

               const compoundVocabItem: VocabItem = {
                 arabic: compoundSurface || token.surface,
                 english: compoundGloss || "",
                 sentenceText: line.arabic,
                 sentenceEnglish: line.translation,
                 startMs: line.startMs,
                 endMs: line.endMs,
               };

               return (
                 <span key={token.id} data-token className="inline">
                   <InlineToken 
                     token={token}
                     parentLine={line}
                     isHighlighted={isTokenHighlighted(token, index)}
                     isSelected={selectedIndices.includes(index)}
                     onAddToVocabSection={onAddToVocabSection}
                     onSaveToMyWords={onSaveToMyWords}
                     isSavedToMyWords={savedWords?.has(token.surface)}
                     isInVocabSection={vocabSectionWords?.has(token.surface)}
                     onTokenClick={handleTokenClick}
                     compoundOpen={isThisCompoundAnchor ? true : undefined}
                     compoundGloss={compoundGloss}
                     compoundSurface={compoundSurface}
                     isLoadingCompound={isLoadingCompound}
                     onCompoundOpenChange={(open) => {
                       if (!open) setCompoundPopoverIdx(null);
                     }}
                     onAddCompoundToVocab={onAddToVocabSection ? () => onAddToVocabSection(compoundVocabItem) : undefined}
                     onSaveCompoundToMyWords={onSaveToMyWords ? () => onSaveToMyWords(compoundVocabItem) : undefined}
                     isCompoundSavedToMyWords={compoundSurface ? savedWords?.has(compoundSurface) : false}
                     isCompoundInVocabSection={compoundSurface ? vocabSectionWords?.has(compoundSurface) : false}
                   />
                   {index < line.tokens.length - 1 &&
                     !/^[،؟.!:؛]+$/.test(token.surface) && " "}
                 </span>
               );
             })
           ) : (
             <span className="text-foreground">
               {line.arabic}
             </span>
           )}
         </div>
       </div>
 
       {/* English translation (collapsible) */}
       <div
         className={cn(
           "overflow-hidden transition-all duration-200",
           showTranslation ? "max-h-40 opacity-100 mt-3" : "max-h-0 opacity-0"
         )}
       >
         <div className="pt-3 border-t border-border/50">
           <p
             className="text-sm text-muted-foreground leading-relaxed"
             dir="ltr"
             style={{ fontFamily: "'Open Sans', sans-serif" }}
           >
             {line.translation}
           </p>
         </div>
       </div>
 
       {/* Expand indicator */}
       <div 
         className="flex justify-center mt-2 cursor-pointer"
         onClick={onToggle}
       >
         {showTranslation ? (
           <ChevronUp className="h-4 w-4 text-muted-foreground/50" />
         ) : (
           <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
         )}
       </div>

       {/* Selection hint */}
       {selectedIndices.length > 0 && (
         <p className="text-xs text-secondary/70 text-center mt-2 animate-pulse italic">
           Tap an adjacent word to see combined translation
         </p>
       )}
     </div>
   );
 };
 
export const LineByLineTranscript = ({
   lines,
   audioUrl,
   currentTimeMs,
   onAddToVocabSection,
   onSaveToMyWords,
   savedWords,
   vocabSectionWords,
 }: LineByLineTranscriptProps) => {
   const [showAllTranslations, setShowAllTranslations] = useState(false);
   const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
   const [activeLineId, setActiveLineId] = useState<string | null>(null);
   const [isPlaying, setIsPlaying] = useState(false);
  const [internalCurrentTimeMs, setInternalCurrentTimeMs] = useState<number>(0);
   const audioRef = useRef<HTMLAudioElement | null>(null);
 
   useEffect(() => {
     if (audioUrl && !audioRef.current) {
       audioRef.current = new Audio(audioUrl);
       audioRef.current.addEventListener('ended', () => { setIsPlaying(false); setActiveLineId(null); });
       audioRef.current.addEventListener('pause', () => setIsPlaying(false));
       audioRef.current.addEventListener('play', () => setIsPlaying(true));
      audioRef.current.addEventListener('timeupdate', () => {
        if (audioRef.current) setInternalCurrentTimeMs(audioRef.current.currentTime * 1000);
      });
     }
     return () => {
       if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
     };
   }, [audioUrl]);
 
   useEffect(() => {
     if (audioRef.current && audioUrl) audioRef.current.src = audioUrl;
   }, [audioUrl]);
 
  const effectiveCurrentTimeMs = currentTimeMs ?? internalCurrentTimeMs;
  const stopAtEndRef = useRef<number | null>(null);

  const handlePlayLine = (line: TranscriptLine) => {
    if (!audioRef.current || !audioUrl) return;
    if (stopAtEndRef.current !== null) { cancelAnimationFrame(stopAtEndRef.current); stopAtEndRef.current = null; }
    if (activeLineId === line.id && isPlaying) { audioRef.current.pause(); return; }
    setActiveLineId(line.id);
    if (line.startMs !== undefined && line.endMs !== undefined) {
      audioRef.current.currentTime = line.startMs / 1000;
      const checkTime = () => {
        if (!audioRef.current) return;
        if (audioRef.current.currentTime * 1000 >= line.endMs!) {
          audioRef.current.pause(); setIsPlaying(false); stopAtEndRef.current = null; return;
        }
        if (!audioRef.current.paused) stopAtEndRef.current = requestAnimationFrame(checkTime);
      };
      audioRef.current.play().then(() => { stopAtEndRef.current = requestAnimationFrame(checkTime); }).catch(console.error);
    } else {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(console.error);
    }
  };
 
   const toggleLine = (lineId: string) => {
     setExpandedLines((prev) => {
       const next = new Set(prev);
       if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
       return next;
     });
   };
 
   const isLineExpanded = (lineId: string) => showAllTranslations || expandedLines.has(lineId);
 
   if (!lines || lines.length === 0) return null;
 
   return (
     <div className="space-y-4">
       <div className="flex items-center justify-between">
         <h3
           className="text-lg font-semibold text-foreground"
           style={{ fontFamily: "'Montserrat', sans-serif" }}
          >
            Sentences
         </h3>
         <div className="flex items-center gap-2">
           <span className="text-xs text-muted-foreground">
             {showAllTranslations ? (
               <Eye className="h-4 w-4 inline mr-1" />
             ) : (
               <EyeOff className="h-4 w-4 inline mr-1" />
             )}
             Show all translations
           </span>
           <Switch
             checked={showAllTranslations}
             onCheckedChange={setShowAllTranslations}
           />
         </div>
       </div>
 
       <div className="space-y-3">
         {lines.map((line) => (
           <TranscriptLineCard
             key={line.id}
             line={line}
             isActive={activeLineId === line.id}
             isPlaying={isPlaying && activeLineId === line.id}
             showTranslation={isLineExpanded(line.id)}
             onToggle={() => toggleLine(line.id)}
             onPlay={() => handlePlayLine(line)}
             hasAudio={!!audioUrl}
             currentTimeMs={effectiveCurrentTimeMs}
             onAddToVocabSection={onAddToVocabSection}
             onSaveToMyWords={onSaveToMyWords}
             savedWords={savedWords}
             vocabSectionWords={vocabSectionWords}
           />
         ))}
       </div>
 
       <p className="text-xs text-muted-foreground text-center">
         {lines.length} {lines.length === 1 ? "sentence" : "sentences"}
       </p>
     </div>
   );
 };
 
 export default LineByLineTranscript;
