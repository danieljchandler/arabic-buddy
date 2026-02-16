const palette = [
  { name: "Primary Green", token: "--color-primary", value: "#1F6F54" },
  { name: "Sand", token: "--color-sand", value: "#E6D5B8" },
  { name: "Charcoal", token: "--color-charcoal", value: "#1F1F1F" },
  { name: "Accent Red", token: "--color-accent-red", value: "#8C3A2B" },
  { name: "Surface", token: "--color-surface", value: "#F8F1E4" },
];

const buttonStyles = [
  { label: "Primary", className: "bg-primary text-primary-foreground" },
  { label: "Secondary", className: "bg-secondary text-secondary-foreground" },
  { label: "Accent", className: "bg-accent text-accent-foreground" },
];

const DesignSystem = () => {
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-8 md:p-12">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Lahja Design System</p>
        <h1 className="font-heading text-4xl text-foreground">Calm, minimal, and grounded</h1>
        <p className="max-w-3xl text-base text-muted-foreground">
          Core visual foundations from BRAND.md: flat colors, subtle elevation, and bilingual-friendly
          typography.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Palette</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {palette.map((swatch) => (
            <article key={swatch.token} className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
              <div className="h-20" style={{ backgroundColor: `var(${swatch.token})` }} />
              <div className="space-y-1 p-3 text-sm">
                <p className="font-semibold text-foreground">{swatch.name}</p>
                <p className="text-muted-foreground">{swatch.value}</p>
                <p className="font-mono text-xs text-muted-foreground">{swatch.token}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Typography</h2>
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-soft">
          <p className="font-heading text-3xl">Montserrat Bold for English headings</p>
          <p className="font-arabic text-2xl">خط عربي واضح باستخدام Cairo Bold</p>
          <p className="font-body text-base text-muted-foreground">
            Open Sans Regular for readable body text and mixed-language UI labels.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Buttons</h2>
        <div className="flex flex-wrap gap-4">
          {buttonStyles.map((button) => (
            <button
              key={button.label}
              type="button"
              className={`rounded-md px-5 py-2.5 text-sm font-semibold shadow-soft transition-opacity hover:opacity-90 ${button.className}`}
            >
              {button.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-heading text-2xl">Cards</h2>
          <article className="rounded-xl border border-border bg-card p-6 shadow-card">
            <h3 className="font-heading text-xl text-foreground">Lesson Card</h3>
            <p className="mt-2 text-muted-foreground">
              Use flat surfaces and low-contrast shadows to keep focus on content.
            </p>
          </article>
        </div>

        <div className="space-y-4">
          <h2 className="font-heading text-2xl">Inputs</h2>
          <div className="rounded-xl border border-border bg-card p-6 shadow-soft">
            <label className="mb-2 block text-sm font-semibold text-foreground" htmlFor="demo-input">
              Search phrase
            </label>
            <input
              id="demo-input"
              type="text"
              placeholder="Type in Arabic or English"
              className="w-full rounded-md border border-border bg-input px-4 py-2.5 text-foreground outline-none ring-0 transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl">Dividers</h2>
        <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-soft">
          <div className="h-px w-full bg-border" />
          <div className="h-px w-full bg-primary/30" />
          <div className="h-px w-full bg-accent/30" />
        </div>
      </section>
    </main>
  );
};

export default DesignSystem;
