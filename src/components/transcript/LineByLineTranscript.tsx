 import { useState, useRef, useEffect } from "react";
 import { ChevronDown, ChevronUp, Eye, EyeOff, Play, Pause } from "lucide-react";
 import { cn } from "@/lib/utils";
 import { Switch } from "@/components/ui/switch";
 import {
   Popover,
   PopoverContent,
   PopoverTrigger,
 } from "@/components/ui/popover";
 import { Button } from "@/components/ui/button";
 import type { TranscriptLine, WordToken } from "@/types/transcript";
 
 interface LineByLineTranscriptProps {
   lines: TranscriptLine[];
   audioUrl?: string;
 }
 
 interface InlineTokenProps {
   token: WordToken;
 }
 
 const InlineToken = ({ token }: InlineTokenProps) => {
   const hasGloss = !!token.gloss;
   const hasStandard = !!token.standard;
 
   return (
     <Popover>
       <PopoverTrigger asChild>
         <span
           className={cn(
             "cursor-pointer transition-colors duration-150",
             "hover:text-primary hover:underline hover:decoration-primary/40 hover:underline-offset-4",
             "active:text-primary active:underline active:decoration-primary/60"
           )}
           role="button"
           tabIndex={0}
         >
           {token.surface}
         </span>
       </PopoverTrigger>
       <PopoverContent
         className="w-auto min-w-[120px] max-w-[200px] p-2.5 bg-card border-border shadow-lg z-[100]"
         side="top"
         align="center"
         sideOffset={8}
         collisionPadding={16}
       >
         <div className="space-y-1.5" dir="ltr">
           <div
             className="text-base font-bold text-foreground text-center pb-1"
             dir="rtl"
             style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
           >
             {token.surface}
           </div>
 
           {hasGloss ? (
             <div className="text-sm text-center text-muted-foreground">
               {token.gloss}
             </div>
           ) : (
             <div className="text-xs text-center text-muted-foreground/60 italic">
               No gloss yet
             </div>
           )}
 
           {hasStandard && (
             <div className="text-xs text-muted-foreground border-t border-border/50 pt-1.5 mt-1">
               <span className="text-muted-foreground/60">Std: </span>
               <span
                 className="font-medium"
                 dir="rtl"
                 style={{ fontFamily: "'Cairo', sans-serif" }}
               >
                 {token.standard}
               </span>
             </div>
           )}
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
 }
 
 const TranscriptLineCard = ({
   line,
   isActive,
   isPlaying,
   showTranslation,
   onToggle,
   onPlay,
   hasAudio,
 }: TranscriptLineCardProps) => {
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
                 <InlineToken token={token} />
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
 }: LineByLineTranscriptProps) => {
   const [showAllTranslations, setShowAllTranslations] = useState(false);
   const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
   const [activeLineId, setActiveLineId] = useState<string | null>(null);
   const [isPlaying, setIsPlaying] = useState(false);
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
 
   const handlePlayLine = (line: TranscriptLine) => {
     if (!audioRef.current || !audioUrl) return;
 
     // If clicking the same line that's playing, toggle pause
     if (activeLineId === line.id && isPlaying) {
       audioRef.current.pause();
       return;
     }
 
     // TODO: If startMs/endMs exist, seek to startMs and schedule stop at endMs
     // if (line.startMs !== undefined && line.endMs !== undefined) {
     //   audioRef.current.currentTime = line.startMs / 1000;
     //   const duration = (line.endMs - line.startMs) / 1000;
     //   // Schedule pause at endMs
     //   const checkTime = () => {
     //     if (audioRef.current && audioRef.current.currentTime * 1000 >= line.endMs!) {
     //       audioRef.current.pause();
     //       return;
     //     }
     //     if (isPlaying && activeLineId === line.id) {
     //       requestAnimationFrame(checkTime);
     //     }
     //   };
     //   requestAnimationFrame(checkTime);
     // }
 
     // For now, play from the beginning
     audioRef.current.currentTime = 0;
     setActiveLineId(line.id);
     audioRef.current.play().catch(console.error);
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