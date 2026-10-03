import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setBrandPreview, setMarkVariant } from "@/lib/brandPreview";
import { HikayaInkMark } from "./HikayaInkMark";
import { INK_MARK_ART } from "./inkMarkArt";

/**
 * The Ink mark, drawn from the production logo set in src/assets/brand.
 *
 * Pinned: one accessible name for the whole mark in either theme; the sadu
 * mark as the default (the owner's primary) with clean as the secondary and
 * `?mark=` choosing between them; vowelled unless asked otherwise; the
 * lockup when the wordmark is wanted; the same artwork at every size; and,
 * read off disk, that the files really are the self-contained outlined art
 * the component's doc promises — no live text, no fonts, no scripts.
 */

afterEach(() => {
  act(() => setBrandPreview(null));
  localStorage.clear();
});

const images = (container: HTMLElement) => [...container.querySelectorAll("img")];
const srcs = (container: HTMLElement) => images(container).map((img) => img.getAttribute("src"));

describe("HikayaInkMark", () => {
  it("is one accessible image named Hikaya, whichever theme is showing", () => {
    const { container } = render(<HikayaInkMark />);
    const mark = screen.getByRole("img", { name: "Hikaya" });
    expect(screen.getAllByRole("img")).toHaveLength(1);
    // Two files inside — light and night — both decorative.
    const [light, reverse] = images(container);
    for (const img of [light, reverse]) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
      expect(img).toHaveAttribute("draggable", "false");
    }
    // The night file shows only under .dark, the day file only outside it.
    expect(light.className).toContain("dark:hidden");
    expect(reverse.className).toContain("hidden");
    expect(reverse.className).toContain("dark:block");
    expect(mark).toHaveAttribute("data-ink-mark-kind", "mark");
  });

  it("is the vowelled sadu mark by default — the owner's primary", () => {
    const { container } = render(<HikayaInkMark />);
    expect(screen.getByRole("img")).toHaveAttribute("data-ink-mark", "sadu");
    expect(srcs(container)).toEqual([
      INK_MARK_ART.sadu.harakat.mark.light,
      INK_MARK_ART.sadu.harakat.mark.reverse,
    ]);
    expect(srcs(container)[0]).toMatch(/hikaya-sadu-harakat-mark/);
    expect(srcs(container)[1]).toMatch(/hikaya-sadu-harakat-mark-reverse/);
  });

  it("draws the clean secondary, the unvowelled name and the lockup on request", () => {
    const { container, rerender } = render(<HikayaInkMark variant="clean" />);
    expect(srcs(container)[0]).toMatch(/hikaya-clean-harakat-mark/);

    rerender(<HikayaInkMark variant="clean" harakat={false} />);
    expect(srcs(container)[0]).toMatch(/hikaya-clean-plain-mark/);

    rerender(<HikayaInkMark harakat={false} wordmark />);
    expect(srcs(container)).toEqual([
      INK_MARK_ART.sadu.plain.lockup.light,
      INK_MARK_ART.sadu.plain.lockup.reverse,
    ]);
    expect(screen.getByRole("img")).toHaveAttribute("data-ink-mark-kind", "lockup");
  });

  it("follows ?mark= when no variant is passed, live", () => {
    act(() => setBrandPreview("ink"));
    const { container } = render(<HikayaInkMark />);
    expect(screen.getByRole("img")).toHaveAttribute("data-ink-mark", "sadu");

    act(() => setMarkVariant("clean"));
    expect(screen.getByRole("img")).toHaveAttribute("data-ink-mark", "clean");
    expect(srcs(container)[0]).toBe(INK_MARK_ART.clean.harakat.mark.light);

    // An explicit variant beats the URL choice.
    const explicit = render(<HikayaInkMark variant="sadu" />);
    expect(explicit.container.querySelector("[data-ink-mark]")).toHaveAttribute("data-ink-mark", "sadu");
  });

  it("sizes by height and keeps each artboard's proportions", () => {
    const { container, rerender } = render(<HikayaInkMark size={48} className="mx-auto" />);
    const [img] = images(container);
    expect(img).toHaveAttribute("height", "48");
    expect(img).toHaveAttribute("width", "146"); // 272.96 × 90
    expect(screen.getByRole("img").className).toContain("mx-auto");

    rerender(<HikayaInkMark size={100} wordmark />);
    expect(images(container)[0]).toHaveAttribute("width", "251"); // 251.84 × 100.22
  });

  it("is the same artwork at every size", () => {
    const at = (size: number) => {
      const { container, unmount } = render(<HikayaInkMark size={size} />);
      const out = srcs(container);
      unmount();
      return out;
    };
    expect(at(24)).toEqual(at(160));
  });
});

/**
 * The files themselves. A logo that fetches a font, carries a script or
 * leaks an id into a page that inlines two of them is a logo that breaks
 * somewhere other than here.
 */
describe("the logo set it draws from", () => {
  const dir = join(process.cwd(), "src", "assets", "brand");
  const files = Object.values(INK_MARK_ART).flatMap((byVowels) =>
    Object.values(byVowels).flatMap((byKind) =>
      Object.values(byKind).flatMap((art) => [art.light, art.reverse]),
    ),
  );
  const name = (src: string) => src.match(/hikaya-[a-z-]+\.svg/)![0];

  it("is sixteen distinct files: two variants × vowelled or not × mark or lockup × day or night", () => {
    expect(new Set(files.map(name)).size).toBe(16);
  });

  it("is outlined, self-contained artwork with the name in its title", () => {
    for (const file of new Set(files.map(name))) {
      const svg = readFileSync(join(dir, file), "utf8");
      expect(svg, file).toMatch(/<title>Hikaya<\/title>/);
      expect(svg, file).not.toMatch(/<text|<style|<script|@font-face|https?:\/\/(?!www\.w3\.org)/);
      // Ids are prefixed with the file's own name, so two can share a page.
      for (const [, id] of svg.matchAll(/\sid="([^"]+)"/g)) {
        expect(id.startsWith(file.replace(/\.svg$/, "")), `${file}: ${id}`).toBe(true);
      }
    }
  });

  it("carries the weave only in the sadu files", () => {
    for (const file of new Set(files.map(name))) {
      const svg = readFileSync(join(dir, file), "utf8");
      expect(svg.includes("clipPath"), file).toBe(file.includes("-sadu-"));
    }
  });
});
