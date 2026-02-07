 import { useState, useRef, useEffect } from "react";
 import { ChevronDown, ChevronUp, Eye, EyeOff, Play, Pause, Plus, BookOpen, Check } from "lucide-react";
 import { cn } from "@/lib/utils";
 import { Switch } from "@/components/ui/switch";
 import {
   Popover,
   PopoverContent,
   PopoverTrigger,
 } from "@/components/ui/popover";
 import { Button } from "@/components/ui/button";
 import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";
 
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
   isHighlighted?: boolean;
   onAddToVocabSection?: (word: VocabItem) => void;
   onSaveToMyWords?: (word: VocabItem) => void;
   isSavedToMyWords?: boolean;
   isInVocabSection?: boolean;
 }
 
 const InlineToken = ({ 
   token, 
   isHighlighted, 
   onAddToVocabSection,
   onSaveToMyWords,
   isSavedToMyWords,
   isInVocabSection,
 }: InlineTokenProps) => {
   const [open, setOpen] = useState(false);
   const hasGloss = !!token.gloss;
   
   const vocabItem: VocabItem = {
     arabic: token.surface,
     english: token.gloss || "",
   };

   return (
     <Popover open={open} onOpenChange={setOpen}>
       <PopoverTrigger asChild>
         <span
           className={cn(
             "cursor-pointer transition-colors duration-150",
             "hover:text-primary hover:underline hover:decoration-primary/40 hover:underline-offset-4",
             "active:text-primary active:underline active:decoration-primary/60",
             isHighlighted && "bg-primary/20 text-primary rounded px-0.5"
           )}
           role="button"
           tabIndex={0}
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
                 No definition available
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
                   setOpen(false);
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
                   setOpen(false);
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
   // Determine if a token should be highlighted based on current playback time
   const isTokenHighlighted = (token: WordToken, index: number): boolean => {
     if (!isActive || !isPlaying || currentTimeMs === undefined) return false;
     // Future: check token.startMs and token.endMs when available
     // For now, return false until timestamps are mapped
     return false;
   };

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
             // Don't toggle if clicking on a token
             if ((e.target as HTMLElement).closest("[data-token]")) return;
             onToggle();
           }}
         >
          {line.tokens && line.tokens.length > 0 ? (
             line.tokens.map((token, index) => (
               <span key={token.id} data-token className="inline">
                  <InlineToken 
                    token={token} 
                    isHighlighted={isTokenHighlighted(token, index)}
                    onAddToVocabSection={onAddToVocabSection}
                    onSaveToMyWords={onSaveToMyWords}
                    isSavedToMyWords={savedWords?.has(token.surface)}
                    isInVocabSection={vocabSectionWords?.has(token.surface)}
                  />
                 {/* Add space between words, but not after punctuation-only tokens */}
                 {index < line.tokens.length - 1 &&
                   !/^[،؟.!:؛]+$/.test(token.surface) && " "}
               </span>
             ))
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
 
   // Initialize audio element
   useEffect(() => {
     if (audioUrl && !audioRef.current) {
       audioRef.current = new Audio(audioUrl);
       
       audioRef.current.addEventListener('ended', () => {
         setIsPlaying(false);
         setActiveLineId(null);
       });
       
       audioRef.current.addEventListener('pause', () => {
         setIsPlaying(false);
       });
       
       audioRef.current.addEventListener('play', () => {
         setIsPlaying(true);
       });
      
      audioRef.current.addEventListener('timeupdate', () => {
        if (audioRef.current) {
          setInternalCurrentTimeMs(audioRef.current.currentTime * 1000);
        }
      });
     }
     
     return () => {
       if (audioRef.current) {
         audioRef.current.pause();
         audioRef.current = null;
       }
     };
   }, [audioUrl]);
 
   // Update audio source when URL changes
   useEffect(() => {
     if (audioRef.current && audioUrl) {
       audioRef.current.src = audioUrl;
     }
   }, [audioUrl]);
 
  // Use external currentTimeMs if provided, otherwise use internal
  const effectiveCurrentTimeMs = currentTimeMs ?? internalCurrentTimeMs;

  const stopAtEndRef = useRef<number | null>(null);

  const handlePlayLine = (line: TranscriptLine) => {
    if (!audioRef.current || !audioUrl) return;

    // Clear any pending stop timer
    if (stopAtEndRef.current !== null) {
      cancelAnimationFrame(stopAtEndRef.current);
      stopAtEndRef.current = null;
    }

    // If clicking the same line that's playing, toggle pause
    if (activeLineId === line.id && isPlaying) {
      audioRef.current.pause();
      return;
    }

    setActiveLineId(line.id);

    // If startMs/endMs exist, seek to startMs and schedule stop at endMs
    if (line.startMs !== undefined && line.endMs !== undefined) {
      audioRef.current.currentTime = line.startMs / 1000;
      
      const checkTime = () => {
        if (!audioRef.current) return;
        
        const currentMs = audioRef.current.currentTime * 1000;
        if (currentMs >= line.endMs!) {
          audioRef.current.pause();
          setIsPlaying(false);
          stopAtEndRef.current = null;
          return;
        }
        
        if (!audioRef.current.paused) {
          stopAtEndRef.current = requestAnimationFrame(checkTime);
        }
      };
      
      audioRef.current.play().then(() => {
        stopAtEndRef.current = requestAnimationFrame(checkTime);
      }).catch(console.error);
    } else {
      // No timestamps - play from beginning (fallback)
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(console.error);
    }
  };
 
   const toggleLine = (lineId: string) => {
     setExpandedLines((prev) => {
       const next = new Set(prev);
       if (next.has(lineId)) {
         next.delete(lineId);
       } else {
         next.add(lineId);
       }
       return next;
     });
   };
 
   const isLineExpanded = (lineId: string) => {
     return showAllTranslations || expandedLines.has(lineId);
   };
 
   if (!lines || lines.length === 0) {
     return null;
   }
 
   return (
     <div className="space-y-4">
       {/* Header with toggle */}
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
 
       {/* Lines list */}
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
 
       {/* Line count */}
       <p className="text-xs text-muted-foreground text-center">
         {lines.length} {lines.length === 1 ? "sentence" : "sentences"}
       </p>
     </div>
   );
 };
 
 export default LineByLineTranscript;