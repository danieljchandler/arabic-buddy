import badgeTrophy from "@/assets/illustrations/badge-trophy.webp";
import badgeFlame from "@/assets/illustrations/badge-flame.webp";
import badgeStar from "@/assets/illustrations/badge-star.webp";
import badgeBooks from "@/assets/illustrations/badge-books.webp";
import badgeTarget from "@/assets/illustrations/badge-target.webp";
import badgeSpeech from "@/assets/illustrations/badge-speech.webp";
import badgeScroll from "@/assets/illustrations/badge-scroll.webp";
import badgeQalam from "@/assets/illustrations/badge-qalam.webp";
import badgeHeadphones from "@/assets/illustrations/badge-headphones.webp";
import badgeCrown from "@/assets/illustrations/badge-crown.webp";
import badgeMedal from "@/assets/illustrations/badge-medal.webp";
import badgeLightning from "@/assets/illustrations/badge-lightning.webp";

/**
 * Achievement badge artwork, keyed by the emoji stored in achievements.icon.
 *
 * Achievements are admin-created rows whose `icon` column is a free emoji
 * string, so there is no key to hang art on other than the emoji itself.
 * Twelve woven-sadu emblems (same visual family as public/avatars) cover the
 * common vocabulary; anything unmapped falls back to rendering the emoji in
 * the old disc, so a new achievement never breaks — it just isn't woven yet.
 */
const BADGE_ART: Record<string, string> = {
  "🏆": badgeTrophy,
  "🥇": badgeMedal,
  "🏅": badgeMedal,
  "🎖️": badgeMedal,
  "💯": badgeMedal,
  "🔥": badgeFlame,
  "⭐": badgeStar,
  "🌟": badgeStar,
  "✨": badgeStar,
  "💫": badgeStar,
  "📚": badgeBooks,
  "📖": badgeBooks,
  "📕": badgeBooks,
  "🎯": badgeTarget,
  "💬": badgeSpeech,
  "🗣️": badgeSpeech,
  "🗣": badgeSpeech,
  "💭": badgeSpeech,
  "🎓": badgeScroll,
  "📜": badgeScroll,
  "✍️": badgeQalam,
  "✍": badgeQalam,
  "🖊️": badgeQalam,
  "✏️": badgeQalam,
  "🎧": badgeHeadphones,
  "🎤": badgeHeadphones,
  "👑": badgeCrown,
  "⚡": badgeLightning,
  "🚀": badgeLightning,
};

export function badgeArtFor(icon: string | null | undefined): string | undefined {
  if (!icon) return undefined;
  return BADGE_ART[icon.trim()];
}
