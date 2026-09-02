import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { LevelMeter } from "@/components/pronunciation/LevelMeter";
import { useMonologueRecorder } from "@/hooks/useMonologueRecorder";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { supabase } from "@/integrations/supabase/client";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import {
  formatClock,
  latestDelta,
  metricValue,
  taskSpecForLevel,
  TREND_METRICS,
} from "@/lib/monologueTasks";
import {
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  Mic,
  Minus,
  RefreshCw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { markTaskCompletedToday } from "@/lib/todayCompletion";

/**
 * Monologue — spoken production, measured over time.
 *
 * The learner talks freely to a prompt for a level-scaled stretch; the take is
 * transcribed with word timings and measured (speech rate, articulation rate,
 * run length, pauses) by `score-monologue`. Deliberately no score and no
 * pass/fail: no Arabic fluency norms exist to band against, so the honest
 * product is the learner's own trend — this attempt against their last ones.
 * The target length is an aim, not a gate; stopping early is fine and is
 * itself recorded.
 */

interface MonologuePrompt {
  topic_english: string;
  prompt_arabic: string;
  prompt_transliteration: string;
  prompt_english: string;
}

interface MonologueFeedback {
  verdict: string;
  rewrite_original: string | null;
  rewrite_arabic: string | null;
  rewrite_english: string | null;
  fossil_targets: string[];
}

interface ScoreResult {
  attemptId: string | null;
  transcript: string;
  wordCount: number;
  metrics: Record<string, unknown> | null;
  feedback: MonologueFeedback | null;
  provider: string;
  timingsAvailable: boolean;
}

interface AttemptRow {
  id: string;
  created_at: string;
  metrics: unknown;
  timings_available: boolean;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const Monologue = () => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { placementLevel } = useUserLevel();
  const queryClient = useQueryClient();
  const spec = useMemo(() => taskSpecForLevel(placementLevel), [placementLevel]);

  const [prompts, setPrompts] = useState<MonologuePrompt[]>([]);
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [showGloss, setShowGloss] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);

  const recorder = useMonologueRecorder();
  const prompt = prompts[promptIndex] ?? null;
  // The spec the recording was started under, so a level change mid-take
  // cannot retarget it.
  const capRef = useRef(spec.hardCapSeconds);

  const loadPrompts = useCallback(async () => {
    setPromptsLoading(true);
    setResult(null);
    setPromptIndex(0);
    setShowGloss(false);
    const { data, error } = await supabase.functions.invoke("monologue-prompts", {
      body: { dialect: activeDialect, count: spec.promptCount, level: placementLevel },
    });
    if (showCapToastIfLimited(error, data)) {
      setPrompts([]);
    } else if (!error && Array.isArray(data?.prompts) && data.prompts.length > 0) {
      setPrompts(data.prompts as MonologuePrompt[]);
    } else {
      setPrompts([]);
      toast.error("Couldn't load a prompt — try again.");
    }
    setPromptsLoading(false);
  }, [activeDialect, spec.promptCount, placementLevel]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const attemptsQuery = useQuery({
    queryKey: ["monologue-attempts", user?.id, activeDialect],
    enabled: !!user,
    queryFn: async (): Promise<AttemptRow[]> => {
      const { data, error } = await supabase
        .from("monologue_attempts")
        .select("id, created_at, metrics, timings_available")
        .eq("user_id", user!.id)
        .eq("dialect", activeDialect)
        .order("created_at", { ascending: true })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as AttemptRow[];
    },
  });

  const submitTake = useCallback(
    async (blob: Blob, durationMs: number) => {
      setScoring(true);
      try {
        const audioBase64 = await blobToBase64(blob);
        const { data, error } = await supabase.functions.invoke("score-monologue", {
          body: {
            audioBase64,
            mimeType: blob.type || "audio/webm",
            dialect: activeDialect,
            promptText: prompt?.prompt_arabic ?? null,
            durationMs,
          },
        });
        if (showCapToastIfLimited(error, data)) return;
        if (error || typeof data?.transcript !== "string") {
          toast.error("Couldn't analyse that take — try again.");
          return;
        }
        setResult(data as ScoreResult);
        // A scored attempt is the day's speaking task done, whichever surface
        // the queue pointed at.
        markTaskCompletedToday("speaking");
        void queryClient.invalidateQueries({ queryKey: ["monologue-attempts"] });
      } finally {
        setScoring(false);
      }
    },
    [activeDialect, prompt, queryClient],
  );

  const startRecording = useCallback(() => {
    setResult(null);
    capRef.current = spec.hardCapSeconds;
    void recorder.start({
      maxDurationMs: spec.hardCapSeconds * 1000,
      onComplete: (blob, reason, durationMs) => {
        if (!blob || reason === "no-audio") {
          toast.error("We didn't hear anything — check your microphone and try again.");
          return;
        }
        void submitTake(blob, durationMs);
      },
    });
  }, [recorder, spec.hardCapSeconds, submitTake]);

  usePageAiContext(
    useMemo(
      () => ({
        kind: "page" as const,
        title: "Monologue practice",
        summary: `Recording a spoken ${activeDialect} monologue and tracking fluency trends.`,
        content: [
          prompt && `Prompt: ${prompt.prompt_arabic} — ${prompt.prompt_english}`,
          result?.transcript && `Learner said: ${result.transcript}`,
        ]
          .filter(Boolean)
          .join("\n"),
      }),
      [activeDialect, prompt, result],
    ),
  );

  const elapsedSeconds = Math.floor(recorder.elapsedMs / 1000);
  const attempts = attemptsQuery.data ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Monologue</h1>
            <p className="text-sm text-muted-foreground">
              Talk for a stretch, watch your fluency move.
            </p>
          </div>
          <PageCorner />
        </div>

        {/* Prompt */}
        {promptsLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding you something to talk about…
          </div>
        ) : prompt ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {prompt.topic_english}
              </p>
              <span className="text-xs text-muted-foreground">
                aim for ~{formatClock(spec.targetSeconds)}
              </span>
            </div>
            <p dir="rtl" className="mt-2 font-arabic text-xl leading-relaxed">
              {prompt.prompt_arabic}
            </p>
            {showGloss && (
              <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                <p>{prompt.prompt_transliteration}</p>
                <p>{prompt.prompt_english}</p>
              </div>
            )}
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => setShowGloss((s) => !s)}
              >
                {showGloss ? "Hide translation" : "Show translation"}
              </button>
              {prompts.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setPromptIndex((i) => (i + 1) % prompts.length);
                    setResult(null);
                  }}
                >
                  Next topic
                </button>
              )}
              <button
                type="button"
                className="ms-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => void loadPrompts()}
              >
                <RefreshCw className="mr-1 inline h-3 w-3" />
                New prompts
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Couldn't load a prompt. Talk about your day — the recorder works anyway.
          </div>
        )}

        {/* Recorder */}
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          {recorder.isRecording ? (
            <>
              <p className="font-mono text-3xl tabular-nums">{formatClock(elapsedSeconds)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                target {formatClock(spec.targetSeconds)} · stop whenever you're done
              </p>
              <LevelMeter level={recorder.level} className="mx-auto mt-4 max-w-xs" />
              <Button
                variant="destructive"
                size="lg"
                className="mt-4"
                onClick={() => recorder.stop()}
                aria-label="Stop recording"
              >
                <Square className="mr-2 h-4 w-4" /> Stop
              </Button>
            </>
          ) : scoring ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Listening back and measuring…
            </div>
          ) : (
            <>
              <Button
                size="lg"
                onClick={startRecording}
                disabled={promptsLoading}
                aria-label="Start recording"
              >
                <Mic className="mr-2 h-4 w-4" /> Start talking
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Pauses are fine — thinking time is part of what's measured.
              </p>
              {recorder.permissionDenied && (
                <p className="mt-2 text-xs text-red-600">
                  Microphone access is blocked — allow it in your browser to record.
                </p>
              )}
            </>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium">What we heard</p>
            <p dir="rtl" className="font-arabic text-lg leading-relaxed">
              {result.transcript || "—"}
            </p>
            {result.timingsAvailable && result.metrics ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TREND_METRICS.map((def) => {
                  const value = metricValue(result.metrics, def.key);
                  return (
                    <div key={def.key} className="rounded-lg border border-border/60 p-3 text-center">
                      <p className="text-lg font-semibold tabular-nums">
                        {value === null ? "—" : value.toFixed(1)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {def.label} ({def.unit})
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Timing analysis wasn't available for this take, so only the transcript was saved.
              </p>
            )}
            {result.timingsAvailable && result.metrics ? (
              <p className="text-xs text-muted-foreground">
                {result.wordCount} words
                {typeof result.metrics.repetitionCount === "number" &&
                  result.metrics.repetitionCount > 0 &&
                  ` · ${result.metrics.repetitionCount} repeated word${result.metrics.repetitionCount === 1 ? "" : "s"}`}
                {typeof result.metrics.longPauseCount === "number" &&
                  result.metrics.longPauseCount > 0 &&
                  ` · ${result.metrics.longPauseCount} long pause${result.metrics.longPauseCount === 1 ? "" : "s"}`}
              </p>
            ) : null}

            {/* Content feedback — one salient thing, not a red-pen pass. */}
            {result.feedback && (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <p className="text-sm">{result.feedback.verdict}</p>
                {result.feedback.rewrite_arabic && result.feedback.rewrite_original && (
                  <div className="rounded-lg bg-emerald-500/10 p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      One thing to polish
                    </p>
                    <p dir="rtl" className="mt-1 font-arabic">
                      <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                        {result.feedback.rewrite_original}
                      </span>
                      <span className="mx-2 text-muted-foreground">←</span>
                      <span className="font-semibold">{result.feedback.rewrite_arabic}</span>
                    </p>
                    {result.feedback.rewrite_english && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result.feedback.rewrite_english}
                      </p>
                    )}
                  </div>
                )}
                {result.feedback.fossil_targets.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    From your mistake list, you used:{" "}
                    <span dir="rtl" className="font-arabic">
                      {result.feedback.fossil_targets.join("، ")}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Trends */}
        {attempts.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium">Your trend</p>
            <p className="text-xs text-muted-foreground">
              Last {attempts.length} attempt{attempts.length === 1 ? "" : "s"} in {activeDialect} —
              measured against yourself, not a standard.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TREND_METRICS.map((def) => {
                const values = attempts.map((a) => metricValue(a.metrics, def.key));
                const clean = values.filter((v): v is number => v !== null);
                const latest = clean.length > 0 ? clean[clean.length - 1] : null;
                const delta = latestDelta(values);
                const improving =
                  delta === null || delta === 0
                    ? null
                    : (delta > 0) === (def.goodDirection === "up");
                return (
                  <div key={def.key} className="rounded-lg border border-border/60 p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <p className="text-lg font-semibold tabular-nums">
                        {latest === null ? "—" : latest.toFixed(1)}
                      </p>
                      {delta !== null && delta !== 0 && (
                        improving ? (
                          <ArrowUpRight aria-label="improving" className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <ArrowDownRight aria-label="declining" className="h-4 w-4 text-amber-600" />
                        )
                      )}
                      {delta === 0 && <Minus aria-label="steady" className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {def.label} ({def.unit})
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Monologue;
