import lahjaLogo from "@/assets/lahja-logo.png";
import {
  LahjaButton,
  LahjaCard,
  LahjaDialectPill,
  LahjaDividerPattern,
  LahjaHeader,
  LahjaInput,
  LahjaWordRow,
} from "@/components/lahja";

const palette = [
  { name: "Primary Green", token: "--color-primary", value: "#1F6F54" },
  { name: "Sand", token: "--color-sand", value: "#E6D5B8" },
  { name: "Charcoal", token: "--color-charcoal", value: "#1F1F1F" },
  { name: "Accent Red", token: "--color-accent-red", value: "#8C3A2B" },
  { name: "Surface", token: "--color-surface", value: "#F8F1E4" },
];

const DesignSystem = () => {
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-8 md:p-12">
      <LahjaHeader
        logoSrc={lahjaLogo}
        title="Lahja Design System"
        subtitle="Calm, minimal UI with subtle accents and bilingual-ready typography"
      />

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Palette</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {palette.map((swatch) => (
            <LahjaCard key={swatch.token} className="overflow-hidden p-0">
              <div className="h-20" style={{ backgroundColor: `var(${swatch.token})` }} />
              <div className="space-y-1 p-3 text-sm">
                <p className="font-semibold text-foreground">{swatch.name}</p>
                <p className="text-muted-foreground">{swatch.value}</p>
                <p className="font-mono text-xs text-muted-foreground">{swatch.token}</p>
              </div>
            </LahjaCard>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Typography</h2>
        <LahjaCard className="space-y-3">
          <p className="font-heading text-3xl">Montserrat Bold for English headings</p>
          <p className="font-arabic text-2xl">يا هلا — Cairo Bold for Arabic-first UI moments</p>
          <p className="font-body text-base text-muted-foreground">
            Open Sans Regular for body text and mixed-language labels.
          </p>
        </LahjaCard>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Buttons</h2>
        <LahjaCard className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <LahjaButton variant="primary">Primary</LahjaButton>
            <LahjaButton variant="secondary">Secondary</LahjaButton>
            <LahjaButton variant="ghost">Ghost</LahjaButton>
          </div>
          <div className="flex flex-wrap gap-3">
            <LahjaButton variant="primary" className="brightness-95">
              Hover Preview
            </LahjaButton>
            <LahjaButton variant="secondary" disabled>
              Disabled
            </LahjaButton>
            <LahjaButton variant="ghost" disabled>
              Disabled
            </LahjaButton>
          </div>
        </LahjaCard>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <LahjaCard className="space-y-4">
          <h2 className="font-heading text-2xl">Inputs</h2>
          <LahjaInput id="search-phrase" label="Search phrase" placeholder="Type Arabic or English" />
          <LahjaInput id="disabled-input" label="Disabled" value="Coming soon" disabled readOnly />
        </LahjaCard>

        <LahjaCard className="space-y-4">
          <h2 className="font-heading text-2xl">Dialect Pills</h2>
          <div className="flex flex-wrap gap-2">
            <LahjaDialectPill label="Kuwaiti" active />
            <LahjaDialectPill label="Saudi" />
            <LahjaDialectPill label="Emirati" />
            <LahjaDialectPill label="Bahraini" />
          </div>
        </LahjaCard>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Word Rows</h2>
        <LahjaCard className="space-y-3">
          <LahjaWordRow arabic="شلونك؟" transliteration="shlōnik?" english="How are you?" />
          <LahjaWordRow arabic="يلا" transliteration="yalla" english="Let’s go" />
          <LahjaWordRow arabic="مشكور" transliteration="mashkūr" english="Thank you" />
        </LahjaCard>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Divider Pattern</h2>
        <LahjaCard className="space-y-5">
          <p className="text-sm text-muted-foreground">Very low-contrast, majlis-inspired divider accent.</p>
          <LahjaDividerPattern />
          <LahjaDividerPattern className="opacity-70" />
        </LahjaCard>
      </section>
    </main>
  );
};

export default DesignSystem;
