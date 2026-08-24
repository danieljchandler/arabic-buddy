import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DialectClassifier from "./DialectClassifier";
import DialectFeatureEditor, { type FeatureLineOption } from "./DialectFeatureEditor";
import type { DialectFeature } from "../../../../supabase/functions/_shared/dialectSubvarieties";

export interface GrammarPoint {
  title?: string;
  explanation?: string;
  examples?: string[];
  cefr_level?: string;
}

export interface VocabEntry {
  arabic?: string;
  english?: string;
  root?: string;
}

export type { DialectFeature };

interface VideoNotesEditorProps {
  culturalContext: string;
  grammarPoints: GrammarPoint[];
  vocabulary: VocabEntry[];
  /** The country-level label on the row, e.g. "Saudi". */
  dialect: string;
  /** The sub-variety under it, e.g. "hijazi". Null until somebody judges it. */
  dialectSubvariety: string | null;
  dialectFeatures: DialectFeature[];
  /** The transcript, so a dialect feature can be pinned to the line it is on. */
  lines?: FeatureLineOption[];
  busy?: boolean;
  onSave: (input: {
    culturalContext: string;
    grammarPoints: GrammarPoint[];
    vocabulary: VocabEntry[];
    dialect: string;
    dialectSubvariety: string | null;
    dialectFeatures: DialectFeature[];
  }) => Promise<unknown> | void;
}

/**
 * Everything about the video that is not a line of transcript.
 *
 * A native speaker's usefulness does not stop at the Arabic. They are the
 * person who knows that a phrase is a greeting only used at a funeral, or that
 * the grammar note the model wrote describes MSA rather than what is actually
 * spoken here — so the cultural notes, the grammar points and the vocabulary
 * are editable in the same place as the transcript rather than behind the
 * admin-only video form.
 *
 * The same reasoning extends to the dialect classification at the top and the
 * dialect features below the grammar points: the reviewer is also the only
 * person in the pipeline who can hear that this is Ḥijāzi rather than Najdi,
 * and the label the pipeline guessed was reaching every generator downstream
 * with nobody able to correct it.
 *
 * Kept as one form with one save, because these fields are argued over together
 * and the revision log reads better as "they revised the notes" than as six
 * separate entries a second apart.
 */
export function VideoNotesEditor({
  culturalContext,
  grammarPoints,
  vocabulary,
  dialect,
  dialectSubvariety,
  dialectFeatures,
  lines = [],
  busy = false,
  onSave,
}: VideoNotesEditorProps) {
  const [context, setContext] = useState(culturalContext);
  const [points, setPoints] = useState<GrammarPoint[]>(grammarPoints);
  const [words, setWords] = useState<VocabEntry[]>(vocabulary);
  const [label, setLabel] = useState(dialect);
  const [variety, setVariety] = useState<string | null>(dialectSubvariety);
  const [features, setFeatures] = useState<DialectFeature[]>(dialectFeatures);

  // Re-seed when the video finishes loading, or when someone else's save lands.
  useEffect(() => setContext(culturalContext), [culturalContext]);
  useEffect(() => setPoints(grammarPoints), [grammarPoints]);
  useEffect(() => setWords(vocabulary), [vocabulary]);
  useEffect(() => setLabel(dialect), [dialect]);
  useEffect(() => setVariety(dialectSubvariety), [dialectSubvariety]);
  useEffect(() => setFeatures(dialectFeatures), [dialectFeatures]);

  const dirty =
    context !== culturalContext ||
    JSON.stringify(points) !== JSON.stringify(grammarPoints) ||
    JSON.stringify(words) !== JSON.stringify(vocabulary) ||
    label !== dialect ||
    variety !== dialectSubvariety ||
    JSON.stringify(features) !== JSON.stringify(dialectFeatures);

  const updatePoint = (index: number, patch: Partial<GrammarPoint>) =>
    setPoints((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const updateWord = (index: number, patch: Partial<VocabEntry>) =>
    setWords((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));

  return (
    <div className="space-y-4">
      {/*
        First on the tab, because it frames everything under it: which grammar
        counts as dialect-specific depends entirely on which dialect this is.
      */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Which variety is this?</CardTitle>
        </CardHeader>
        <CardContent>
          <DialectClassifier
            dialect={label}
            subvariety={variety}
            onChange={(next) => {
              setLabel(next.dialect);
              setVariety(next.subvariety);
            }}
            disabled={busy}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cultural notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={6}
            aria-label="Cultural notes"
            placeholder="What would a learner miss here — register, a reference, who says this and when?"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Grammar points ({points.length})</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPoints([...points, { title: "", explanation: "" }])}
          >
            Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {points.length === 0 && (
            <p className="text-sm text-muted-foreground">No grammar points yet.</p>
          )}
          {points.map((point, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex gap-2">
                <Input
                  value={point.title ?? ""}
                  onChange={(e) => updatePoint(i, { title: e.target.value })}
                  placeholder="Title"
                  aria-label={`Grammar point ${i + 1} title`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove grammar point ${i + 1}`}
                  onClick={() => setPoints(points.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </div>
              <Textarea
                value={point.explanation ?? ""}
                onChange={(e) => updatePoint(i, { explanation: e.target.value })}
                rows={3}
                placeholder="Explanation"
                aria-label={`Grammar point ${i + 1} explanation`}
              />
              {/*
                Examples were previously invisible in the admin form — the
                pipeline writes them and nobody could correct them. A textarea
                of one-per-line is the plainest editable rendering of a string
                array, and the reviewer is the person most likely to spot an
                example that is not idiomatic.
              */}
              <Textarea
                value={(point.examples ?? []).join("\n")}
                onChange={(e) =>
                  updatePoint(i, {
                    examples: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
                rows={2}
                dir="rtl"
                className="text-right font-cairo"
                placeholder="Examples, one per line"
                aria-label={`Grammar point ${i + 1} examples`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/*
        Directly under the grammar points, because the pairing is the lesson:
        the card above is what a learner should take away about Arabic, this one
        is what places this speaker. Same screen, different question.
      */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Dialect-specific features ({features.length})
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Not what a learner should take away about Arabic — what makes this sound like this
            variety and not the one next door.
          </p>
        </CardHeader>
        <CardContent>
          <DialectFeatureEditor
            features={features}
            onChange={setFeatures}
            dialect={label}
            subvariety={variety}
            lines={lines}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Vocabulary ({words.length})</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setWords([...words, { arabic: "", english: "", root: "" }])}
          >
            Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {words.length === 0 && (
            <p className="text-sm text-muted-foreground">No vocabulary yet.</p>
          )}
          {words.map((word, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={word.arabic ?? ""}
                onChange={(e) => updateWord(i, { arabic: e.target.value })}
                dir="rtl"
                className="text-right font-cairo"
                placeholder="Arabic"
                aria-label={`Vocabulary ${i + 1} Arabic`}
              />
              <Input
                value={word.english ?? ""}
                onChange={(e) => updateWord(i, { english: e.target.value })}
                placeholder="English"
                aria-label={`Vocabulary ${i + 1} English`}
              />
              <Input
                value={word.root ?? ""}
                onChange={(e) => updateWord(i, { root: e.target.value })}
                dir="rtl"
                className="w-24 text-right font-cairo"
                placeholder="Root"
                aria-label={`Vocabulary ${i + 1} root`}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove vocabulary ${i + 1}`}
                onClick={() => setWords(words.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          disabled={busy || !dirty}
          onClick={() =>
            onSave({
              culturalContext: context,
              grammarPoints: points,
              vocabulary: words,
              dialect: label,
              dialectSubvariety: variety,
              dialectFeatures: features,
            })
          }
        >
          {busy ? "Saving…" : "Save notes"}
        </Button>
        {dirty && !busy && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

export default VideoNotesEditor;
