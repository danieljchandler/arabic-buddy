import { useEffect } from "react";

/**
 * Set the document title for a route. Resets to the base title on unmount.
 *
 * Usage: useDocumentTitle("My Words")
 *   → document.title = "My Words — Lahja"
 */
const BASE = "Lahja — Learn Spoken Arabic";

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const next = title?.trim() ? `${title} — Lahja` : BASE;
    const prev = document.title;
    document.title = next;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
