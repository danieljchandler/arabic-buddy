import { describe, expect, it } from "vitest";
import {
  isTextEntry,
  resolveShortcut,
  SHORTCUTS,
  shortcutGroups,
  type KeyEventLike,
} from "./transcriptShortcuts";

/**
 * The editor's key map.
 *
 * The distinction that carries the whole thing is bare keys versus chorded
 * ones. A reviewer types Arabic into these boxes all day, so a bare `m` inside
 * a textarea has to be the letter م and nothing else — while ⌘Z has to keep
 * working wherever the caret is, because the moment you need undo is the moment
 * you are mid-edit.
 */

const press = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, ...mods });
const idle = { editing: false };
const typing = { editing: true };

describe("navigation", () => {
  it("moves down on j and on the down arrow", () => {
    expect(resolveShortcut(press("j"), idle)).toBe("next-line");
    expect(resolveShortcut(press("ArrowDown"), idle)).toBe("next-line");
  });

  it("moves up on k and on the up arrow", () => {
    expect(resolveShortcut(press("k"), idle)).toBe("prev-line");
    expect(resolveShortcut(press("ArrowUp"), idle)).toBe("prev-line");
  });

  it("leaves the arrows alone inside a text box, where they move the caret", () => {
    expect(resolveShortcut(press("ArrowDown"), typing)).toBeNull();
    expect(resolveShortcut(press("ArrowUp"), typing)).toBeNull();
  });
});

describe("listening", () => {
  it("plays the line on space", () => {
    expect(resolveShortcut(press(" "), idle)).toBe("play-line");
  });

  it("plays it slowly on shift-space", () => {
    expect(resolveShortcut(press(" ", { shiftKey: true }), idle)).toBe("play-line-slow");
  });

  it("does not steal space from a text box", () => {
    expect(resolveShortcut(press(" "), typing)).toBeNull();
  });

  it("toggles looping on l", () => {
    expect(resolveShortcut(press("l"), idle)).toBe("toggle-loop");
  });
});

describe("editing", () => {
  it("opens the editor on enter, and splits on enter once open", () => {
    expect(resolveShortcut(press("Enter"), idle)).toBe("edit-line");
    expect(resolveShortcut(press("Enter"), typing)).toBe("split-here");
  });

  it("merges down on m and up on shift-m", () => {
    expect(resolveShortcut(press("m"), idle)).toBe("merge-next");
    expect(resolveShortcut(press("M", { shiftKey: true }), idle)).toBe("merge-prev");
  });

  it("lets m be the letter m when the caret is in a box", () => {
    expect(resolveShortcut(press("m"), typing)).toBeNull();
    expect(resolveShortcut(press("M", { shiftKey: true }), typing)).toBeNull();
  });
});

describe("chords", () => {
  it("undoes on cmd-z and on ctrl-z", () => {
    expect(resolveShortcut(press("z", { metaKey: true }), idle)).toBe("undo");
    expect(resolveShortcut(press("z", { ctrlKey: true }), idle)).toBe("undo");
  });

  it("redoes on shift-cmd-z", () => {
    expect(resolveShortcut(press("z", { metaKey: true, shiftKey: true }), idle)).toBe("redo");
  });

  it("keeps undo and save working with the caret in a text box", () => {
    expect(resolveShortcut(press("z", { metaKey: true }), typing)).toBe("undo");
    expect(resolveShortcut(press("s", { metaKey: true }), typing)).toBe("save");
  });

  it("accepts the capitalised key a shifted chord reports", () => {
    // Browsers report `Z`, not `z`, when shift is held.
    expect(resolveShortcut(press("Z", { metaKey: true, shiftKey: true }), idle)).toBe("redo");
  });

  it("ignores a modifier combination the editor does not claim", () => {
    expect(resolveShortcut(press("m", { metaKey: true }), idle)).toBeNull();
    expect(resolveShortcut(press("j", { altKey: true }), idle)).toBeNull();
  });
});

describe("review actions", () => {
  it("maps the review keys", () => {
    expect(resolveShortcut(press("r"), idle)).toBe("toggle-reviewed");
    expect(resolveShortcut(press("t"), idle)).toBe("retranslate");
    expect(resolveShortcut(press("c"), idle)).toBe("comment");
    expect(resolveShortcut(press("?"), idle)).toBe("help");
  });

  it("keeps all of them out of a text box", () => {
    for (const key of ["r", "t", "c", "?"]) {
      expect(resolveShortcut(press(key), typing)).toBeNull();
    }
  });
});

describe("timing nudges", () => {
  it("maps the four bracket keys", () => {
    expect(resolveShortcut(press("["), idle)).toBe("nudge-start-earlier");
    expect(resolveShortcut(press("]"), idle)).toBe("nudge-start-later");
    expect(resolveShortcut(press("{"), idle)).toBe("nudge-end-earlier");
    expect(resolveShortcut(press("}"), idle)).toBe("nudge-end-later");
  });

  it("lets braces be punctuation inside a text box", () => {
    expect(resolveShortcut(press("{"), typing)).toBeNull();
  });
});

describe("unclaimed keys", () => {
  it("returns null so the browser keeps them", () => {
    for (const key of ["a", "Tab", "F5", "Escape", "1"]) {
      expect(resolveShortcut(press(key), idle)).toBeNull();
    }
  });
});

describe("isTextEntry", () => {
  it("recognises the three form elements", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isTextEntry(document.createElement(tag))).toBe(true);
    }
  });

  it("recognises a contenteditable element", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTextEntry(div)).toBe(true);
  });

  it("says no to an ordinary element and to nothing at all", () => {
    expect(isTextEntry(document.createElement("div"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("the help panel", () => {
  it("documents every action the resolver can return", () => {
    // The panel is generated from this table, so an undocumented shortcut is a
    // shortcut nobody will ever find.
    const documented = new Set(SHORTCUTS.map((s) => s.action));
    const reachable = new Set(
      [
        ...["j", "k", "l", "m", "M", "r", "t", "c", "?", "[", "]", "{", "}", " ", "Enter"].map((key) =>
          resolveShortcut(press(key, { shiftKey: key === "M" }), idle),
        ),
        resolveShortcut(press("Enter"), typing),
        resolveShortcut(press("z", { metaKey: true }), idle),
        resolveShortcut(press("z", { metaKey: true, shiftKey: true }), idle),
        resolveShortcut(press("s", { metaKey: true }), idle),
      ].filter(Boolean),
    );

    expect([...reachable].filter((action) => !documented.has(action!))).toEqual([]);
  });

  it("groups every row", () => {
    const grouped = shortcutGroups().flatMap((g) => g.items);
    expect(grouped).toHaveLength(SHORTCUTS.length);
  });

  it("puts navigation first, because that is where a reviewer starts", () => {
    expect(shortcutGroups()[0].group).toBe("Navigate");
  });
});
