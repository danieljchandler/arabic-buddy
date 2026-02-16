import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type LahjaButtonVariant = "primary" | "secondary" | "ghost";

interface LahjaButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: LahjaButtonVariant;
}

const variantClasses: Record<LahjaButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/35",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-secondary/35",
  ghost:
    "bg-transparent text-foreground hover:bg-primary/10 focus-visible:ring-primary/25",
};

export const LahjaButton = forwardRef<HTMLButtonElement, LahjaButtonProps>(
  ({ className, variant = "primary", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-4 py-2.5 font-heading text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45",
          "shadow-soft",
          variantClasses[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

LahjaButton.displayName = "LahjaButton";
