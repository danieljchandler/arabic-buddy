import { cn } from "@/lib/utils";

interface ProgressDotsProps {
  total: number;
  current: number;
  gradient: string;
}

export const ProgressDots = ({ total, current, gradient }: ProgressDotsProps) => {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "transition-all duration-300 rounded-full",
            index === current
              ? "w-8 h-3 bg-primary"
              : "w-3 h-3 bg-muted"
          )}
        />
      ))}
    </div>
  );
};
