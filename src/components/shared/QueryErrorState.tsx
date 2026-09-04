import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { describeQueryError } from "@/lib/queryErrors";
import { cn } from "@/lib/utils";

/**
 * What a screen says when its data did not arrive.
 *
 * The counterpart of EmptyState: that one is for "there is nothing here yet",
 * this one is for "we could not find out". Until the 2026-09-04 audit the
 * list pages showed the former for both, so an outage read as an empty app.
 * Wording and classification are shared with ErrorBoundary via
 * `lib/queryErrors`, so a failed fetch and a render-time crash speak alike.
 */
export interface QueryErrorStateProps {
  error: unknown;
  /** Usually the query's `refetch`. Omitted, the button reloads the page. */
  onRetry?: () => void;
  /** Overrides the classified title — e.g. "Couldn't load videos". */
  title?: string;
  className?: string;
  /** `inline` is the compact form for a section inside an otherwise fine page. */
  size?: "page" | "inline";
}

export function QueryErrorState({ error, onRetry, title, className, size = "page" }: QueryErrorStateProps) {
  const navigate = useNavigate();
  const copy = describeQueryError(error);
  const Icon = copy.kind === "network" ? WifiOff : AlertTriangle;
  const retry = () => {
    if (copy.kind === "auth") {
      navigate("/auth");
      return;
    }
    if (onRetry) onRetry();
    else window.location.reload();
  };

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "page" ? "py-12 px-4" : "py-6 px-3 rounded-xl border border-border bg-card",
        className,
      )}
    >
      <Icon className={cn("text-muted-foreground mb-3", size === "page" ? "h-10 w-10" : "h-6 w-6")} aria-hidden />
      <h2 className={cn("font-heading font-bold text-foreground mb-1.5", size === "page" ? "text-lg" : "text-base")}>
        {title ?? copy.title}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{copy.description}</p>
      <Button variant={copy.kind === "auth" ? "default" : "outline"} size="sm" className="mt-4 gap-2" onClick={retry}>
        {copy.kind !== "auth" && <RefreshCw className="h-4 w-4" aria-hidden />}
        {copy.action}
      </Button>
    </div>
  );
}
