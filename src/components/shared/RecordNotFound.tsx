import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

/**
 * What a page that opens one record says when the id names nothing.
 *
 * The third of the "no data" states, beside EmptyState ("nothing here yet")
 * and QueryErrorState ("we could not find out"): the lookup worked and the row
 * is not there. The 2026-09-29 QA sweep found eight id routes that skipped this
 * check and rendered their page anyway — an empty edit form that saved into a
 * row that did not exist, or a story player titled with nothing — so each of
 * them now bails to this after its spinner, with a way back to the list the id
 * would have come from.
 */
export interface RecordNotFoundProps {
  /** "Video not found", "Story not found". */
  title: string;
  /** One line on why, e.g. "It may have been deleted." */
  body?: string;
  /** The list this record would have been opened from. */
  backTo: string;
  backLabel: string;
  /**
   * `screen` centres it on a bare full-height page, for the admin forms that
   * render outside the app shell; `page` is for inside one.
   */
  layout?: "page" | "screen";
  className?: string;
}

export function RecordNotFound({ title, body, backTo, backLabel, layout = "page", className }: RecordNotFoundProps) {
  const state = (
    <EmptyState
      art="no-results"
      title={title}
      body={body}
      className={cn(layout === "page" && "py-16", className)}
      action={
        <Button asChild variant="outline">
          <Link to={backTo}>{backLabel}</Link>
        </Button>
      }
    />
  );
  if (layout === "page") return state;
  return <div className="min-h-screen bg-background flex items-center justify-center">{state}</div>;
}
