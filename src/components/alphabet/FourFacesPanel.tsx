import { type ArabicLetter } from "@/data/arabicAlphabet";

interface FourFacesPanelProps {
  letter: ArabicLetter;
}

const FACES: { key: "isolated" | "initial" | "medial" | "final"; label: string; example: string }[] = [
  { key: "isolated", label: "Isolated", example: "alone" },
  { key: "initial", label: "Initial", example: "start" },
  { key: "medial", label: "Medial", example: "middle" },
  { key: "final", label: "Final", example: "end" },
];

/**
 * Shows the letter in all four positional forms. Arabic letters change shape
 * based on where they sit in a word — this panel makes that visual.
 */
export const FourFacesPanel = ({ letter }: FourFacesPanelProps) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {FACES.map((f) => (
        <div
          key={f.key}
          className="p-4 rounded-2xl border-2 border-border bg-card text-center"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {f.label}
          </p>
          <p
            className="text-5xl text-foreground mb-1"
            style={{ fontFamily: "'Noto Sans Arabic', serif", lineHeight: 1 }}
          >
            {letter[f.key]}
          </p>
          <p className="text-xs text-muted-foreground mt-1">at the {f.example}</p>
        </div>
      ))}
    </div>
  );
};
