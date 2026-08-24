/**
 * The transcript editor's keyboard map, as data.
 *
 * Two things live here and they have to agree: what a keypress does, and what
 * the help panel says it does. Every transcription tool worth using is driven
 * from the keyboard — the hands-on-keys loop is play, listen, fix, tick, next —
 * and a shortcut nobody can discover is a shortcut nobody uses. Deriving the
 * panel from the same table as the resolver is what stops the two drifting.
 *
 * Pure so it can be exhaustively tested. Which keys are live depends on whether
 * the caret is in a text box, and getting that wrong is the difference between
 * "m merges two lines" and "typing م in a translation merges two lines".
 */

export type ShortcutAction =
  | "next-line"
  | "prev-line"
  | "play-line"
  | "play-line-slow"
  | "toggle-loop"
  | "edit-line"
  | "merge-next"
  | "merge-prev"
  | "split-here"
  | "toggle-reviewed"
  | "retranslate"
  | "comment"
  | "undo"
  | "redo"
  | "nudge-start-earlier"
  | "nudge-start-later"
  | "nudge-end-earlier"
  | "nudge-end-later"
  | "save"
  | "help";

export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutContext {
  /** True when the caret is in a text box, where letter keys are just letters. */
  editing: boolean;
}

export interface ShortcutSpec {
  action: ShortcutAction;
  /** Shown in the help panel. */
  keys: string;
  label: string;
  group: "Navigate" | "Listen" | "Edit" | "Review" | "Timing";
  /**
   * True when the shortcut still fires with the caret in a text box.
   *
   * Only the chorded ones may: a bare letter has to be typeable. The bracket
   * timing nudges are deliberately *not* in this set — `{` and `}` are
   * punctuation somebody may want in a translation.
   */
  whileEditing?: boolean;
}

/**
 * The canonical list. Order is the order the help panel shows them in, so it
 * runs roughly in the order a reviewer uses them.
 */
export const SHORTCUTS: readonly ShortcutSpec[] = [
  { action: "next-line", keys: "J  /  ↓", label: "Next line", group: "Navigate" },
  { action: "prev-line", keys: "K  /  ↑", label: "Previous line", group: "Navigate" },

  { action: "play-line", keys: "Space", label: "Play this line", group: "Listen" },
  { action: "play-line-slow", keys: "⇧Space", label: "Play this line slowly", group: "Listen" },
  { action: "toggle-loop", keys: "L", label: "Loop the line while it plays", group: "Listen" },

  { action: "edit-line", keys: "Enter", label: "Edit the Arabic", group: "Edit" },
  { action: "split-here", keys: "Enter", label: "Split at the caret (while editing)", group: "Edit" },
  { action: "merge-next", keys: "M", label: "Merge with the line below", group: "Edit" },
  { action: "merge-prev", keys: "⇧M", label: "Merge with the line above", group: "Edit" },
  { action: "undo", keys: "⌘Z", label: "Undo", group: "Edit", whileEditing: true },
  { action: "redo", keys: "⇧⌘Z", label: "Redo", group: "Edit", whileEditing: true },
  { action: "save", keys: "⌘S", label: "Save now", group: "Edit", whileEditing: true },

  { action: "toggle-reviewed", keys: "R", label: "Mark reviewed / un-review", group: "Review" },
  { action: "retranslate", keys: "T", label: "Re-translate this line", group: "Review" },
  { action: "comment", keys: "C", label: "Comment on this line", group: "Review" },
  { action: "help", keys: "?", label: "Show this list", group: "Review" },

  { action: "nudge-start-earlier", keys: "[", label: "Start 100 ms earlier", group: "Timing" },
  { action: "nudge-start-later", keys: "]", label: "Start 100 ms later", group: "Timing" },
  { action: "nudge-end-earlier", keys: "{", label: "End 100 ms earlier", group: "Timing" },
  { action: "nudge-end-later", keys: "}", label: "End 100 ms later", group: "Timing" },
];

/** How far one bracket press moves a boundary, in seconds. */
export const NUDGE_SECONDS = 0.1;

/**
 * Which action a keypress means, or null for a key this editor does not claim.
 *
 * Returning null rather than swallowing the event matters: the browser's own
 * shortcuts, and the caret keys inside a textarea, have to keep working.
 */
export function resolveShortcut(
  event: KeyEventLike,
  { editing }: ShortcutContext,
): ShortcutAction | null {
  const meta = Boolean(event.metaKey || event.ctrlKey);
  const shift = Boolean(event.shiftKey);
  const key = event.key;

  // ── Chorded: live everywhere, including inside a text box ────────────────
  if (meta && (key === "z" || key === "Z")) return shift ? "redo" : "undo";
  if (meta && (key === "s" || key === "S")) return "save";

  // A modifier the map does not claim belongs to the browser or the OS.
  if (meta || event.altKey) return null;

  if (key === "Enter") return editing ? "split-here" : "edit-line";

  // ── Bare keys: only outside a text box, where they are not just letters ──
  if (editing) return null;

  switch (key) {
    case " ":
      return shift ? "play-line-slow" : "play-line";
    case "j":
    case "ArrowDown":
      return "next-line";
    case "k":
    case "ArrowUp":
      return "prev-line";
    case "l":
      return "toggle-loop";
    case "m":
      return "merge-next";
    case "M":
      return "merge-prev";
    case "r":
      return "toggle-reviewed";
    case "t":
      return "retranslate";
    case "c":
      return "comment";
    case "?":
      return "help";
    case "[":
      return "nudge-start-earlier";
    case "]":
      return "nudge-start-later";
    case "{":
      return "nudge-end-earlier";
    case "}":
      return "nudge-end-later";
    default:
      return null;
  }
}

/**
 * Is the caret somewhere that letter keys have to stay letters?
 *
 * `isContentEditable` is checked as well as the tag, because the word-level
 * editor renders editable spans rather than inputs.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** The help panel's rows, grouped. */
export function shortcutGroups(): Array<{ group: ShortcutSpec["group"]; items: ShortcutSpec[] }> {
  const order: ShortcutSpec["group"][] = ["Navigate", "Listen", "Edit", "Review", "Timing"];
  return order.map((group) => ({
    group,
    items: SHORTCUTS.filter((spec) => spec.group === group),
  }));
}
