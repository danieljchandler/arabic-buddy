/**
 * SaduBanner - Geometric diamond strip banner
 *
 * Traditional Sadu-inspired woven pattern strip for page headers.
 * Uses CSS background-image tiling (data URI) for reliable rendering
 * across all routes — avoids SVG url(#id) issues with React Router.
 *
 * Brand colors: Deep Desert olive, Desert Red, Warm Sand gold, Charcoal.
 */

// 56x28 SVG tile for the Sadu diamond pattern (single-line, raw # chars — encoded at runtime)
const TILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28" viewBox="0 0 56 28"><rect width="56" height="28" fill="#445C3E"/><polygon points="14,0 28,14 14,28 0,14" fill="#8B4135"/><polygon points="42,0 56,14 42,28 28,14" fill="#8B4135"/><line x1="0" y1="0" x2="28" y2="14" stroke="#CFA44E" stroke-width="2.5"/><line x1="28" y1="14" x2="0" y2="28" stroke="#CFA44E" stroke-width="2.5"/><line x1="28" y1="0" x2="0" y2="14" stroke="#CFA44E" stroke-width="2.5"/><line x1="0" y1="14" x2="28" y2="28" stroke="#CFA44E" stroke-width="2.5"/><line x1="28" y1="0" x2="56" y2="14" stroke="#CFA44E" stroke-width="2.5"/><line x1="56" y1="14" x2="28" y2="28" stroke="#CFA44E" stroke-width="2.5"/><line x1="56" y1="0" x2="28" y2="14" stroke="#CFA44E" stroke-width="2.5"/><line x1="28" y1="14" x2="56" y2="28" stroke="#CFA44E" stroke-width="2.5"/><polygon points="28,6 34,14 28,22 22,14" fill="none" stroke="#3A423C" stroke-width="1"/><polygon points="14,9 19,14 14,19 9,14" fill="#CFA44E"/><polygon points="42,9 47,14 42,19 37,14" fill="#CFA44E"/><polygon points="14,11.5 16.5,14 14,16.5 11.5,14" fill="#F5ECD8"/><polygon points="42,11.5 44.5,14 42,16.5 39.5,14" fill="#F5ECD8"/></svg>';

// 44x44 watermark diamond tile
const WATERMARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><polygon points="22,2 42,22 22,42 2,22" fill="none" stroke="#C5A67A" stroke-width="0.7" opacity="0.12"/><polygon points="22,10 32,22 22,34 12,22" fill="none" stroke="#C5A67A" stroke-width="0.4" opacity="0.08"/></svg>';

// Properly encode SVGs for use in CSS url()
const tileUrl = `url("data:image/svg+xml,${encodeURIComponent(TILE_SVG)}")`;
const watermarkUrl = `url("data:image/svg+xml,${encodeURIComponent(WATERMARK_SVG)}")`;

export function SaduBanner() {
  return (
    <div className="w-full" aria-hidden="true">
      {/* Gold border top */}
      <div style={{ height: 1.5, backgroundColor: '#CFA44E' }} />

      {/* Main Sadu pattern strip - CSS tiled background */}
      <div
        style={{
          height: 28,
          backgroundImage: tileUrl,
          backgroundRepeat: 'repeat-x',
          backgroundSize: '56px 28px',
        }}
      />

      {/* Gold border bottom */}
      <div style={{ height: 1.5, backgroundColor: '#CFA44E' }} />

      {/* Warm sand gradient fade with diamond watermarks */}
      <div
        style={{
          height: 60,
          backgroundImage: `${watermarkUrl}, linear-gradient(180deg, rgba(226,197,166,0.5) 0%, rgba(226,197,166,0) 100%)`,
          backgroundRepeat: 'repeat, no-repeat',
          backgroundSize: '44px 44px, 100% 100%',
        }}
      />
    </div>
  );
}
