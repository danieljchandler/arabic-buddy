import { Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface HomeButtonProps {
  className?: string;
}

/**
 * HomeButton - Minimal navigation back to home
 * 
 * Clean, understated design that doesn't distract from learning.
 */
export const HomeButton = ({ className }: HomeButtonProps) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/")}
      className={cn(
        "w-11 h-11 rounded-xl",
        "flex items-center justify-center",
        "bg-card/80 border border-border",
        "transition-all duration-200",
        "hover:bg-card hover:border-primary/20 active:scale-95",
        "focus:outline-none focus:ring-2 focus:ring-primary/30",
        className
      )}
      aria-label="Go home"
    >
      <Home className="w-5 h-5 text-muted-foreground" />
    </button>
  );
};
