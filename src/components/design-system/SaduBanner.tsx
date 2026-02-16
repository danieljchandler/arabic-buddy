/**
 * SaduBanner - Geometric diamond strip banner
 *
 * Traditional Sadu-inspired woven pattern strip for page headers.
 * Uses brand colors: Deep Desert olive, Desert Red, Warm Sand gold, Charcoal.
 * Includes a soft parchment gradient fade with diamond watermarks below the strip.
 */
export function SaduBanner() {
  return (
    <div className="w-full overflow-hidden" aria-hidden="true">
      <svg
        width="100%"
        height="100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Sadu diamond pattern tile - 56x28 repeating unit */}
          <pattern
            id="sadu-motif"
            width="56"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            {/* Dark olive green base */}
            <rect width="56" height="28" fill="#445C3E" />

            {/* Red diamond fills - alternating with green */}
            <polygon points="14,0 28,14 14,28 0,14" fill="#8B4135" />
            <polygon points="42,0 56,14 42,28 28,14" fill="#8B4135" />

            {/* Gold X-pattern lines forming the interlocking lattice */}
            <line x1="0" y1="0" x2="28" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="14" x2="0" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="0" x2="0" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="0" y1="14" x2="28" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="0" x2="56" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="56" y1="14" x2="28" y2="28" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="56" y1="0" x2="28" y2="14" stroke="#CFA44E" strokeWidth="2.5" />
            <line x1="28" y1="14" x2="56" y2="28" stroke="#CFA44E" strokeWidth="2.5" />

            {/* Charcoal diamond outlines at X intersections */}
            <polygon points="28,6 34,14 28,22 22,14" fill="none" stroke="#3A423C" strokeWidth="1" />

            {/* Gold diamond accents at red diamond centers */}
            <polygon points="14,9 19,14 14,19 9,14" fill="#CFA44E" />
            <polygon points="42,9 47,14 42,19 37,14" fill="#CFA44E" />

            {/* Cream highlight dots */}
            <polygon points="14,11.5 16.5,14 14,16.5 11.5,14" fill="#F5ECD8" />
            <polygon points="42,11.5 44.5,14 42,16.5 39.5,14" fill="#F5ECD8" />
          </pattern>

          {/* Diamond watermark for gradient area */}
          <pattern
            id="sadu-watermark"
            width="44"
            height="44"
            patternUnits="userSpaceOnUse"
          >
            <polygon
              points="22,2 42,22 22,42 2,22"
              fill="none"
              stroke="#C5A67A"
              strokeWidth="0.7"
              opacity="0.12"
            />
            <polygon
              points="22,10 32,22 22,34 12,22"
              fill="none"
              stroke="#C5A67A"
              strokeWidth="0.4"
              opacity="0.08"
            />
          </pattern>

          {/* Gradient fade below strip */}
          <linearGradient id="sadu-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E2C5A6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#E2C5A6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gold border line above strip */}
        <rect x="0" y="0" width="100%" height="1.5" fill="#CFA44E" />

        {/* Main Sadu pattern strip */}
        <rect x="0" y="1.5" width="100%" height="28" fill="url(#sadu-motif)" />

        {/* Gold border line below strip */}
        <rect x="0" y="29.5" width="100%" height="1.5" fill="#CFA44E" />

        {/* Warm sand gradient fade */}
        <rect x="0" y="31" width="100%" height="69" fill="url(#sadu-fade)" />

        {/* Diamond watermark in gradient area */}
        <rect x="0" y="31" width="100%" height="69" fill="url(#sadu-watermark)" />
      </svg>
    </div>
  );
}
