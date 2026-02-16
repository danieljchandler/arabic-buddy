/**
 * SaduBanner - Geometric diamond strip banner
 *
 * Traditional Sadu-inspired woven pattern strip for page headers.
 * Rendered as pure inline SVG — no external files or data URIs needed.
 *
 * Brand colors: Deep Desert olive (#445C3E), Desert Red (#8B4135),
 *               Warm Sand gold (#CFA44E), Charcoal (#3A423C).
 */

export function SaduBanner() {
  return (
    <div className="w-full" aria-hidden="true">
      {/* Gold border top */}
      <div style={{ height: 2, backgroundColor: '#CFA44E' }} />

      {/* Main Sadu pattern strip - pure inline SVG */}
      <svg
        width="100%"
        height="28"
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <defs>
          <pattern id="sadu-tile" x="0" y="0" width="56" height="28" patternUnits="userSpaceOnUse">
            <rect width="56" height="28" fill="#445C3E" />
            <polygon points="14,0 28,14 14,28 0,14" fill="#8B4135" />
            <polygon points="42,0 56,14 42,28 28,14" fill="#8B4135" />
            <line x1="0" y1="0" x2="28" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="14" x2="0" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="0" x2="0" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="0" y1="14" x2="28" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="0" x2="56" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="56" y1="14" x2="28" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="56" y1="0" x2="28" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="14" x2="56" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <polygon points="28,6 34,14 28,22 22,14" fill="none" stroke="#3A423C" strokeWidth="1" />
            <polygon points="14,9 19,14 14,19 9,14" fill="#CFA44E" />
            <polygon points="42,9 47,14 42,19 37,14" fill="#CFA44E" />
            <polygon points="14,11.5 16.5,14 14,16.5 11.5,14" fill="#F5ECD8" />
            <polygon points="42,11.5 44.5,14 42,16.5 39.5,14" fill="#F5ECD8" />
          </pattern>
        </defs>
        <rect width="100%" height="28" fill="url(#sadu-tile)" />
      </svg>

      {/* Gold border bottom */}
      <div style={{ height: 2, backgroundColor: '#CFA44E' }} />

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
