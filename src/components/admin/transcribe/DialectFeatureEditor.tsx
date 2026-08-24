import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DIALECT_FEATURE_CATEGORIES,
  MAX_DIALECT_FEATURES,
  findSubvariety,
  subvarietiesFor,
  subvarietyLabel,
  type DialectFeature,
} from "../../../../supabase/functions/_shared/dialectSubvarieties";

/** Radix will not take an empty item value; see the note in DialectClassifier. */
const NONE = "__none__";

/** Just enough of a transcript line to point at one. */
export interface FeatureLineOption {
  id: string;
  arabic?: string;
}

interface DialectFeatureEditorProps {
  features: DialectFeature[];
  onChange: (next: DialectFeature[]) => void;
  /** The video's dialect, which decides what the sub-variety dropdown offers. */
  dialect: string;
  /** The video's sub-variety, used as the default for a new feature. */
  subvariety: string | null;
  /** The transcript, so a feature can be pinned to the line it happens on. */
  lines?: FeatureLineOption[];
}

/** A line as one short label — the id alone means nothing to a reader. */
function lineLabel(line: FeatureLineOption, index: number): string {
  const arabic = (line.arabic ?? "").trim();
  const clipped = arabic.length > 40 ? `${arabic.slice(0, 40)}…` : arabic;
  return clipped ? `${index + 1}. ${clipped}` : `Line ${index + 1}`;
}

/**
 * What marks this clip as the variety it is in.
 *
 * Kept apart from the grammar points above it, and the separation is the point.
 * A grammar point answers "what should a learner take away from this video" —
 * it is a teaching unit, it ladders into `user_concept_mastery`, and it is
 * mostly true of Arabic rather than of Jeddah. A dialect feature answers a
 * different question: *what makes this sound like Jeddah and not Riyadh.* Most
 * of the answers are not grammar at all. They are a ق, a Persian borrowing, an
 * intonation contour, a word that means something else one border away.
 * Folding them into `grammar_points` would force every one of those into a
 * grammar category and lose exactly the thing being recorded.
 *
 * `contrast` is the field that makes an entry worth reading. "Uses شنو for
 * 'what'" is a fact a learner can already look up; "uses شنو where Riyadh says
 * وش and Cairo says إيه" is the thing that actually builds dialect intuition,
 * and the native reviewer is the only person here who reliably knows it.
 *
 * A feature may name a sub-variety other than the video's, and that is not a
 * mistake to guard against — a Cairene speaker quoting a Ṣaʿīdi phrase is a
 * real and interesting thing to record.
 */
export function DialectFeatureEditor({
  features,
  onChange,
  dialect,
  subvariety,
  lines = [],
}: DialectFeatureEditorProps) {
  const options = subvarietiesFor(dialect);
  const full = features.length >= MAX_DIALECT_FEATURES;

  const update = (index: number, patch: Partial<DialectFeature>) =>
    onChange(features.map((feature, i) => (i === index ? { ...feature, ...patch } : feature)));

  const remove = (index: number) => onChange(features.filter((_, i) => i !== index));

  const add = () =>
    onChange([
      ...features,
      {
        // Sound is where a reviewer's ear lands first and the category most
        // features turn out to be, so it is the least often-wrong default.
        category: "phonology",
        // Pre-filled with the video's own variety: the common case by a long
        // way, and one fewer dropdown between hearing something and writing it
        // down.
        subvariety: subvariety ?? undefined,
      },
    ]);

  return (
    <div className="space-y-3">
      {features.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Add what places this speaker — the ق, a word only used here, the
          way a question is asked.
        </p>
      )}

      {features.map((feature, i) => {
        const named = feature.subvariety ? findSubvariety(feature.subvariety) : undefined;
        // A feature tagged with a variety from another country — legitimate, so
        // it is offered in the dropdown rather than silently reset to "not set".
        const foreign = named && !options.some((option) => option.id === named.id);

        return (
          <div
            key={i}
            className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1 space-y-1.5">
                <Label htmlFor={`feature-${i}-category`}>What kind</Label>
                <Select
                  value={String(feature.category ?? "")}
                  onValueChange={(value) => update(i, { category: value })}
                >
                  <SelectTrigger
                    id={`feature-${i}-category`}
                    aria-label={`Dialect feature ${i + 1} category`}
                  >
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {DIALECT_FEATURE_CATEGORIES.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {options.length > 0 && (
                <div className="min-w-[12rem] flex-1 space-y-1.5">
                  <Label htmlFor={`feature-${i}-subvariety`}>Specific to</Label>
                  <Select
                    value={feature.subvariety || NONE}
                    onValueChange={(value) =>
                      update(i, { subvariety: value === NONE ? undefined : value })
                    }
                  >
                    <SelectTrigger
                      id={`feature-${i}-subvariety`}
                      aria-label={`Dialect feature ${i + 1} sub-dialect`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>The dialect as a whole</SelectItem>
                      {options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                      {foreign && (
                        <SelectItem value={named.id}>{named.label} (borrowed in)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove dialect feature ${i + 1}`}
                onClick={() => remove(i)}
              >
                ✕
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Input
                value={feature.title ?? ""}
                onChange={(e) => update(i, { title: e.target.value })}
                className="min-w-[12rem] flex-1"
                placeholder="What it is, in a few words"
                aria-label={`Dialect feature ${i + 1} title`}
              />
              <Input
                value={feature.arabic ?? ""}
                onChange={(e) => update(i, { arabic: e.target.value })}
                dir="rtl"
                className="min-w-[10rem] flex-1 text-right font-cairo"
                placeholder="الشكل نفسه"
                aria-label={`Dialect feature ${i + 1} Arabic`}
              />
            </div>

            <Textarea
              value={feature.explanation ?? ""}
              onChange={(e) => update(i, { explanation: e.target.value })}
              rows={2}
              placeholder="How it works here"
              aria-label={`Dialect feature ${i + 1} explanation`}
            />

            {/*
              The field that earns the whole section. Without it an entry is a
              fact a learner could have looked up; with it, it is the contrast
              that builds an ear.
            */}
            <Textarea
              value={feature.contrast ?? ""}
              onChange={(e) => update(i, { contrast: e.target.value })}
              rows={2}
              placeholder="How another variety says the same thing — e.g. “Riyadh would say وش here”"
              aria-label={`Dialect feature ${i + 1} contrast`}
            />

            {lines.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor={`feature-${i}-line`}>Where in the clip</Label>
                <Select
                  value={feature.lineId || NONE}
                  onValueChange={(value) =>
                    update(i, { lineId: value === NONE ? undefined : value })
                  }
                >
                  <SelectTrigger
                    id={`feature-${i}-line`}
                    aria-label={`Dialect feature ${i + 1} line`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Throughout</SelectItem>
                    {lines.map((line, index) => (
                      <SelectItem key={line.id} value={line.id}>
                        {lineLabel(line, index)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={full} onClick={add}>
          Add a dialect feature
        </Button>
        {full && (
          <span className="text-xs text-muted-foreground">
            {MAX_DIALECT_FEATURES} is the most one video can carry.
          </span>
        )}
        {subvariety && (
          <span className="text-xs text-muted-foreground">
            New entries default to {subvarietyLabel(subvariety)}.
          </span>
        )}
      </div>
    </div>
  );
}

export default DialectFeatureEditor;
