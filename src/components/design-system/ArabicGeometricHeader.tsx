import { cn } from "@/lib/utils";

interface ArabicGeometricHeaderProps {
  className?: string;
}

/**
 * ArabicGeometricHeader - A decorative header band featuring
 * traditional Gulf Arabic geometric patterns
 * 
 * Inspired by Islamic geometric art found in Saudi and UAE architecture
 */
export function ArabicGeometricHeader({ className }: ArabicGeometricHeaderProps) {
  return (
    <div 
      className={cn(
        "fixed top-0 left-0 right-0 w-full pointer-events-none z-10",
        "animate-fade-in",
        className
      )}
    >
      {/* Main pattern band */}
      <svg
        className="w-full"
        height="72"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gold gradient for accents */}
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4A853" />
            <stop offset="50%" stopColor="#C4973D" />
            <stop offset="100%" stopColor="#B8860B" />
          </linearGradient>
          
          {/* Desert red gradient */}
          <linearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8C3A2B" />
            <stop offset="100%" stopColor="#6B2D22" />
          </linearGradient>

          {/* Deep green gradient */}
          <linearGradient id="greenGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1F6F54" />
            <stop offset="100%" stopColor="#185A44" />
          </linearGradient>

          {/* Islamic geometric star pattern unit */}
          <pattern id="islamicPattern" x="0" y="0" width="72" height="72" patternUnits="userSpaceOnUse">
            {/* Central 8-pointed star */}
            <polygon 
              points="36,8 40,20 52,16 44,28 56,32 44,36 52,48 40,44 36,56 32,44 20,48 28,36 16,32 28,28 20,16 32,20"
              fill="url(#goldGradient)"
              opacity="0.9"
            />
            
            {/* Inner star detail */}
            <polygon 
              points="36,16 39,26 48,24 42,32 50,36 42,40 48,48 39,46 36,56 33,46 24,48 30,40 22,36 30,32 24,24 33,26"
              fill="url(#redGradient)"
              opacity="0.85"
            />
            
            {/* Center diamond */}
            <polygon 
              points="36,24 44,32 36,40 28,32"
              fill="url(#greenGradient)"
            />
            
            {/* Corner interlocking diamonds */}
            <polygon points="0,0 8,4 4,8 0,4" fill="url(#goldGradient)" opacity="0.7" />
            <polygon points="72,0 72,4 68,8 64,4" fill="url(#goldGradient)" opacity="0.7" />
            <polygon points="0,72 4,68 8,72 0,72" fill="url(#goldGradient)" opacity="0.7" />
            <polygon points="72,72 68,68 72,64" fill="url(#goldGradient)" opacity="0.7" />
            
            {/* Connecting lines */}
            <line x1="8" y1="4" x2="20" y2="16" stroke="#1F1F1F" strokeWidth="0.5" opacity="0.3" />
            <line x1="64" y1="4" x2="52" y2="16" stroke="#1F1F1F" strokeWidth="0.5" opacity="0.3" />
            <line x1="8" y1="68" x2="20" y2="56" stroke="#1F1F1F" strokeWidth="0.5" opacity="0.3" />
            <line x1="64" y1="68" x2="52" y2="56" stroke="#1F1F1F" strokeWidth="0.5" opacity="0.3" />
          </pattern>

          {/* Border accent pattern */}
          <pattern id="borderPattern" x="0" y="0" width="24" height="8" patternUnits="userSpaceOnUse">
            <polygon points="0,4 6,0 12,4 6,8" fill="url(#greenGradient)" />
            <polygon points="12,4 18,0 24,4 18,8" fill="url(#redGradient)" opacity="0.8" />
          </pattern>
        </defs>

        {/* Background warm sand base */}
        <rect width="100%" height="72" fill="#E2C5A6" />
        
        {/* Top gold accent line */}
        <rect x="0" y="0" width="100%" height="3" fill="url(#goldGradient)" />
        
        {/* Main pattern area */}
        <rect x="0" y="3" width="100%" height="60" fill="url(#islamicPattern)" />
        
        {/* Bottom decorative border */}
        <rect x="0" y="63" width="100%" height="6" fill="url(#borderPattern)" />
        
        {/* Bottom gold accent line */}
        <rect x="0" y="69" width="100%" height="3" fill="url(#goldGradient)" opacity="0.6" />
      </svg>

      {/* Subtle shadow fade beneath */}
      <div 
        className="w-full"
        style={{
          height: "20px",
          background: "linear-gradient(to bottom, rgba(31, 31, 31, 0.08) 0%, transparent 100%)",
        }}
      />
    </div>
  );
}

export default ArabicGeometricHeader;
