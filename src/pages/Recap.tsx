import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Mic, RotateCcw, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RequireSubscription } from "@/components/subscription/RequireSubscription";
import { TinyMarkdown } from "@/components/shared/TinyMarkdown";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { ThinkingBubble } from "@/components/assistant/ThinkingBubble";
import { NativeReviewNote } from "@/components/assistant/NativeReviewNote";
import { DebriefQuizCard } from "@/components/debrief/DebriefQuizCard";
import { DebriefShadowCard } from "@/components/debrief/DebriefShadowCard";
import { ListenButton, StepChecklist } from "@/components/debrief/SessionChrome";
import { useDiscoverVideo } from "@/hooks/useDiscoverVideos";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAddXP } from "@/hooks/useGamification";
import { RecapPlanError, useCompleteRecap, useRecapPlan } from "@/hooks/useRecap";
import { useDebriefWordReview } from "@/hooks/useVideoDebrief";
import { useVoiceAnswer } from "@/hooks/useVoiceAnswer";
import { streamChat, SseChatError } from "@/lib/sseChat";
import { showCapToast } from "@/lib/handleCapResponse";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { resolveDiscoverVideoAudioUrl } from "@/lib/vocabularyAudioContext";
import { cn } from "@/lib/utils";
import {
  nextRecapStep,
  pendingRecapCard,
  RECAP_STEP_LABELS,
  RECAP_TASK_ID,
  RECAP_XP,
  recapClock,
  recapOutcome,
  recapTitle,
  recapWordsToReview,
  stripStepMarker,
  toRecapWireMessages,
  windowLabel,
  type RecapItem,
  type RecapPlan,
  type RecapShadowLine,
  type RecapStep,
} from "@/lib/recap";
import type { QuizItem, QuizOutcome, ShadowOutcome } from "@/lib/videoDebrief";

/**
 * The daily recap: a guided conversation with the tutor over what the
 * learner did yesterday — or, when yesterday was empty, over the last week.
 *
 * The same shape of session as the post-video debrief, over a different set
 * of steps: your day (the tutor reads the learner's file back to them), tell
 * it back (retell the clip), your words (the quiz), fix a slip (the recorded
 * errors, one at a time), say it (shadow a line), recap. The tutor runs each
 * step in the chat and says when its goal is met, which turns into a Continue
 * button; the learner can move on at any time. The cards report back into
 * the conversation (`toRecapWireMessages`), so the tutor can react to a
 * missed word through the line it came from.
 *
 * The tutor's knowledge of the learner's day is the plan the server built
 * from the database; this page only ever sends which step and what was said.
 */

function SessionSummary({ plan, items }: { plan: RecapPlan; items: RecapItem[] }) {
  const quiz = items.find((item): item is Extract<RecapItem, { kind: "quiz" }> => item.kind === "quiz");
  const review = recapWordsToReview(plan.quiz, quiz?.outcomes);
  const rescheduled = plan.quiz.some((q) => q.vocabularyId) && Boolean(quiz?.outcomes);
  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card p-4" data-testid="recap-summary">
      <p className="font-semibold text-foreground">Recap complete</p>
      {review.length > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Keep working on:{" "}
          {review.map((q, i) => (
            <span key={q.arabic}>
              {i > 0 && ", "}
              <span dir="rtl" style={{ fontFamily: "var(--font-naskh)" }}>
                {q.arabic}
              </span>{" "}
              ({q.english})
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Nice work — nothing from {windowLabel(plan.windowDays)} slipped.</p>
      )}
      {rescheduled && (
        <p className="mt-1 text-xs text-muted-foreground">Your answers on saved words count as reviews in My Words.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/today">Back to today</Link>
        </Button>
        {review.some((q) => q.vocabularyId) && (
          <Button asChild variant="outline" size="sm">
            <Link to="/review/my-words">Review my words</Link>
          </Button>
        )}
        <Button asChild size="sm">
          <Link to="/discover">Watch something new</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The server's refusal, shown even when the client believed the learner had
 * access — a lapsed subscription the one-minute check has not noticed yet.
 */
function RecapPaywall({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-sm py-16 text-center" data-testid="recap-paywall">
      <p className="text-sm text-foreground">{message ?? "Going over your day with the tutor is available on a paid plan."}</p>
      <Button asChild size="sm" className="mt-4">
        <Link to="/pricing">View plans</Link>
      </Button>
    </div>
  );
}

/** One line to shadow, with the audio of the video it was said in. */
function RecapShadowCard({
  line,
  outcome,
  onDone,
}: {
  line: RecapShadowLine;
  outcome?: ShadowOutcome;
  onDone: (outcome: ShadowOutcome) => void;
}) {
  const { data: video } = useDiscoverVideo(line.videoId);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    resolveDiscoverVideoAudioUrl(video)
      .then((url) => {
        if (!cancelled) setAudioUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video]);
  return <DebriefShadowCard line={line} video={video ?? null} audioUrl={audioUrl} outcome={outcome} onDone={onDone} />;
}

function RecapSession() {
  const plan = useRecapPlan();
  const reviewWord = useDebriefWordReview();
  const complete = useCompleteRecap();
  const addXp = useAddXP();

  const [items, setItems] = useState<RecapItem[]>([]);
  const itemsRef = useRef<RecapItem[]>([]);
  const [step, setStep] = useState<RecapStep | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<RecapStep>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [failedStep, setFailedStep] = useState<RecapStep | null>(null);
  const [paywalled, setPaywalled] = useState(false);
  const [finished, setFinished] = useState(false);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const startedRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const newId = () => `item-${++idRef.current}`;
  const commit = useCallback((next: RecapItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const update = useCallback(
    (change: (prev: RecapItem[]) => RecapItem[]) => commit(change(itemsRef.current)),
    [commit],
  );

  useDocumentTitle(plan.data ? recapTitle(plan.data.windowDays) : "Your recap");

  // Leaving the page ends the turn in flight; nobody is there to read it.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [items, finished]);

  const runTutor = useCallback(
    async (turnStep: RecapStep) => {
      const planData = plan.data;
      if (!planData) return;
      const history = itemsRef.current;
      const id = `item-${++idRef.current}`;
      update((prev) => [...prev, { kind: "tutor", id, step: turnStep, text: "", streaming: true }]);
      setBusy(true);
      setFailedStep(null);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      let settled = false;
      const settle = (full: string) => {
        if (settled) return;
        settled = true;
        const { text, done } = stripStepMarker(full);
        const after = itemsRef.current.map((item) =>
          item.id === id && item.kind === "tutor" ? { ...item, text, streaming: false } : item,
        );
        // A card the step still owes the learner comes first, even if the
        // tutor thought it had finished: the quiz is the point of that step.
        const card = pendingRecapCard(turnStep, after, planData);
        const cardItem: RecapItem | null =
          card?.kind === "quiz"
            ? { kind: "quiz", id: `item-${++idRef.current}`, step: turnStep }
            : card?.kind === "shadow"
              ? { kind: "shadow", id: `item-${++idRef.current}`, step: turnStep, lineIndex: card.lineIndex }
              : null;
        commit(cardItem ? [...after, cardItem] : after);
        if (done && !cardItem) setDoneSteps((prev) => new Set(prev).add(turnStep));
        setBusy(false);
      };

      try {
        const full = await streamChat({
          functionName: "daily-recap",
          body: {
            action: "chat",
            dialect: planData.dialect,
            ...recapClock(),
            step: turnStep,
            messages: toRecapWireMessages(history),
          },
          signal: controller.signal,
          onDelta: (_delta, accumulated) =>
            update((prev) =>
              prev.map((item) =>
                item.id === id && item.kind === "tutor" ? { ...item, text: stripStepMarker(accumulated).text } : item,
              ),
            ),
          onContentComplete: settle,
          onNativeReview: (review) =>
            update((prev) => prev.map((item) => (item.id === id && item.kind === "tutor" ? { ...item, review } : item))),
        });
        settle(full);
      } catch (err) {
        // The answer was already in and only its native review was cut off —
        // by the learner's next message, usually. Nothing to undo.
        if (settled) return;
        settled = true;
        // Keep whatever arrived; drop a turn that produced nothing.
        update((prev) =>
          prev
            .map((item) => (item.id === id && item.kind === "tutor" ? { ...item, streaming: false } : item))
            .filter((item) => !(item.id === id && item.kind === "tutor" && !item.text.trim())),
        );
        // A newer turn owns the busy flag now; leave it alone.
        if (abortRef.current !== controller) return;
        setBusy(false);
        if (controller.signal.aborted) return;
        if (err instanceof SseChatError) {
          if (err.status === 403) {
            setPaywalled(true);
            return;
          }
          if (err.status === 429) {
            const body = err.body as { message?: string; limit?: number; error?: string } | null;
            if (body?.message || body?.limit) showCapToast(body);
            else toast.error(body?.error ?? "The tutor is busy — try again in a moment.");
          } else if (err.status === 402) {
            toast.error("AI credits exhausted");
          }
        }
        setFailedStep(turnStep);
      }
    },
    [plan.data, update, commit],
  );

  // Open the session once the plan is in.
  useEffect(() => {
    if (!plan.data || startedRef.current) return;
    startedRef.current = true;
    const first = plan.data.steps[0];
    setStep(first);
    void runTutor(first);
  }, [plan.data, runTutor]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !step || busy) return;
    setInput("");
    update((prev) => [...prev, { kind: "learner", id: newId(), step, text: trimmed }]);
    void runTutor(step);
  };

  const finish = (done: Set<RecapStep>) => {
    setFinished(true);
    markTaskCompletedToday(RECAP_TASK_ID);
    complete.mutate(recapOutcome(itemsRef.current, done), {
      onError: () => {
        // The session happened; the record of it is a nicety.
      },
    });
    addXp.mutate({ amount: RECAP_XP, reason: "recap" }, { onError: () => {} });
  };

  const advance = () => {
    if (!plan.data || !step || busy) return;
    const done = new Set(doneSteps).add(step);
    setDoneSteps(done);
    const next = nextRecapStep(plan.data.steps, step);
    if (!next) {
      finish(done);
      return;
    }
    setStep(next);
    void runTutor(next);
  };

  const finishQuiz = (itemId: string, outcomes: QuizOutcome[]) => {
    if (!step) return;
    update((prev) => prev.map((item) => (item.id === itemId && item.kind === "quiz" ? { ...item, outcomes } : item)));
    void runTutor(step);
  };

  const answerWord = (quizItem: QuizItem, correct: boolean) => {
    if (!quizItem.vocabularyId) return;
    reviewWord(quizItem, correct).catch(() => {
      // The quiz goes on; a review that did not save is not worth interrupting it for.
    });
  };

  const finishShadow = (itemId: string, outcome: ShadowOutcome) => {
    if (!step) return;
    update((prev) => prev.map((item) => (item.id === itemId && item.kind === "shadow" ? { ...item, outcome } : item)));
    void runTutor(step);
  };

  const retry = () => {
    if (failedStep) void runTutor(failedStep);
  };

  const voice = useVoiceAnswer(useCallback((text: string) => setInput((prev) => (prev ? `${prev} ${text}` : text)), []));

  if (plan.isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="recap-preparing">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Reading your notes…</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The tutor is going through what you watched, saved and practised. A clip nobody has talked through yet takes a moment longer.
        </p>
      </div>
    );
  }

  if (plan.error || !plan.data) {
    const error = plan.error instanceof RecapPlanError ? plan.error : null;
    if (error?.code === "subscription_required") return <RecapPaywall message={error.message} />;
    const nothing = error?.code === "nothing_to_recap";
    return (
      <div className="mx-auto max-w-sm py-16 text-center" data-testid="recap-error">
        <p className="text-sm text-foreground">{error?.message ?? "Couldn't prepare your recap."}</p>
        <div className="mt-4 flex justify-center gap-2">
          {!nothing && (
            <Button variant="outline" size="sm" onClick={() => plan.refetch()}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          )}
          <Button asChild size="sm">
            <Link to={nothing ? "/discover" : "/today"}>{nothing ? "Watch a clip" : "Back to today"}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (paywalled) return <RecapPaywall />;

  const planData = plan.data;
  const stepComplete = step ? doneSteps.has(step) : false;
  const following = step ? nextRecapStep(planData.steps, step) : null;
  const cardOpen = items.some(
    (item) => (item.kind === "quiz" && !item.outcomes) || (item.kind === "shadow" && !item.outcome),
  );
  const dialect = planData.dialect;

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <StepChecklist steps={planData.steps} current={finished ? null : step} done={doneSteps} labels={RECAP_STEP_LABELS} />
      </div>

      <div className="flex-1 space-y-3 px-4 py-4" aria-live="polite">
        {planData.status === "completed" && !finished && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="recap-already-done">
            You already went over {windowLabel(planData.windowDays)} today. Going again is fine — the tutor remembers nothing of the first run.
          </p>
        )}
        {items.map((item) => {
          switch (item.kind) {
            case "tutor":
              return (
                <div key={item.id} className="mr-6" data-testid="recap-tutor-message">
                  {item.text ? (
                    <div className="prose prose-sm max-w-none rounded-lg bg-muted/50 px-3 py-2 text-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                      <TinyMarkdown
                        source={item.text}
                        renderArabicRun={(text) => <TappableArabicText text={text} source="daily-recap" inline />}
                      />
                      {!item.streaming && (
                        <div className="mt-1.5">
                          <ListenButton text={item.text} dialect={dialect} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <ThinkingBubble />
                  )}
                  {item.review && <NativeReviewNote review={item.review} />}
                </div>
              );
            case "learner":
              return (
                <div key={item.id} dir="auto" className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">
                  {item.text}
                </div>
              );
            case "quiz":
              return (
                <DebriefQuizCard
                  key={item.id}
                  items={planData.quiz}
                  outcomes={item.outcomes}
                  onAnswer={answerWord}
                  onComplete={(outcomes) => finishQuiz(item.id, outcomes)}
                />
              );
            case "shadow": {
              const line = planData.shadow[item.lineIndex];
              if (!line) return null;
              return (
                <RecapShadowCard
                  key={item.id}
                  line={line}
                  outcome={item.outcome}
                  onDone={(outcome) => finishShadow(item.id, outcome)}
                />
              );
            }
          }
        })}

        {failedStep && !busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>The tutor didn't answer.</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        )}

        {finished && <SessionSummary plan={planData} items={items} />}
        <div ref={threadEndRef} />
      </div>

      {!finished && (
        <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {step
                ? `${RECAP_STEP_LABELS[step]} · step ${planData.steps.indexOf(step) + 1} of ${planData.steps.length}`
                : ""}
            </span>
            <Button
              size="sm"
              variant={stepComplete ? "default" : "ghost"}
              className={cn(!stepComplete && "text-muted-foreground")}
              onClick={advance}
              disabled={busy || !step}
            >
              {following
                ? stepComplete
                  ? `Continue: ${RECAP_STEP_LABELS[following]}`
                  : "Skip to next step"
                : "Finish"}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              placeholder={cardOpen ? "Finish the card above first" : "Type or say your answer…"}
              disabled={cardOpen}
              dir="auto"
              rows={1}
              className="min-h-[40px] resize-none"
              aria-label="Your answer"
            />
            <Button
              type="button"
              size="icon"
              variant={voice.recording ? "destructive" : "outline"}
              onClick={voice.recording ? voice.stop : voice.start}
              disabled={cardOpen || voice.transcribing}
              aria-label={voice.recording ? "Stop recording" : "Answer by voice"}
            >
              {voice.transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : voice.recording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button type="submit" size="icon" disabled={busy || cardOpen || !input.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

const Recap = () => {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to today">
          <Link to="/today">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Your recap</h1>
          <p className="truncate text-xs text-muted-foreground">What you did, gone over with the tutor</p>
        </div>
      </header>
      <RequireSubscription feature="daily_recap">
        <RecapSession />
      </RequireSubscription>
    </div>
  );
};

export default Recap;
