import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CelebrationBadge } from "@/lib/celebrations";
import { badgeArtFor } from "@/components/gamification/badgeArt";
import { BadgeName, BadgeSticker } from "./BadgeSticker";

/**
 * The badge a celebration is for. What matters is that it is the badge the
 * learner sees in their grid (the same emblem), that a badge with no artwork
 * yet still gets a sticker, and that nothing here is read out twice (the
 * dialog already names the badge).
 */

const badge = (over: Partial<CelebrationBadge> = {}): CelebrationBadge => ({
  id: "5b1e7a52-0d0c-4a55-9a43-9a0c3b2f6e11",
  name: "On Fire",
  nameArabic: "مشتعل",
  icon: "🔥",
  xp: 50,
  ...over,
});

describe("BadgeSticker", () => {
  it("shows the badge's own emblem, the one the achievements grid shows", () => {
    render(<BadgeSticker badge={badge()} />);
    const art = screen.getByTestId("celebration-badge-art");
    expect(art).toHaveAttribute("src", badgeArtFor("🔥"));
    expect(screen.queryByTestId("celebration-badge-emoji")).toBeNull();
  });

  it("shows a different emblem for a different badge", () => {
    render(<BadgeSticker badge={badge({ icon: "🏆" })} />);
    expect(screen.getByTestId("celebration-badge-art")).toHaveAttribute("src", badgeArtFor("🏆"));
    expect(badgeArtFor("🏆")).not.toBe(badgeArtFor("🔥"));
  });

  it("falls back to the emoji on a disc for a badge with no artwork, so a new badge never waits for art", () => {
    render(<BadgeSticker badge={badge({ icon: "🧭" })} />);
    expect(badgeArtFor("🧭")).toBeUndefined();
    expect(screen.getByTestId("celebration-badge-emoji")).toHaveTextContent("🧭");
    expect(screen.queryByTestId("celebration-badge-art")).toBeNull();
  });

  it("says what the badge was worth", () => {
    render(<BadgeSticker badge={badge({ xp: 120 })} />);
    expect(screen.getByText("+120 XP")).toBeInTheDocument();
  });

  it("is decoration, since the dialog already names the badge", () => {
    render(<BadgeSticker badge={badge()} />);
    expect(screen.getByTestId("celebration-badge")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("celebration-badge-art")).toHaveAttribute("alt", "");
  });
});

describe("BadgeName", () => {
  it("is the badge's name in Arabic, marked as Arabic", () => {
    render(<BadgeName badge={badge()} />);
    const name = screen.getByTestId("celebration-badge-name");
    expect(name).toHaveTextContent("مشتعل");
    expect(name).toHaveAttribute("lang", "ar");
    expect(name).toHaveAttribute("dir", "rtl");
  });

  it("is nothing for a badge with no Arabic name", () => {
    const { container } = render(<BadgeName badge={badge({ nameArabic: "" })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
