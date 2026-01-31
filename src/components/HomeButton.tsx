import { Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export const HomeButton = () => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/")}
      className={cn(
        "w-14 h-14 rounded-2xl",
        "flex items-center justify-center",
        "bg-card border border-border shadow-card",
        "transition-all duration-300",
        "hover:scale-105 hover:border-primary/30 active:scale-95",
        "focus:outline-none focus:ring-4 focus:ring-primary/50"
      )}
    >
      <Home className="w-7 h-7 text-foreground" />
    </button>
  );
};
