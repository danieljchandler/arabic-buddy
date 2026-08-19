import type { ReactNode } from "react";
import { SaduBubble, type SaduBubbleTone } from "@/components/brand/SaduBubble";
import { cn } from "@/lib/utils";

/**
 * What a screen says when it has nothing to show yet.
 *
 * These were a scattered pattern before — a large faded lucide icon over two
 * lines of muted text, repeated a couple of dozen times with the icon, the
 * sizes and the text colours all slightly different each time. The icon was
 * doing the least useful work: a greyed heart above "No liked videos yet" only
 * says again what the sentence already said.
 *
 * A sadu bubble says something the sentence cannot — that this is Hakiya, and
 * that the screen is waiting rather than broken. It is the same mark everywhere
 * on purpose; the tone is the only thing that varies, and only where a screen
 * has a reason to feel different.
 */
export function EmptyState({
  title,
  body,
  action,
  tone = "olive",
  className,
}: {
  title: string;
  /** One line on how to make the emptiness go away. */
  body?: ReactNode;
  /** A way out — usually the button that starts the thing. */
  action?: ReactNode;
  tone?: SaduBubbleTone;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <SaduBubble tone={tone} className="mb-3 h-16 w-auto" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body && (
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
