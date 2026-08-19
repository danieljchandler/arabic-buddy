import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VideoThumbnail } from "./VideoThumbnail";

/**
 * The still on a video card.
 *
 * The size that always exists on YouTube is `hqdefault` — 480x360, with the
 * widescreen frame letterboxed into 4:3 — and rendering it on a card two to
 * four times that wide is what made the library look cheap. This asks for
 * `maxresdefault` first and steps down, because that size is only generated
 * for some videos; the stepping is the whole reason this is a component and
 * not a string helper.
 */

const ID = "dQw4w9WgXcQ";
const stored = `https://img.youtube.com/vi/${ID}/hqdefault.jpg`;

const still = () => screen.getByRole("img") as HTMLImageElement;

/** jsdom never loads anything, so a size has to be dictated to it. */
function loadAt(image: HTMLImageElement, naturalWidth: number) {
  Object.defineProperty(image, "naturalWidth", { value: naturalWidth, configurable: true });
  fireEvent.load(image);
}

describe("VideoThumbnail", () => {
  it("asks for the full-resolution still, not the one that was stored", () => {
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" />);
    expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  });

  it("steps down when a video has no full-resolution still", () => {
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" />);
    fireEvent.error(still());
    expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/sddefault.jpg`);

    fireEvent.error(still());
    expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });

  it("steps past the grey placeholder YouTube serves with a 200", () => {
    // A missing size is usually a 404, but not always: sometimes it is a
    // 120x90 grey card, which would otherwise sit there looking like content.
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" />);
    loadAt(still(), 120);
    expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/sddefault.jpg`);
  });

  it("keeps a still that actually loaded", () => {
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" />);
    loadAt(still(), 1280);
    expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  });

  it("renders a still it cannot rewrite as-is", () => {
    // A TikTok or Instagram URL is signed; there is no bigger one to guess at.
    const tiktok = "https://p16-sign.tiktokcdn.com/obj/abc~tplv.jpeg";
    render(<VideoThumbnail src={tiktok} alt="Meme" />);
    expect(still().src).toBe(tiktok);
  });

  /**
   * The retroactive half: a row whose `thumbnail_url` was never filled in
   * still has the video id on it, and a YouTube still is a pure function of
   * that. Nothing is written to the database to make these appear.
   */
  describe("a video with no stored still", () => {
    it("derives one from the row's source URL", () => {
      render(
        <VideoThumbnail
          src={null}
          sources={{ source_url: `https://www.youtube.com/shorts/${ID}` }}
          alt="Ordering coffee in Doha"
        />,
      );
      expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
    });

    it("derives one from the row's embed URL", () => {
      render(
        <VideoThumbnail
          src={null}
          sources={{ embed_url: `https://www.youtube-nocookie.com/embed/${ID}?rel=0` }}
          alt="Ordering coffee in Doha"
        />,
      );
      expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
    });

    it("steps down a derived still the same way", () => {
      render(
        <VideoThumbnail src={null} sources={{ source_url: `https://youtu.be/${ID}` }} alt="X" />,
      );
      fireEvent.error(still());
      expect(still().src).toBe(`https://i.ytimg.com/vi/${ID}/sddefault.jpg`);
    });

    it("shows the fallback for a platform whose stills cannot be derived", () => {
      render(
        <VideoThumbnail
          src={null}
          sources={{ source_url: "https://www.instagram.com/reel/CxYzAbCdEfG/" }}
          alt="Meme"
          fallback={<div data-testid="empty" />}
        />,
      );
      expect(screen.getByTestId("empty")).toBeInTheDocument();
    });
  });

  it("shows the fallback when there is no still at all", () => {
    render(<VideoThumbnail src={null} alt="Meme" fallback={<div data-testid="empty" />} />);
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the fallback once every size has failed", () => {
    render(<VideoThumbnail src={stored} alt="Meme" fallback={<div data-testid="empty" />} />);
    fireEvent.error(still());
    fireEvent.error(still());
    fireEvent.error(still());
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("names the still by the video, for the grid to be navigable by ear", () => {
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" />);
    expect(still()).toHaveAttribute("alt", "Ordering coffee in Doha");
  });

  it("hides a decorative still, where the title is already spoken alongside", () => {
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" decorative />);
    const image = document.querySelector("img");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
  });

  it("defers off-screen stills so a long grid does not fetch all of them", () => {
    render(<VideoThumbnail src={stored} alt="Ordering coffee in Doha" />);
    expect(still()).toHaveAttribute("loading", "lazy");
  });

  it("starts the ladder again when a card is reused for another video", () => {
    // The feed recycles cards as it scrolls; inheriting the previous video's
    // position in the ladder would pin the new one to a smaller still.
    const other = "kJQP7kiw5Fk";
    const { rerender } = render(<VideoThumbnail src={stored} alt="First" />);
    fireEvent.error(still());
    expect(still().src).toContain("sddefault");

    rerender(<VideoThumbnail src={`https://img.youtube.com/vi/${other}/hqdefault.jpg`} alt="Second" />);
    expect(still().src).toBe(`https://i.ytimg.com/vi/${other}/maxresdefault.jpg`);
  });
});
