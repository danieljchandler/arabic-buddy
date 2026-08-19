import { SaduBubble } from "@/components/brand/SaduBubble";
import { cn } from "@/lib/utils";

/**
 * Shown in the chat thread while the tutor is composing a reply.
 *
 * A spinner says "the software is busy". A bubble that breathes with three
 * dots trailing it says "someone is about to speak", which is both truer and
 * the thing the rest of the assistant is already built around.
 *
 * Deliberately CSS rather than a video: this appears and disappears several
 * times a minute, has to sit inline at text size, must respect a learner who
 * asked for less motion, and would otherwise be a network fetch and a decode
 * for something that costs nothing to draw.
 */
export function ThinkingBubble({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      role="status"
      aria-label="The tutor is thinking"
    >
      <SaduBubble
        tone="olive"
        className="h-5 w-auto animate-bubble-breathe motion-reduce:animate-none"
      />
      <span aria-hidden className="flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-1 w-1 rounded-full bg-muted-foreground animate-bubble-dot motion-reduce:animate-none"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
    </span>
  );
}
