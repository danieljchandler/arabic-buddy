import { useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCelebrationPrefs } from "@/hooks/useCelebrationPrefs";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import { useDialect } from "@/contexts/DialectContext";
import { createPlayableJingleAudio } from "@/lib/jingleAudio";
import { isSoundEnabled } from "@/lib/uiPrefs";
import {
  hasCelebrated,
  markCelebrated,
  singerName,
  type CelebrationEvent,
} from "@/lib/celebrationSong";

/**
 * One song at a time, and it outlives the page that asked for it: finishing a
 * lesson and navigating on should not cut the verse off, nor leave an orphaned
 * audio element behind.
 */
let singing: { audio: HTMLAudioElement; url: string; toastId: string | number } | null = null;

function stopSinging() {
  if (!singing) return;
  const { audio, url, toastId } = singing;
  singing = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  URL.revokeObjectURL(url);
  toast.dismiss(toastId);
}

async function sing(blob: Blob, name: string, lyrics: string | null) {
  stopSinging();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const toastId = toast(`A song for ${name}!`, {
    description: lyrics ?? undefined,
    duration: Infinity,
    action: { label: "Stop", onClick: stopSinging },
  });
  singing = { audio, url, toastId };
  audio.onended = stopSinging;
  audio.onerror = stopSinging;

  try {
    await audio.play();
  } catch (error) {
    if ((error as DOMException | undefined)?.name === "NotAllowedError") {
      // Safari and some mobile browsers refuse sound that does not start inside
      // a tap. Offer the tap instead of losing the song.
      toast(`A song for ${name}!`, {
        id: toastId,
        description: lyrics ?? undefined,
        duration: Infinity,
        action: { label: "Play", onClick: () => void audio.play().catch(stopSinging) },
      });
    } else {
      stopSinging();
    }
  }
}

/**
 * Sings the learner a celebration when they finish something.
 *
 * `celebrate` returns whether a song started, and never throws or reports a
 * failure to the learner: the song is a bonus, so a missing name, a switched-off
 * preference, a spent daily allowance or a provider outage all end the same way
 * — quietly, with the lesson or video they just finished still the main event.
 * An event that was attempted is remembered whether or not it worked, so a
 * failing function is not retried on every re-render.
 */
export function useCelebrationSong() {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { data: profile } = useProfileAvatar();
  const { enabled } = useCelebrationPrefs();
  const userId = user?.id;
  const displayName = profile?.displayName;

  return useCallback(
    async (event: CelebrationEvent): Promise<boolean> => {
      const name = singerName(displayName);
      // No name yet (profile still loading) is not an attempt: leaving the event
      // unmarked lets the next render, with the name, sing it.
      if (!userId || !enabled || !isSoundEnabled() || !name) return false;
      if (hasCelebrated(event)) return false;
      markCelebrated(event);

      try {
        const { data, error } = await supabase.functions.invoke("generate-celebration-song", {
          body: { name, dialect: activeDialect, achievement: { kind: event.kind } },
        });
        if (error || !data) return false;
        const file = await createPlayableJingleAudio(data);
        const lyrics = typeof data.lyrics === "string" && data.lyrics.trim() ? data.lyrics : null;
        await sing(file.blob, name, lyrics);
        return true;
      } catch {
        return false;
      }
    },
    [userId, enabled, displayName, activeDialect],
  );
}
