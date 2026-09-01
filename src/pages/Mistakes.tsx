import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader } from "@/components/layout/HubGrid";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDialect } from "@/contexts/DialectContext";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useMistakes, useResolveMistake } from "@/hooks/useLearnerErrors";
import { describeMistake, labelForKind, labelForSource, type MistakeGroup } from "@/lib/mistakes";
import { supabase } from "@/integrations/supabase/client";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { Check, CheckCircle2, Loader2, Target, Volume2, X } from "lucide-react";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { useMemo } from "react";
import { toast } from "sonner";

/**
 * The learner's own mistakes.
 *
 * `learner_errors` has been accumulating every pronunciation miss, shadowing
 * gap, sentence-coach failure and set-phrase mismatch — and feeding all of it
 * to the content generators, while never showing the learner a single row. The
 * person who made the mistakes was the one party who couldn't see them.
 *
 * Deliberately a review surface, not a drill: the app already has good places
 * to practise (pronunciation, shadowing, sentence coach), and what was missing
 * was knowing *what* to take there. Each entry says what you were aiming for,
 * what came out, how often, and how recently, with the correct audio to
 * compare against.
 */
interface DrillChoice {
  arabic: string;
  correct: boolean;
  /** This wrong answer is the learner's own recorded production. */
  yours?: boolean;
}

interface DrillItem {
  target_arabic: string;
  target_english: string;
  scenario_english: string;
  explanation: string;
  choices: DrillChoice[];
  count: number;
}

const Mistakes = () => {
  const { activeDialect } = useDialect();
  const { data: groups, isLoading } = useMistakes(activeDialect);
  const resolve = useResolveMistake();
  const queryClient = useQueryClient();

  const [drillLoading, setDrillLoading] = useState(false);
  const [drill, setDrill] = useState<DrillItem[] | null>(null);

  const startDrill = async () => {
    setDrillLoading(true);
    const { data, error } = await supabase.functions.invoke("mistake-drill", {
      body: { action: "items", dialect: activeDialect },
    });
    setDrillLoading(false);
    if (showCapToastIfLimited(error, data)) return;
    const items = (data?.items ?? []) as DrillItem[];
    if (error || items.length === 0) {
      toast.error("Couldn't build a drill right now — try again.");
      return;
    }
    setDrill(items);
  };

  const endDrill = () => {
    setDrill(null);
    markTaskCompletedToday("mistake-drill");
    void queryClient.invalidateQueries({ queryKey: ["learner-errors"] });
  };

  usePageAiContext(
    useMemo(
      () => ({
        kind: "page" as const,
        title: "Your mistakes",
        summary: `The learner's recurring ${activeDialect} Arabic mistakes, gathered from pronunciation, shadowing and sentence practice.`,
        content: (groups ?? [])
          .slice(0, 15)
          .map((g) => `${g.target} — ${describeMistake(g)}`)
          .join("\n"),
      }),
      [groups, activeDialect],
    ),
  );

  return (
    <AppShell>
      <PageCorner />
      <HubHeader
        title="Your mistakes"
        subtitle={`What keeps tripping you up in ${activeDialect} Arabic.`}
      />

      {drill ? (
        <MistakeDrillPanel
          items={drill}
          dialect={activeDialect}
          onDone={endDrill}
        />
      ) : isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">Nothing outstanding.</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Mistakes show up here after speaking practice — pronunciation,
            shadowing and sentence practice all feed this list.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Fossils persist because they never hurt enough to get corrected —
              the drill is the deliberate correction the wild never supplies. */}
          <Button className="w-full" onClick={() => void startDrill()} disabled={drillLoading}>
            {drillLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Target className="mr-2 h-4 w-4" />
            )}
            Drill these
          </Button>
          {groups.map((group) => (
            <MistakeCard
              key={`${group.dialect}-${group.target}`}
              group={group}
              onDismiss={() => resolve.mutate(group.ids)}
              dismissing={resolve.isPending}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
};

interface DrillPanelProps {
  items: DrillItem[];
  dialect: string;
  onDone: () => void;
}

/**
 * The drill loop: pick the right form (with the learner's own version among
 * the choices — the juxtaposition is the point), then type it. Only the typed
 * production resolves the underlying errors; the choice is just noticing.
 */
function MistakeDrillPanel({ items, dialect, onDone }: DrillPanelProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<DrillChoice | null>(null);
  const [produced, setProduced] = useState("");
  const [checking, setChecking] = useState(false);
  const [produceResult, setProduceResult] = useState<{ accepted: boolean } | null>(null);

  const item = items[idx];

  const submitProduction = async () => {
    const attempt = produced.trim();
    if (!attempt) return;
    setChecking(true);
    const { data, error } = await supabase.functions.invoke("mistake-drill", {
      body: { action: "produce", dialect, targetArabic: item.target_arabic, produced: attempt },
    });
    setChecking(false);
    if (showCapToastIfLimited(error, data)) return;
    if (error || typeof data?.accepted !== "boolean") {
      toast.error("Couldn't check that — try again.");
      return;
    }
    setProduceResult({ accepted: data.accepted });
    if (data.accepted) toast.success("Cleared — that one's out of your mistake list.");
  };

  const next = () => {
    setPicked(null);
    setProduced("");
    setProduceResult(null);
    if (idx + 1 >= items.length) {
      onDone();
      toast.success("Drill complete!");
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {idx + 1} / {items.length}
        </span>
        <button type="button" className="underline-offset-2 hover:underline" onClick={onDone}>
          End drill
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm">{item.scenario_english}</p>
        <p className="mt-1 text-xs text-muted-foreground">What do you say?</p>
      </div>

      {!picked ? (
        <div className="space-y-2">
          {item.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(choice)}
              className="w-full rounded-lg border border-border bg-card p-3 text-right transition hover:border-primary/40 active:scale-[0.99]"
              dir="rtl"
            >
              <p className="font-arabic text-lg">{choice.arabic}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            {picked.correct ? (
              <>
                <Check className="h-5 w-5 text-emerald-600" />
                <span className="font-semibold">Right.</span>
              </>
            ) : (
              <>
                <X className="h-5 w-5 text-destructive" />
                <span className="font-semibold">
                  {picked.yours ? "That's the one you keep saying." : "Not that one."}
                </span>
              </>
            )}
          </div>
          <div>
            <p dir="rtl" className="font-arabic text-xl font-semibold">
              {item.target_arabic}
            </p>
            <p className="text-sm text-muted-foreground">{item.target_english}</p>
          </div>
          <p className="text-sm text-muted-foreground">{item.explanation}</p>

          {/* Production is what resolves the fossil, so the card is not done
              at the right answer — noticing is not yet knowing. */}
          {produceResult?.accepted ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Cleared from your mistakes.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Now type it yourself
              </p>
              <Input
                dir="rtl"
                lang="ar"
                value={produced}
                onChange={(e) => setProduced(e.target.value)}
                placeholder="اكتبها هنا…"
                className="font-arabic text-lg"
                disabled={checking}
              />
              {produceResult && !produceResult.accepted && (
                <p className="text-xs text-destructive">
                  Not quite — compare against the line above and try again.
                </p>
              )}
              <Button size="sm" onClick={() => void submitProduction()} disabled={checking || !produced.trim()}>
                {checking && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Check
              </Button>
            </div>
          )}

          <Button className="w-full" variant={produceResult?.accepted ? "default" : "outline"} onClick={next}>
            {idx + 1 >= items.length ? "Finish" : "Next"}
          </Button>
        </div>
      )}
    </div>
  );
}

interface MistakeCardProps {
  group: MistakeGroup;
  onDismiss: () => void;
  dismissing: boolean;
}

function MistakeCard({ group, onDismiss, dismissing }: MistakeCardProps) {
  // TTS is generated per card, so it's requested on demand rather than
  // synthesising every entry on the list the moment the page opens.
  const [requested, setRequested] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({
    text: group.target,
    dialect: group.dialect,
    skip: !requested,
  });

  useEffect(() => {
    if (!ttsUrl) return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = ttsUrl;
    void audio.play().catch(() => {
      /* Autoplay refusal isn't worth an error toast — the button is still there. */
    });
  }, [ttsUrl]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-2xl font-bold text-foreground break-words"
            style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
            dir="rtl"
          >
            {group.target}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{describeMistake(group)}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* "Why was that wrong?" is the whole point of this screen, so the
              seed carries the attempt as well as the target. */}
          <AskAISentence
            arabic={group.target}
            english={
              group.attempts.length
                ? `${describeMistake(group)} I said: ${group.attempts.join("، ")}`
                : describeMistake(group)
            }
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setRequested(true)}
            disabled={ttsLoading}
            title="Hear it said correctly"
          >
            {ttsLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Volume2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onDismiss}
            disabled={dismissing}
            title="I've got this now"
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* What actually came out. Omitted for sources with no utterance (quiz). */}
      {group.attempts.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground" dir="rtl">
          <span className="text-xs uppercase tracking-wide me-2" dir="ltr">
            You said
          </span>
          {group.attempts.join("، ")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {group.kinds.map((kind) => (
          <span
            key={kind}
            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300"
          >
            {labelForKind(kind)}
          </span>
        ))}
        {group.sources.map((source) => (
          <span
            key={source}
            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
          >
            {labelForSource(source)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default Mistakes;
