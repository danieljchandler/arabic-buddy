import type { CelebrationBadge } from "@/lib/celebrations";
import { badgeArtFor } from "@/components/gamification/badgeArt";

/**
 * The badge a celebration is for, stuck to the collage like the other scraps:
 * the badge's own emblem (the woven-sadu artwork the achievements grid shows,
 * `badgeArtFor`) in a paper disc with a strip of tape, and its XP on an
 * oxblood tag across the disc's edge. A badge with no artwork yet falls back
 * to its emoji on a mustard disc, as the grid does, so a new badge never has
 * to wait for art. It is only the disc: the badge's Arabic name goes on an ink
 * label in the cheer's stack (`BadgeName`), where there is room, because under
 * the disc it covered the dancers' faces.
 *
 * Decoration for the dialog, whose description already says which badge it
 * is, so the whole thing is hidden from screen readers.
 */
export function BadgeSticker({ badge }: { badge: CelebrationBadge }) {
  const art = badgeArtFor(badge.icon);
  return (
    <div className="cel-badge" data-testid="celebration-badge" aria-hidden="true">
      <div className="cel-badge-disc">
        {art ? (
          <img src={art} alt="" draggable={false} data-testid="celebration-badge-art" />
        ) : (
          <span className="cel-badge-emoji" data-testid="celebration-badge-emoji">
            {badge.icon}
          </span>
        )}
      </div>
      <span className="cel-badge-xp">+{badge.xp} XP</span>
    </div>
  );
}

/** The badge's name in Arabic, as an ink label like the cheer's. Nothing when it has none. */
export function BadgeName({ badge }: { badge: CelebrationBadge }) {
  if (!badge.nameArabic) return null;
  return (
    <span className="cel-label cel-badge-name" lang="ar" dir="rtl" data-testid="celebration-badge-name">
      {badge.nameArabic}
    </span>
  );
}
