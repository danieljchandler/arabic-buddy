import { useEffect } from "react";

/**
 * Set the document title for a route. Resets to the base title on unmount.
 *
 * Usage: useDocumentTitle("My Words")
 *   → document.title = "My Words — Hikaya"
 */
const BASE = "Hikaya — Learn Spoken Arabic";
const SUFFIX = / — Hikaya$/;

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    // A caller that adds the brand itself would otherwise get it twice
    // ("Listen — Hikaya — Hikaya"), which two pages did.
    const name = title?.trim().replace(SUFFIX, "").trim();
    const next = name ? `${name} — Hikaya` : BASE;
    const prev = document.title;
    document.title = next;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
