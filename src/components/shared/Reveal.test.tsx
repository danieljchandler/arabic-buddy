import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { Reveal } from "./Reveal";

/**
 * What matters about Reveal is not that it animates — it is that it can never
 * swallow the content it wraps.
 *
 * It sits on the landing page, the one screen a stranger judges the product
 * by, and its pre-reveal state is `opacity-0`. So every path that could leave
 * it stuck there is worth pinning: no IntersectionObserver (jsdom, older
 * browsers), reduced motion, and an observer that never fires. The first two
 * must resolve to visible; the third is the reason the component fails open
 * rather than waiting.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

const render = (ui: React.ReactNode) => {
  const harness = renderWithProviders(<>{ui}</>, { route: "/" });
  cleanup = harness.cleanup;
};

/** The wrapper carries the flag; the child is what must survive. */
const wrapper = () => screen.getByText("payload").parentElement!;

describe("Reveal", () => {
  it("shows its content when there is no IntersectionObserver", () => {
    // The older-browser case. The suite's environment provides one, so it has
    // to be taken away deliberately rather than assumed absent.
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    render(<Reveal><p>payload</p></Reveal>);

    expect(screen.getByText("payload")).toBeInTheDocument();
    expect(wrapper()).toHaveAttribute("data-revealed", "true");
    expect(wrapper().className).toContain("opacity-100");
  });

  it("shows its content immediately under reduced motion", () => {
    // Present but irrelevant: reduced motion is checked first, so this must
    // never be constructed.
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observe;
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    render(<Reveal><p>payload</p></Reveal>);

    expect(wrapper()).toHaveAttribute("data-revealed", "true");
    expect(observe).not.toHaveBeenCalled();
  });

  it("reveals once and then stops watching", () => {
    let fire: ((entries: unknown[]) => void) | undefined;
    const unobserve = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: unknown[]) => void) {
          fire = cb;
        }
        observe = vi.fn();
        unobserve = unobserve;
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );

    render(<Reveal><p>payload</p></Reveal>);

    // Before it scrolls into view it is transparent — but it is in the DOM,
    // so a crawler and a screen reader both still have it.
    expect(wrapper()).toHaveAttribute("data-revealed", "false");
    expect(screen.getByText("payload")).toBeInTheDocument();

    const target = wrapper();
    act(() => fire!([{ isIntersecting: true, target }]));

    expect(wrapper()).toHaveAttribute("data-revealed", "true");
    // Re-fading every time you scroll past reads as a glitch, so the observer
    // lets go of the element the first time it lands.
    expect(unobserve).toHaveBeenCalledWith(target);
  });
});
