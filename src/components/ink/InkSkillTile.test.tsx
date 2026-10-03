import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SKILLS } from "@/lib/surfaces";
import { InkSkillTile } from "./InkSkillTile";

/**
 * The chooser's four skill tiles in Ink: type instead of watercolour.
 *
 * What the default tile guarantees has to survive the swap — the link
 * target, the visible English label e2e/choose.spec finds the tile by, and an
 * accessible name of label plus plain Arabic — while the stretched display
 * word, a drawing of the word, stays out of the accessibility tree.
 */
const renderTiles = () =>
  render(
    <MemoryRouter>
      <div>
        {SKILLS.map((s, i) => (
          <InkSkillTile key={s.id} skill={s} index={i} />
        ))}
      </div>
    </MemoryRouter>,
  );

describe("InkSkillTile", () => {
  it("keeps each skill's link, label and plain Arabic name", () => {
    renderTiles();
    for (const skill of SKILLS) {
      const link = screen.getByRole("link", { name: new RegExp(skill.label) });
      expect(link).toHaveAttribute("href", skill.to);
      expect(within(link).getByText(skill.label)).toBeVisible();
      // The plain spelling is what a screen reader hears…
      expect(within(link).getByText(skill.arabic)).toHaveClass("sr-only");
      // …and the kashida display word is drawn, hidden.
      const display = within(link).getByText(skill.arabicDisplay);
      expect(display).toHaveAttribute("aria-hidden", "true");
      expect(display).toHaveClass("font-ink-display");
      expect(display.textContent).toContain("ـ");
    }
  });

  it("numbers the tiles 01–04 and gives neighbours different grounds", () => {
    const { container } = renderTiles();
    const tiles = [...container.querySelectorAll("a")];
    expect(tiles.map((t) => t.getAttribute("data-ink-tile"))).toEqual(["ink", "paper", "oxblood", "paper-2"]);
    tiles.forEach((tile, i) => {
      expect(tile).toHaveTextContent(`0${i + 1}`);
    });
  });

  it("presses sadu into the dark tiles' panels only", () => {
    const { container } = renderTiles();
    const [listen, read, speak, write] = [...container.querySelectorAll("a")];
    expect(listen.querySelectorAll("[data-ink-sadu]")).toHaveLength(1);
    expect(speak.querySelectorAll("[data-ink-sadu]")).toHaveLength(1);
    // Never on the paper grounds.
    expect(read.querySelector("[data-ink-sadu]")).toBeNull();
    expect(write.querySelector("[data-ink-sadu]")).toBeNull();
  });

  it("draws each skill's own motif", () => {
    const { container } = renderTiles();
    const [listen, read, speak, write] = [...container.querySelectorAll("a")];
    // Listening hears a whole phrase.
    expect(listen.querySelector("[data-ink-waveform]")).not.toBeNull();
    // Reading: lines of text, one under the mustard highlighter.
    expect(read.querySelector(".bg-\\[\\#E2B65C\\]")).not.toBeNull();
    // Speaking: one strong bar and a voice trailing off.
    expect(speak.querySelectorAll("i")).toHaveLength(4);
    // Writing: a pen line, and the giant ك drawn as artwork, not text.
    expect(write.querySelector("text")?.textContent).toBe("ك");
    expect(write.querySelector("circle")).not.toBeNull();
  });

  it("wraps the ground cycle past four", () => {
    render(
      <MemoryRouter>
        <InkSkillTile skill={SKILLS[0]} index={4} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("data-ink-tile", "ink");
    expect(link).toHaveTextContent("05");
  });
});
