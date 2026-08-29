import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Compass, Eye, User } from "lucide-react";
import { SettingsGroupNav } from "./SettingsGroupNav";
import type { SettingsGroupMeta } from "./SettingsGroup";

const GROUPS: SettingsGroupMeta[] = [
  { id: "account", label: "Account", icon: User, blurb: "" },
  { id: "learning", label: "Learning", icon: Compass, blurb: "" },
  { id: "privacy", label: "Privacy", icon: Eye, blurb: "" },
];

/**
 * A stand-in for the real observer that hands the test the callback.
 *
 * The default stub in src/test/setup.ts never fires, which is right for the
 * dozens of components that only construct one — but the whole of this
 * component's logic lives in that callback, so exercising it needs an observer
 * that can be driven.
 */
const installObserver = () => {
  const observed: Element[] = [];
  let fire: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null = null;

  class Driveable {
    constructor(cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
      fire = cb;
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {
      observed.length = 0;
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Driveable);

  return {
    observed,
    /** Report the groups now inside the reading band, by id. */
    inBand(...ids: string[]) {
      act(() => {
        fire?.(
          observed.map((target) => ({ target, isIntersecting: ids.includes(target.id) })),
        );
      });
    },
  };
};

/** The groups have to exist in the document for the observer to find them. */
const renderWithAnchors = () => {
  const result = render(
    <>
      <SettingsGroupNav groups={GROUPS} />
      {GROUPS.map((g) => (
        <div key={g.id} id={g.id} />
      ))}
    </>,
  );
  return result;
};

const railLink = (label: string) =>
  // Rendered twice — chips below lg, rail from lg — and jsdom applies no
  // media queries, so both are present here. They carry the same state.
  screen.getAllByRole("link", { name: label });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsGroupNav", () => {
  it("links to every group by anchor", () => {
    installObserver();
    renderWithAnchors();

    for (const group of GROUPS) {
      const links = railLink(group.label);
      expect(links).toHaveLength(2);
      for (const link of links) expect(link).toHaveAttribute("href", `#${group.id}`);
    }
  });

  it("observes each group that is actually on the page", () => {
    const observer = installObserver();
    renderWithAnchors();

    expect(observer.observed.map((el) => el.id)).toEqual(["account", "learning", "privacy"]);
  });

  it("marks nothing as current until the observer has reported", () => {
    installObserver();
    renderWithAnchors();

    expect(screen.queryAllByRole("link", { current: true })).toHaveLength(0);
  });

  it("follows the reader down the page", () => {
    const observer = installObserver();
    renderWithAnchors();

    observer.inBand("learning");
    for (const link of railLink("Learning")) expect(link).toHaveAttribute("aria-current", "true");
    for (const link of railLink("Account")) expect(link).not.toHaveAttribute("aria-current");
  });

  it("picks the topmost group when several are in the band at once", () => {
    const observer = installObserver();
    renderWithAnchors();

    // Two short groups can share the band. Answering with whichever entry the
    // observer happened to list first makes the highlight jump around while
    // the page is standing still.
    observer.inBand("learning", "privacy");
    for (const link of railLink("Learning")) expect(link).toHaveAttribute("aria-current", "true");
    for (const link of railLink("Privacy")) expect(link).not.toHaveAttribute("aria-current");
  });

  it("holds the last answer while a tall group fills the whole band", () => {
    const observer = installObserver();
    renderWithAnchors();

    observer.inBand("privacy");
    observer.inBand();

    // Mid-scroll through a group taller than the band, nothing intersects.
    // Blanking the rail there would flicker it off on every long section.
    for (const link of railLink("Privacy")) expect(link).toHaveAttribute("aria-current", "true");
  });

  it("still renders where there is no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    renderWithAnchors();

    // Degrades to a plain list of anchors rather than throwing on mount: the
    // links work without the highlight, and the highlight is the garnish.
    expect(railLink("Account")[0]).toHaveAttribute("href", "#account");
  });
});
