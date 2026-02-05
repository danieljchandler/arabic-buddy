 import { useState } from "react";
 import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
 import { cn } from "@/lib/utils";
 import { Switch } from "@/components/ui/switch";
 import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
 import type { TranscriptLine, WordToken } from "@/types/transcript";
 
 interface LineByLineTranscriptProps {
   lines: TranscriptLine[];
   onPlaySegment?: (line: TranscriptLine) => void;
 }
 
 interface TokenChipProps {
   token: WordToken;
 }
 
 const TokenChip = ({ token }: TokenChipProps) => {
   const hasGloss = !!token.gloss;
   const hasStandard = !!token.standard;
   const hasInfo = hasGloss || hasStandard;
 
   return (
     <Popover>
       <PopoverTrigger asChild>
         <button
           type="button"
           className={cn(
             "inline-block px-1.5 py-0.5 rounded-md text-lg transition-colors",
             "font-semibold",
             hasInfo
               ? "bg-primary/10 hover:bg-primary/20 text-foreground cursor-pointer"
               : "bg-muted/50 text-foreground/80 cursor-default"
           )}
           style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
         >
           {token.surface}
         </button>
       </PopoverTrigger>
       <PopoverContent
         className="w-auto min-w-[160px] max-w-[250px] p-3 bg-card border-border z-50"
         side="top"
         align="center"
       >
         <div className="space-y-2 text-sm" dir="ltr">
           <div
             className="text-lg font-bold text-foreground text-center"
             dir="rtl"
             style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
           >
             {token.surface}
           </div>
           
           {hasGloss ? (
             <div className="text-center text-muted-foreground">
               {token.gloss}
             </div>
           ) : (
             <div className="text-center text-muted-foreground/70 italic text-xs">
               No gloss available yet
             </div>
           )}
           
           {hasStandard && (
             <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
               <span className="text-muted-foreground/70">Standard: </span>
               <span
                 className="font-semibold"
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
   showTranslation: boolean;
   onToggle: () => void;
   onPlaySegment?: (line: TranscriptLine) => void;
 }
 
 const TranscriptLineCard = ({
   line,
   showTranslation,
   onToggle,
   onPlaySegment,
 }: TranscriptLineCardProps) => {
   return (
     <div
       className={cn(
         "rounded-xl bg-card border border-border p-4 transition-all duration-200",
         "hover:shadow-md cursor-pointer"
       )}
       onClick={(e) => {
         // Only toggle if clicking the card itself, not a token
         if ((e.target as HTMLElement).closest('[data-token]')) return;
         onToggle();
       }}
     >
       {/* Arabic sentence with tokens */}
       <div
         className="flex flex-wrap gap-1.5 justify-end leading-relaxed"
         dir="rtl"
       >
         {line.tokens && line.tokens.length > 0 ? (
           line.tokens.map((token) => (
             <span key={token.id} data-token>
               <TokenChip token={token} />
             </span>
           ))
         ) : (
           <span
             className="text-lg text-foreground"
             style={{ fontFamily: "'Cairo', 'Traditional Arabic', sans-serif" }}
           >
             {line.arabic}
           </span>
         )}
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
       <div className="flex justify-center mt-2">
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
   onPlaySegment,
 }: LineByLineTranscriptProps) => {
   const [showAllTranslations, setShowAllTranslations] = useState(false);
   const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
 
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
             showTranslation={isLineExpanded(line.id)}
             onToggle={() => toggleLine(line.id)}
             onPlaySegment={onPlaySegment}
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