import saduBannerImg from "@/assets/sadu-banner.png";

/**
 * SaduBanner - Geometric diamond strip banner
 *
 * Traditional Sadu-inspired woven pattern strip for page headers.
 * Uses the actual Sadu border PNG image, tiled horizontally.
 */

export function SaduBanner() {
  return (
    <div className="w-full" aria-hidden="true">
      {/* Main Sadu pattern strip - PNG, tiled horizontally */}
      <div
        style={{
          width: '100%',
          height: 40,
          backgroundImage: `url(${saduBannerImg})`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 100%',
          backgroundPosition: 'center top',
        }}
      />

      {/* Warm sand gradient fade */}
      <div
        style={{
          height: 60,
          background: 'linear-gradient(180deg, rgba(226,197,166,0.5) 0%, rgba(226,197,166,0) 100%)',
        }}
      />
    </div>
  );
}
