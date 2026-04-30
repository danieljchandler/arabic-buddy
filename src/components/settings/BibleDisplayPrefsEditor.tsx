import { BookOpen } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useBibleDisplayPrefs } from "@/hooks/useBibleDisplayPrefs";

const ROWS: Array<{
  key: "showArabic" | "showTashkil" | "showFormal" | "showEnglish";
  label: string;
  desc: string;
}> = [
  { key: "showArabic", label: "Dialect Arabic", desc: "Main verse text in the chosen dialect" },
  { key: "showTashkil", label: "Tashkil (diacritics)", desc: "Show vowel marks on Arabic letters" },
  { key: "showFormal", label: "Formal Arabic (MSA)", desc: "Standard Arabic verse, when available" },
  { key: "showEnglish", label: "English translation", desc: "English text under each verse" },
];

export function BibleDisplayPrefsEditor() {
  const { prefs, update } = useBibleDisplayPrefs();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        <BookOpen className="h-4 w-4" />
        Bible Lesson Display
      </div>
      <p className="text-xs text-muted-foreground">
        Choose what to show by default when reading curated Bible lessons. Turn everything off to focus on memory.
      </p>
      <div className="space-y-2">
        {ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between p-3 rounded-xl bg-card border border-border"
          >
            <div className="min-w-0 pr-3">
              <p className="font-medium text-foreground text-sm">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.desc}</p>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(v) => update({ [row.key]: v } as any)}
              disabled={row.key === "showTashkil" && !prefs.showArabic}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
