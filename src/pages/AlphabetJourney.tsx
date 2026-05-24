import { useNavigate } from "react-router-dom";
import { ARABIC_LETTERS, CHECKPOINT_INDICES } from "@/data/arabicAlphabet";
import { useAlphabetProgress, useCheckpointProgress } from "@/hooks/useAlphabetProgress";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { InfoHint } from "@/components/InfoHint";
import { Lock, Check, Flag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const AlphabetJourney = () => {
  const navigate = useNavigate();
  const { progress, isUnlocked, masteredCount } = useAlphabetProgress();
  const { checkpoints } = useCheckpointProgress();

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <HomeButton />
        <p className="text-xs text-muted-foreground">
          {masteredCount} / 28 mastered
        </p>
      </div>

      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>
          Alphabet Journey 🐪
          <InfoHint
            title="Alphabet Journey"
            body="A 28-stop caravan through the Arabic alphabet. Each stop is a 3-minute mini-lesson: meet the letter, hear it, trace it, see its four shapes, then two quick games. Master one to unlock the next."
          />
        </h1>
        <p
          className="text-3xl text-primary mt-2"
          style={{ fontFamily: "'Noto Sans Arabic', serif" }}
          dir="rtl"
        >
          أ ب ت ث
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Tap a stop to begin. The trail unlocks letter by letter.
        </p>
      </header>

      <div className="relative">
        {/* Vertical trail line */}
        <div className="absolute left-1/2 top-6 bottom-6 w-0.5 bg-gradient-to-b from-primary/40 via-primary/20 to-primary/10 -translate-x-1/2 rounded-full" />

        <div className="relative space-y-3">
          {ARABIC_LETTERS.map((letter) => {
            const row = progress[letter.code];
            const unlocked = isUnlocked(letter.order_index);
            const mastered = !!row?.mastered_at;
            const stepsCompleted = row?.steps_completed?.length ?? 0;
            const isLeft = letter.order_index % 2 === 0;
            const isCheckpointAfter = CHECKPOINT_INDICES.includes(letter.order_index);
            const checkpointIdx = CHECKPOINT_INDICES.indexOf(letter.order_index);

            return (
              <div key={letter.code}>
                <button
                  onClick={() => unlocked && navigate(`/alphabet/${letter.code}`)}
                  disabled={!unlocked}
                  className={cn(
                    "w-full flex items-center gap-3",
                    isLeft ? "flex-row" : "flex-row-reverse",
                  )}
                >
                  {/* Side label */}
                  <div className={cn("flex-1 px-3", isLeft ? "text-right" : "text-left")}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Stop {letter.order_index + 1}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {letter.name_translit}
                    </p>
                    {unlocked && !mastered && stepsCompleted > 0 && (
                      <p className="text-[10px] text-primary mt-0.5">
                        {stepsCompleted}/6 steps
                      </p>
                    )}
                  </div>

                  {/* Stop node */}
                  <div
                    className={cn(
                      "relative h-16 w-16 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                      mastered && "bg-green-500/15 border-green-500 shadow-md",
                      !mastered && unlocked && "bg-card border-primary hover:border-primary/80 hover:shadow-md active:scale-95",
                      !unlocked && "bg-muted border-muted-foreground/20 opacity-60",
                    )}
                  >
                    {!unlocked ? (
                      <Lock className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <span
                        className={cn(
                          "text-3xl",
                          mastered ? "text-green-700" : "text-primary",
                        )}
                        style={{ fontFamily: "'Noto Sans Arabic', serif", lineHeight: 1 }}
                      >
                        {letter.isolated}
                      </span>
                    )}
                    {mastered && (
                      <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-green-500 text-white flex items-center justify-center">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>

                  {/* Spacer */}
                  <div className="flex-1" />
                </button>

                {/* Checkpoint marker */}
                {isCheckpointAfter && checkpointIdx >= 0 && (
                  <button
                    onClick={() => navigate(`/alphabet/checkpoint/${checkpointIdx}`)}
                    disabled={!mastered}
                    className={cn(
                      "mt-3 w-full p-3 rounded-2xl border-2 flex items-center justify-center gap-2 transition-all",
                      mastered
                        ? checkpoints[checkpointIdx]
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 animate-pulse"
                        : "border-muted bg-muted/30 opacity-60",
                    )}
                  >
                    {checkpoints[checkpointIdx] ? (
                      <Trophy className="h-5 w-5 text-amber-600" />
                    ) : (
                      <Flag className="h-5 w-5 text-amber-600" />
                    )}
                    <span className="font-bold text-foreground">
                      Caravan Checkpoint {checkpointIdx + 1}
                    </span>
                    {checkpoints[checkpointIdx] && (
                      <span className="text-xs text-amber-700 ml-2">
                        {checkpoints[checkpointIdx].score}%
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
};

export default AlphabetJourney;
