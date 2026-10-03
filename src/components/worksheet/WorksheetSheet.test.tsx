import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WorksheetSheet } from "./WorksheetSheet";
import { SAMPLE_WORKSHEET } from "@/lib/worksheetSample";
import type { WorksheetSpec } from "../../../supabase/functions/_shared/worksheetCore";

/**
 * The printed worksheet. jsdom cannot lay out a page or shape Arabic, so this
 * holds the structure the print layout depends on — every Arabic block marked
 * right-to-left on the element that carries the text, numbers boxed rather
 * than written as "1.", the key on its own section — and the local Playwright
 * check (e2e/print-worksheet.spec.ts) looks at the actual pixels.
 */

const section = (kind: string) => {
  const el = document.querySelector(`section[data-kind="${kind}"]`);
  if (!el) throw new Error(`no ${kind} section`);
  return el as HTMLElement;
};

describe("WorksheetSheet", () => {
  it("renders the title, every section in order and the answer key", () => {
    render(<WorksheetSheet spec={SAMPLE_WORKSHEET} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SAMPLE_WORKSHEET.title.arabic);
    expect(screen.getByText(SAMPLE_WORKSHEET.title.english)).toBeInTheDocument();
    const kinds = [...document.querySelectorAll("section[data-kind]")].map((s) => s.getAttribute("data-kind"));
    expect(kinds).toEqual(["matching", "cloze", "dialogue", "spot_the_fusha", "writing"]);
    expect(screen.getByTestId("answer-key")).toBeInTheDocument();
  });

  it("marks every Arabic text block right-to-left and Arabic on the element itself", () => {
    render(<WorksheetSheet spec={SAMPLE_WORKSHEET} />);
    const arabicBlocks = [...document.querySelectorAll<HTMLElement>("p.ws-ar, h1.ws-ar")];
    expect(arabicBlocks.length).toBeGreaterThan(10);
    for (const el of arabicBlocks) {
      expect(el.getAttribute("dir")).toBe("rtl");
      expect(el.getAttribute("lang")).toBe("ar");
    }
  });

  it("prints each matching option once, lettered, in the shuffled order the key expects", () => {
    render(<WorksheetSheet spec={SAMPLE_WORKSHEET} />);
    const matching = SAMPLE_WORKSHEET.sections[0];
    if (matching.kind !== "matching") throw new Error("expected matching first");
    const options = [...section("matching").querySelectorAll(".ws-match-en .ws-row")].map((r) => r.textContent);
    expect(options).toEqual(matching.english_order.map((idx, k) => `${String.fromCharCode(97 + k)}${matching.pairs[idx].english}`));
  });

  it("draws one blank per gap and boxes the item numbers instead of writing '1.'", () => {
    render(<WorksheetSheet spec={SAMPLE_WORKSHEET} />);
    const cloze = section("cloze");
    expect(cloze.querySelectorAll(".ws-blank")).toHaveLength(4);
    expect([...cloze.querySelectorAll(".ws-num")].map((n) => n.textContent)).toEqual(["1", "2", "3", "4"]);
    for (const item of cloze.querySelectorAll(".ws-item")) expect(item.textContent).not.toMatch(/\d\./);
    expect(section("dialogue").querySelectorAll(".ws-blank")).toHaveLength(3);
  });

  it("rules the writing lines right-to-left", () => {
    render(<WorksheetSheet spec={SAMPLE_WORKSHEET} />);
    const lines = screen.getByTestId("writing-lines");
    expect(lines).toHaveAttribute("dir", "rtl");
    expect(lines.querySelectorAll(".ws-line")).toHaveLength(6);
  });

  it("keys 'spot the Fusha' on the detector's words", () => {
    render(<WorksheetSheet spec={SAMPLE_WORKSHEET} />);
    const key = within(screen.getByTestId("answer-key"));
    expect(key.getByText(/سوف/)).toBeInTheDocument();
    expect(key.getByText(/الذي/)).toBeInTheDocument();
    expect(key.getAllByText("✓ all dialect")).toHaveLength(2);
  });

  it("leaves out an Arabic title and prompt the assembler blanked, and a key with nothing in it", () => {
    const spec: WorksheetSpec = {
      ...SAMPLE_WORKSHEET,
      title: { arabic: "", english: "Plain" },
      sections: [{ kind: "writing", instructions: "Write.", prompt_english: "Say hello.", prompt_arabic: "", lines: 3 }],
    };
    render(<WorksheetSheet spec={spec} />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(document.querySelectorAll("p.ws-ar")).toHaveLength(0);
    expect(screen.queryByTestId("answer-key")).toBeNull();
  });
});
