import { PAGE_HINTS } from "@/lib/pageHints";
import {
  CHAT_BUDGET,
  clampPageContext,
  serializePageContext,
  type PageContextDocument,
  type PageContextLine,
  type PageContextMeta,
  type PageContextPayload,
  type PageContextPosition,
} from "../../supabase/functions/_shared/pageContextCore";

export type {
  PageContextDocument,
  PageContextLine,
  PageContextMeta,
  PageContextPosition,
} from "../../supabase/functions/_shared/pageContextCore";

/**
 * What a page tells the AI assistant about itself. Pages register this via
 * usePageAiContext(); pages that don't get a generic description resolved
 * from PAGE_HINTS by route.
 *
 * `content` is the line in focus. `document` is what that line sits inside —
 * the rest of the transcript, the rest of the article — and is the field that
 * lets the tutor answer "what did he mean earlier?". Publishing it costs
 * nothing to fetch: pages already hold this data to render it.
 */
export interface PageAiContext {
  kind: "video" | "story" | "drill" | "word" | "phrase" | "passage" | "page";
  /** What the learner is looking at, e.g. the video or story title. */
  title: string;
  /** One or two sentences of framing (what kind of activity this is). */
  summary?: string;
  /** The material in focus — current line, selected sentence, word + gloss. */
  content?: string;
  /** The whole transcript / article / passage the focus sits inside. */
  document?: PageContextDocument;
  /** Level, dialect, vocabulary, grammar and cultural notes already on record. */
  meta?: PageContextMeta;
  /** Where in the document the learner currently is. */
  position?: PageContextPosition;
}

export type PageAiPayload = PageContextPayload & { route: string; title: string };

/** Flatten a payload into the plain-text context block the voice session takes. */
export function serializePagePayload(payload: PageAiPayload): string {
  // Route is for the server's logs and the chat function's own framing; a voice
  // tutor reading "/discover/abc-123" aloud helps nobody.
  const { route: _route, ...rest } = payload;
  return serializePageContext(rest);
}

/**
 * Route-prefix → PAGE_HINTS key. PAGE_HINTS keys are slugs, not paths, so the
 * mapping has to be explicit. Longest prefix wins (checked in order).
 */
const ROUTE_HINTS: Array<[prefix: string, hintKey: string]> = [
  ["/review/my-words", "mywords-review"],
  ["/review/my-phrases", "my-phrases"],
  ["/review", "review"],
  ["/my-words", "my-words"],
  ["/translate", "translate"],
  ["/transcribe", "transcribe"],
  ["/my-transcriptions", "my-transcriptions"],
  ["/tutor-upload", "tutor-upload"],
  ["/meme", "meme"],
  ["/share", "share"],
  ["/share-target", "share"],
  ["/discover", "discover"],
  ["/learn-from-x", "learn-from-x"],
  ["/how-do-i-say", "how-do-i-say"],
  ["/culture-guide", "culture-guide"],
  ["/pricing", "pricing"],
  ["/pronunciation", "pronunciation"],
  ["/conversation", "conversation"],
  ["/dialect-compare", "dialect-compare"],
  ["/listening", "listening-practice"],
  ["/listen", "listening-practice"],
  ["/leaderboard", "leaderboard"],
  ["/reading-library", "reading-practice"],
  ["/reading", "reading-practice"],
  ["/daily-challenge", "daily-challenge"],
  ["/analytics", "learning-analytics"],
  ["/grammar", "grammar-drills"],
  ["/vocab-games", "vocab-games"],
  ["/battles", "vocab-battles"],
  ["/settings", "settings"],
  ["/friends", "friends"],
  ["/liked-videos", "liked-videos"],
  ["/today/story", "stories"],
  ["/stories", "stories"],
  ["/souq-news", "souq-news"],
  ["/placement", "placement-quiz"],
  ["/bible/lessons", "bible-lessons"],
  ["/bible", "bible-reading"],
  ["/set-phrases", "set-phrases"],
  ["/onboarding", "onboarding"],
  ["/", "today"],
];

export function hintKeyForPath(pathname: string): string | null {
  for (const [prefix, key] of ROUTE_HINTS) {
    if (prefix === "/") {
      if (pathname === "/") return key;
      continue;
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/**
 * Resolve what to tell the assistant about the current page: the registered
 * context when the page published one, otherwise the PAGE_HINTS blurb for the
 * route.
 *
 * Clamped here so an oversized document never leaves the browser, and clamped
 * again server-side because this side is not a trust boundary.
 */
export function buildPagePayload(
  pathname: string,
  registered: PageAiContext | null,
): PageAiPayload {
  if (registered) {
    const clamped = clampPageContext(
      {
        route: pathname,
        title: registered.title,
        summary: registered.summary,
        content: registered.content,
        document: registered.document,
        meta: registered.meta,
        position: registered.position,
      },
      CHAT_BUDGET,
    );
    return { ...clamped, route: pathname, title: clamped.title ?? "" };
  }
  const key = hintKeyForPath(pathname);
  const hint = key ? PAGE_HINTS[key] : undefined;
  const clamped = clampPageContext(
    { route: pathname, title: hint?.title ?? "Hakiya", summary: hint?.body },
    CHAT_BUDGET,
  );
  return { ...clamped, route: pathname, title: clamped.title ?? "Hakiya" };
}
