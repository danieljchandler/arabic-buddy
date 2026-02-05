 import { useState, useRef, useEffect, forwardRef } from "react";
 import { ChevronDown, ChevronUp, Eye, EyeOff, Play, Pause } from "lucide-react";
 import { cn } from "@/lib/utils";
 import { Switch } from "@/components/ui/switch";
 import {
   Tooltip,
   TooltipContent,
   TooltipTrigger,
 } from "@/components/ui/tooltip";
 import { Button } from "@/components/ui/button";
 import type { TranscriptLine, WordToken } from "@/types/transcript";
 
 interface LineByLineTranscriptProps {
   lines: TranscriptLine[];
   audioUrl?: string;
  currentTimeMs?: number;
 }
 
 interface InlineTokenProps {
   token: WordToken;
  isHighlighted?: boolean;
 }
 
 const InlineToken = ({ token, isHighlighted }: InlineTokenProps) => {
   const hasGloss = !!token.gloss;
   const hasStandard = !!token.standard;
  const hasExtra = hasGloss || hasStandard;
 
  // If no extra info, just render the word without tooltip
  if (!hasExtra) {
    return (
      <span
        className={cn(
          "transition-colors duration-150",
          isHighlighted && "bg-primary/20 text-primary rounded px-0.5"
        )}
      >
        {token.surface}
      </span>
    );
  }

   return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="bg-card border-border shadow-lg z-[100] px-2 py-1.5"
      >
        <div className="text-sm text-center" dir="ltr">
          {hasGloss && <span className="text-foreground">{token.gloss}</span>}
          {hasGloss && hasStandard && <span className="text-muted-foreground mx-1">·</span>}
          {hasStandard && (
            <span className="text-muted-foreground text-xs" dir="rtl">
              {token.standard}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
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
                  <InlineToken token={token} isHighlighted={isTokenHighlighted(token, index)} />
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
           الجمل
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
           />
         ))}
       </div>
 
       {/* Line count */}
       <p className="text-xs text-muted-foreground text-center">
         {lines.length} جملة
       </p>
     </div>
   );
 };
 
 export default LineByLineTranscript;