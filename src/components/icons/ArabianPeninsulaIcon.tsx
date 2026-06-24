import { SVGProps } from "react";

/**
 * Simple flat silhouette of the Arabian Peninsula.
 * Inherits color via `currentColor` so it picks up the active dialect tint.
 */
export const ArabianPeninsulaIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 64 64"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
    {...props}
  >
    {/*
      Stylised Arabian Peninsula outline.
      Path approximates: Sinai/Aqaba top-left, Levant border across the top,
      Kuwait notch, Gulf coast down to Qatar bump, UAE/Oman elbow,
      Musandam tick, southern coast across Yemen, tapering Red Sea on the west.
    */}
    <path
      d="
        M14 8
        L22 6
        L30 9
        L40 8
        L50 12
        L54 18
        L52 24
        L55 30
        L57 36
        L55 42
        L49 47
        L52 49
        L50 53
        L44 55
        L36 58
        L26 56
        L18 50
        L14 42
        L11 34
        L9 26
        L10 18
        Z
      "
    />
    {/* Musandam peninsula tick */}
    <path d="M53 28 L57 26 L56 31 Z" />
  </svg>
);

export default ArabianPeninsulaIcon;
