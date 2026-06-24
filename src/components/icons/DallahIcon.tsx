import { SVGProps } from "react";

/**
 * Traditional Gulf dallah (Arabic coffee pot) silhouette.
 * Inherits color via `currentColor` so it picks up the active dialect tint.
 */
export const DallahIcon = ({
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
    {/* Main body — bulbous Gulf dallah shape */}
    <path d="M20 22 C20 14, 28 10, 32 10 C36 10, 44 14, 44 22 C44 26, 42 28, 42 30 L42 46 C42 52, 38 56, 32 56 C26 56, 22 52, 22 46 L22 30 C22 28, 20 26, 20 22 Z" />
    {/* Spout — long elegant curve from upper body */}
    <path d="M42 26 C48 24, 54 18, 58 12 C59 10, 56 10, 55 12 C52 16, 46 22, 42 24 Z" />
    {/* Handle — curved arch from top/back */}
    <path d="M20 24 C14 24, 10 28, 10 34 C10 40, 14 44, 18 44 C20 44, 22 42, 22 40 C22 38, 20 38, 18 38 C16 38, 14 36, 14 34 C14 30, 16 28, 20 28 Z" />
    {/* Decorative neck band */}
    <rect x="22" y="28" width="20" height="3" rx="1" />
    {/* Lid / finial — pointed crown typical of Gulf dallahs */}
    <path d="M28 10 L30 4 C31 2, 33 2, 34 4 L36 10 Z" />
    <circle cx="32" cy="3" r="2" />
    {/* Base flare */}
    <path d="M24 54 C24 58, 28 60, 32 60 C36 60, 40 58, 40 54 C40 56, 36 58, 32 58 C28 58, 24 56, 24 54 Z" />
  </svg>
);

export default DallahIcon;
