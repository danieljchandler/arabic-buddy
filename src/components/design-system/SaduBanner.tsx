/**
 * SaduBanner - Geometric diamond strip banner
 *
 * Traditional Sadu-inspired woven pattern strip for page headers.
 * Uses static SVG files from /public/assets for reliable rendering.
 *
 * Brand colors: Deep Desert olive, Desert Red, Warm Sand gold, Charcoal.
 */

export function SaduBanner() {
  return (
    <div className="w-full" aria-hidden="true">
      {/* Gold border top */}
      <div style={{ height: 2, backgroundColor: '#CFA44E' }} />

      {/* Main Sadu pattern strip */}
      <div
        style={{
          height: 28,
          backgroundImage: 'url("/assets/sadu-tile.svg")',
          backgroundRepeat: 'repeat-x',
          backgroundSize: '56px 28px',
          backgroundColor: '#445C3E',
        }}
      />

      {/* Gold border bottom */}
      <div style={{ height: 2, backgroundColor: '#CFA44E' }} />

      {/* Warm sand gradient fade with diamond watermarks */}
      <div
        style={{
          height: 60,
          backgroundImage: 'url("/assets/sadu-watermark.svg"), linear-gradient(180deg, rgba(226,197,166,0.5) 0%, rgba(226,197,166,0) 100%)',
          backgroundRepeat: 'repeat, no-repeat',
          backgroundSize: '44px 44px, 100% 100%',
        }}
      />
    </div>
  );
}
