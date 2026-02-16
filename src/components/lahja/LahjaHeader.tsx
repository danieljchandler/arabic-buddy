import { cn } from "@/lib/utils";

interface LahjaHeaderProps {
  title: string;
  subtitle?: string;
  logoSrc?: string;
  logoAlt?: string;
  className?: string;
}

export const LahjaHeader = ({
  title,
  subtitle,
  logoSrc,
  logoAlt = "Lahja logo",
  className,
}: LahjaHeaderProps) => {
  return (
    <header
      className={cn(
        "flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-soft",
        className,
      )}
    >
      {logoSrc ? (
        <img src={logoSrc} alt={logoAlt} className="h-11 w-11 rounded-lg border border-border/80 bg-white object-cover p-1" />
      ) : null}
      <div className="min-w-0">
        <h1 className="font-heading text-xl text-foreground md:text-2xl">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </header>
  );
};
