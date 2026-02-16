import { cn } from "@/lib/utils";

interface LahjaWordRowProps {
  arabic: string;
  transliteration: string;
  english: string;
  className?: string;
}

export const LahjaWordRow = ({ arabic, transliteration, english, className }: LahjaWordRowProps) => {
  return (
    <div className={cn("grid gap-2 rounded-lg border border-border bg-white/55 px-4 py-3 md:grid-cols-[1fr_1fr_1fr]", className)}>
      <p className="font-arabic text-lg font-bold text-foreground" dir="rtl">
        {arabic}
      </p>
      <p className="text-sm font-medium italic text-muted-foreground">{transliteration}</p>
      <p className="text-sm text-foreground">{english}</p>
    </div>
  );
};
