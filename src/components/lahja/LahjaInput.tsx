import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface LahjaInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const LahjaInput = forwardRef<HTMLInputElement, LahjaInputProps>(
  ({ className, label, id, ...props }, ref) => {
    const inputElement = (
      <input
        ref={ref}
        id={id}
        className={cn(
          "h-11 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground shadow-xs",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-55",
          className,
        )}
        {...props}
      />
    );

    if (!label) {
      return inputElement;
    }

    return (
      <label htmlFor={id} className="block space-y-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {inputElement}
      </label>
    );
  },
);

LahjaInput.displayName = "LahjaInput";
