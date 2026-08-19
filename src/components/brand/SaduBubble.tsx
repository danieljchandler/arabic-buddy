import ivory from "@/assets/sadu-bubble-ivory.png";
import terracotta from "@/assets/sadu-bubble-terracotta.png";
import olive from "@/assets/sadu-bubble-olive.png";
import charcoal from "@/assets/sadu-bubble-charcoal.png";

/**
 * A speech bubble carrying a band of Sadu weave.
 *
 * The Hakiya mark is already a speech bubble with a sadu ring, and the brand
 * film draws every line of dialogue as a bubble filled with woven pattern
 * rather than words. Speech that looks like cloth is a more particular thing
 * for a language app to own than a sparkle.
 *
 * Four fixed tones rather than an arbitrary tint: the weave has to be the fill
 * darkened — tone-on-tone is what reads as texture instead of decoration — and
 * that relationship cannot be derived from a colour at runtime, so each tone is
 * drawn as its own artwork. Ivory is the one meant to sit on a coloured ground;
 * the other three sit on sand.
 *
 * Below roughly 32px the woven band stops resolving and the bubble reads as a
 * plain silhouette. That is fine — it still reads as speech — but it is why
 * nothing here tries to carry meaning in the pattern at icon size.
 */

const ART = { ivory, terracotta, olive, charcoal } as const;

export type SaduBubbleTone = keyof typeof ART;

export interface SaduBubbleProps {
  /** Ivory for coloured grounds; the rest for the app's sand. */
  tone?: SaduBubbleTone;
  className?: string;
  /** Give it a label only where it carries meaning of its own. */
  title?: string;
}

export function SaduBubble({ tone = "terracotta", className, title }: SaduBubbleProps) {
  return (
    <img
      src={ART[tone]}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      className={className}
      draggable={false}
    />
  );
}
