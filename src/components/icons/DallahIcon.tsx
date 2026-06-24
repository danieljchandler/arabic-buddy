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
    {/* Dallah body */}
    <path
      d="
        M28 20
        C26 20, 24 22, 24 26
        L24 42
        C24 48, 26 52, 32 52
        C38 52, 40 48, 40 42
        L40 26
        C40 22, 38 20, 36 20
        Z
      "
    />
    {/* Spout */}
    <path
      d="
        M40 30
        C48 28, 54 24, 58 18
        C60 16, 58 14, 56 16
        C52 20, 46 24, 40 26
        Z
      "
    />
    {/* Handle */}
    <path
      d="
        M24 28
        C18 26, 12 28, 10 34
        C8 38, 10 42, 14 42
        C16 42, 18 40, 18 38
        C18 36, 20 34, 24 34
        Z
      "
    />
    {/* Lid / finial */}
    <path
      d="
        M30 20
        L30 14
        C30 12, 32 12, 32 14
        L32 20
        Z
      "
    />
    <circle cx="32" cy="12" r="2.5" />
    {/* Base ring */}
    <ellipse cx="32" cy="52" rx="8" ry="2.5" />
  </svg>
);

export default DallahIcon;
