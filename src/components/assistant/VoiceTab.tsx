import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertCircle, Crown, Loader2, Mic, MicOff, Phone, PhoneOff, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useOpenAIRealtime } from "@/hooks/useOpenAIRealtime";
import { buildPagePayload } from "@/lib/pageAiContext";
import { serializeFocusUpdate } from "../../../supabase/functions/_shared/pageContextCore";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { cn } from "@/lib/utils";
import { LiveOrb } from "@/components/assistant/LiveOrb";

/**
 * Live voice mode of the Ask AI assistant — subscribers only (the server
 * enforces it; the gate here is the honest UI for everyone else). Unlike the
 * text conversation panel this does NOT auto-start: a voice call costs
 * real money per minute, so it waits for an explicit tap.
 */
export function VoiceTab() {
  const { seed, pageContext } = useAiAssistant();
  const { activeDialect } = useDialect();
  const { user, loading: authLoading } = useAuth();
  const { subscribed, loading: subLoading } = useSubscription();
  const { pathname } = useLocation();
  const { status, error, turns, muted, setMuted, start, stop, updateContext, remainingSeconds, remoteStream } =
    useOpenAIRealtime();

  // Closing the panel or switching tabs unmounts this component; the call must
  // not keep running (and billing) with no UI attached to it.
  useEffect(() => () => stop(), [stop]);

  // The transcript is written by the call, not by the learner, so it has to
  // follow the speaking on its own — otherwise the newest turn lands out of
  // sight and you're scrolling to keep up with a live conversation. Unless
  // they've scrolled back to read something, in which case leave them there.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  const contextPayload = useMemo(() => {
    const page = buildPagePayload(pathname, pageContext);
    if (!seed) return page;
    // The sentence they opened the call about is a note on the page, not a
    // replacement for it — they may well ask about both.
    const opener = `The learner opened this call about the sentence: ${seed.arabic}${
      seed.english ? ` (${seed.english})` : ""
    }`;
    return { ...page, meta: { ...page.meta, notes: [opener, ...(page.meta?.notes ?? [])] } };
  }, [pathname, pageContext, seed]);

  // Keep the payload readable by the effect below without making that effect
  // re-run on every unrelated re-render.
  const contextRef = useRef(contextPayload);
  contextRef.current = contextPayload;

  /**
   * Push the learner's position into a call already in progress.
   *
   * Without this the tutor is frozen at whatever was on screen when the call
   * connected: two minutes into a video the learner is on line 40 and it is
   * still answering about line 3. The document went out with the session's
   * instructions, so only the moving parts are re-sent.
   *
   * Throttled, and only on a real change — a video advancing a subtitle every
   * few seconds would otherwise stuff the conversation with notes.
   */
  const lastSentRef = useRef<{ note: string; at: number }>({ note: "", at: 0 });
  const live = status === "live";

  useEffect(() => {
    if (!live) {
      lastSentRef.current = { note: "", at: 0 };
      return;
    }
    const note = serializeFocusUpdate(contextRef.current);
    if (!note || note === lastSentRef.current.note) return;

    const MIN_GAP_MS = 4000;
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSentRef.current.at));
    const timer = setTimeout(() => {
      // Re-read at fire time: during the wait the learner may have moved on
      // again, and the newest position is the only one worth sending.
      const fresh = serializeFocusUpdate(contextRef.current);
      if (!fresh || fresh === lastSentRef.current.note) return;
      if (updateContext(fresh, contextRef.current)) {
        lastSentRef.current = { note: fresh, at: Date.now() };
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [live, contextPayload, updateContext]);

  if (!user && !authLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Sign in to talk to the AI tutor.</p>
        <Button asChild size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (subLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!subscribed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Crown className="h-6 w-6 text-amber-500" />
        <p className="text-sm font-medium">Live voice is a premium feature</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Talk to the AI tutor about anything on your screen — real conversation, in dialect,
          hands-free. Available on any paid plan.
        </p>
        <Button asChild size="sm">
          <Link to="/pricing">See plans</Link>
        </Button>
      </div>
    );
  }

  const connecting = status === "connecting";

  return (
    <>
      {/* Full screen buys room; a call transcript is the thing most worth
          spending it on, since it's the only record of what was said. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn(
          "min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm",
          "group-data-[snap=cover]/panel:space-y-3 group-data-[snap=cover]/panel:px-5 group-data-[snap=cover]/panel:py-4",
          "group-data-[snap=cover]/panel:text-[15px]",
        )}
      >
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {turns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8">
            {/* The orb belongs to the call, so it appears when the call does —
                the idle tab is just an invitation, the way a phone app shows
                no waveform until you dial. */}
            {(live || connecting) && (
              <LiveOrb
                stream={remoteStream}
                active={live}
                muted={muted}
                className={cn("h-24 w-24 animate-scale-in motion-reduce:animate-none", connecting && "opacity-60")}
              />
            )}
            <p className="text-center text-xs text-muted-foreground">
              {live
                ? "Just start speaking…"
                : connecting
                ? "Setting up the call…"
                : "Start a call and ask about anything on this page."}
            </p>
          </div>
        ) : (
          turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2",
                t.role === "user"
                  ? "ml-auto max-w-[85%] bg-primary/10"
                  : "max-w-[85%] border border-border bg-background",
                t.partial && "opacity-70",
              )}
            >
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t.role === "user" ? "You" : "Tutor"}
              </div>
              {t.role === "assistant" ? (
                <TappableArabicText text={t.text} source="ask-ai-voice" />
              ) : (
                <div dir="auto" className="leading-snug">{t.text}</div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t p-3">
        <div className="flex items-center justify-center gap-3">
          {live || connecting ? (
            <>
              {/* Once the transcript starts, the big orb above is replaced by
                  the turns — so the call keeps a small one down here, beside
                  the controls, which is the one part of the tab that never
                  scrolls away. It is the same component and the same analyser,
                  so it goes on answering the tutor's voice for the whole call. */}
              <LiveOrb
                stream={remoteStream}
                active={live}
                muted={muted}
                className="h-10 w-10 shrink-0"
              />
              <Button
                variant={muted ? "default" : "outline"}
                size="icon"
                onClick={() => setMuted(!muted)}
                disabled={!live}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
              <Button variant="destructive" onClick={() => stop()} className="gap-2">
                <PhoneOff className="h-4 w-4" />
                End call
              </Button>
            </>
          ) : (
            <Button
              onClick={() =>
                start({
                  dialect: activeDialect,
                  difficulty: "intermediate",
                  mode: "assistant",
                  pageContext: contextPayload,
                })
              }
              className="gap-2"
            >
              <Phone className="h-4 w-4" />
              Start voice call
            </Button>
          )}
          {connecting && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {live && (
            <Radio className={cn("h-4 w-4", muted ? "text-muted-foreground" : "animate-pulse text-primary")} />
          )}
        </div>
        <p className="text-center text-[11px] text-muted-foreground">
          {typeof remainingSeconds === "number" && (
            <>
              <span className={cn(remainingSeconds < 300 && "font-medium text-amber-600 dark:text-amber-500")}>
                {Math.floor(remainingSeconds / 60)} min left this month
              </span>
              {" · "}
            </>
          )}
          The tutor knows what's on your screen. Voice powered by ChatGPT Realtime.
        </p>
      </div>
    </>
  );
}
