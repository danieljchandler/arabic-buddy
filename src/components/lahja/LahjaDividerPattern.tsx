import { cn } from "@/lib/utils";

interface LahjaDividerPatternProps {
  className?: string;
}

export const LahjaDividerPattern = ({ className }: LahjaDividerPatternProps) => {
  return (
    <div className={cn("relative h-6 w-full overflow-hidden rounded-full", className)} aria-hidden>
      <div className="absolute inset-y-1/2 left-0 right-0 h-px -translate-y-1/2 bg-primary/12" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(31, 111, 84, 0.18) 0 1px, transparent 1px), repeating-linear-gradient(90deg, rgba(31, 111, 84, 0.14), rgba(31, 111, 84, 0.14) 8px, transparent 8px, transparent 18px)",
          backgroundSize: "18px 6px, 100% 100%",
          backgroundPosition: "center, center",
          opacity: 0.5,
        }}
      />
    </div>
  );
};
