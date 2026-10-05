import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
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
import { DebriefPlanError, useDebriefPlan, useDebriefWordReview } from "@/hooks/useVideoDebrief";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useVoiceAnswer } from "@/hooks/useVoiceAnswer";
import { streamChat, SseChatError } from "@/lib/sseChat";
import { showCapToast } from "@/lib/handleCapResponse";
import { resolveDiscoverVideoAudioUrl } from "@/lib/vocabularyAudioContext";
import { cn } from "@/lib/utils";
import {
  nextStep,
  pendingCard,
  STEP_LABELS,
  stripStepMarker,
  toWireMessages,
  wordsToReview,
  type DebriefItem,
  type DebriefPlan,
  type DebriefStep,
  type QuizItem,
  type QuizOutcome,
  type ShadowOutcome,
} from "@/lib/videoDebrief";

/**
 * The post-video debrief: a guided conversation with the tutor about a video
 * the learner has just watched.
 *
 * The session is a short arc of steps — the gist, a few comprehension
 * questions, a quiz on the words the learner marked, one or two lines to
 * shadow, open questions, a recap — shown as a checklist across the top. The
 * tutor runs each step in the chat and says when its goal is met, which turns
 * into a Continue button; the learner can move on at any time regardless. The
 * quiz and the shadowing are cards inside the conversation, and what happens
 * on them is reported back to the tutor (`toWireMessages`), so it can react to
 * the words that were missed or the line that came out wrong.
 *
 * The tutor's knowledge of the video is the study guide the server holds for
 * it; this page only ever sends which video, which step, and the conversation.
 */

function SessionSummary({ plan, items, videoId }: { plan: DebriefPlan; items: DebriefItem[]; videoId: string }) {
  const quiz = items.find((item): item is Extract<DebriefItem, { kind: "quiz" }> => item.kind === "quiz");
  const review = wordsToReview(plan.quiz, quiz?.outcomes);
  const rescheduled = plan.quiz.some((q) => q.vocabularyId) && Boolean(quiz?.outcomes);
  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card p-4" data-testid="debrief-summary">
      <p className="font-semibold text-foreground">Session complete</p>
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
        <p className="mt-1 text-sm text-muted-foreground">Nice work — nothing left to go back over.</p>
      )}
      {rescheduled && (
        <p className="mt-1 text-xs text-muted-foreground">Your answers on saved words count as reviews in My Words.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={`/discover/${videoId}`}>Back to the video</Link>
        </Button>
        {review.some((q) => q.vocabularyId) && (
          <Button asChild variant="outline" size="sm">
            <Link to="/review/my-words">Review my words</Link>
          </Button>
        )}
        <Button asChild size="sm">
          <Link to="/discover">Watch another</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The server's refusal, shown even when the client believed the learner had
 * access — a lapsed subscription the one-minute check has not noticed yet,
 * say. `RequireSubscription` alone would render nothing in that case.
 */
function DebriefPaywall({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-sm py-16 text-center" data-testid="debrief-paywall">
      <p className="text-sm text-foreground">
        {message ?? "Talking a video through with the tutor is available on a paid plan."}
      </p>
      <Button asChild size="sm" className="mt-4">
        <Link to="/pricing">View plans</Link>
      </Button>
    </div>
  );
}

function DebriefSession({ videoId }: { videoId: string }) {
  const plan = useDebriefPlan(videoId);
  const { data: video } = useDiscoverVideo(videoId);
  const reviewWord = useDebriefWordReview();

  const [items, setItems] = useState<DebriefItem[]>([]);
  const itemsRef = useRef<DebriefItem[]>([]);
  const [step, setStep] = useState<DebriefStep | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<DebriefStep>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [failedStep, setFailedStep] = useState<DebriefStep | null>(null);
  const [paywalled, setPaywalled] = useState(false);
  const [finished, setFinished] = useState(false);
  const [input, setInput] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const startedRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const newId = () => `item-${++idRef.current}`;
  const commit = useCallback((next: DebriefItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const update = useCallback(
    (change: (prev: DebriefItem[]) => DebriefItem[]) => commit(change(itemsRef.current)),
    [commit],
  );

  useDocumentTitle(plan.data ? `Talk it through · ${plan.data.video.title}` : "Talk it through");

  // The native audio for the shadowing cards' acoustic score, when the video has one.
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

  // Leaving the page ends the turn in flight; nobody is there to read it.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [items, finished]);

  const runTutor = useCallback(
    async (turnStep: DebriefStep) => {
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
        const card = pendingCard(turnStep, after, planData);
        const cardItem: DebriefItem | null =
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
          functionName: "video-debrief",
          body: { action: "chat", videoId, step: turnStep, messages: toWireMessages(history) },
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
    [plan.data, videoId, update, commit],
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

  const advance = () => {
    if (!plan.data || !step || busy) return;
    setDoneSteps((prev) => new Set(prev).add(step));
    const next = nextStep(plan.data.steps, step);
    if (!next) {
      setFinished(true);
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
      <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="debrief-preparing">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Getting your session ready…</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The first time anyone talks through a video, the tutor reads it end to end. That takes a moment, once.
        </p>
      </div>
    );
  }

  if (plan.error || !plan.data) {
    const error = plan.error instanceof DebriefPlanError ? plan.error : null;
    if (error?.code === "subscription_required") return <DebriefPaywall message={error.message} />;
    return (
      <div className="mx-auto max-w-sm py-16 text-center" data-testid="debrief-error">
        <p className="text-sm text-foreground">{error?.message ?? "Couldn't prepare this session."}</p>
        <div className="mt-4 flex justify-center gap-2">
          {error?.code !== "no_transcript" && error?.status !== 404 && (
            <Button variant="outline" size="sm" onClick={() => plan.refetch()}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          )}
          <Button asChild size="sm">
            <Link to={`/discover/${videoId}`}>Back to the video</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (paywalled) return <DebriefPaywall />;

  const planData = plan.data;
  const stepComplete = step ? doneSteps.has(step) : false;
  const following = step ? nextStep(planData.steps, step) : null;
  const cardOpen = items.some(
    (item) => (item.kind === "quiz" && !item.outcomes) || (item.kind === "shadow" && !item.outcome),
  );
  const dialect = planData.video.dialect;

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <StepChecklist steps={planData.steps} current={finished ? null : step} done={doneSteps} labels={STEP_LABELS} />
      </div>

      <div className="flex-1 space-y-3 px-4 py-4" aria-live="polite">
        {items.map((item) => {
          switch (item.kind) {
            case "tutor":
              return (
                <div key={item.id} className="mr-6" data-testid="debrief-tutor-message">
                  {item.text ? (
                    <div className="prose prose-sm max-w-none rounded-lg bg-muted/50 px-3 py-2 text-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                      <TinyMarkdown
                        source={item.text}
                        renderArabicRun={(text) => <TappableArabicText text={text} source="video-debrief" inline />}
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
                <DebriefShadowCard
                  key={item.id}
                  line={line}
                  video={video ?? null}
                  audioUrl={audioUrl}
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

        {finished && <SessionSummary plan={planData} items={items} videoId={videoId} />}
        <div ref={threadEndRef} />
      </div>

      {!finished && (
        <div className="sticky bottom-0 border-t border-border bg-background px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {step ? `${STEP_LABELS[step]} · step ${planData.steps.indexOf(step) + 1} of ${planData.steps.length}` : ""}
            </span>
            <Button
              size="sm"
              variant={stepComplete ? "default" : "ghost"}
              className={cn(!stepComplete && "text-muted-foreground")}
              onClick={advance}
              disabled={busy || !step}
            >
              {following ? (stepComplete ? `Continue: ${STEP_LABELS[following]}` : "Skip to next step") : "Finish"}
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

const VideoDebrief = () => {
  const { videoId = "" } = useParams<{ videoId: string }>();
  const { data: video } = useDiscoverVideo(videoId);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to the video">
          <Link to={`/discover/${videoId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Talk it through</h1>
          {video?.title && <p className="truncate text-xs text-muted-foreground">{video.title}</p>}
        </div>
      </header>
      <RequireSubscription feature="video_debrief">
        <DebriefSession videoId={videoId} />
      </RequireSubscription>
    </div>
  );
};

export default VideoDebrief;
