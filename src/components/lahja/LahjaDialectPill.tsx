import { cn } from "@/lib/utils";

interface LahjaDialectPillProps {
  label: string;
  active?: boolean;
  className?: string;
}

export const LahjaDialectPill = ({ label, active = false, className }: LahjaDialectPillProps) => {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide",
        active
          ? "border-primary/30 bg-primary/12 text-primary"
          : "border-border bg-white/60 text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
};
