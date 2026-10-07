/**
 * Client half of the personalised celebration songs: which finish lines sing,
 * and the memory that stops one sounding twice.
 *
 * The song is a bonus that costs real money per generation, so the rule is one
 * song per *thing finished* — a lesson, a video, a debrief, a day's tasks —
 * never one per render, per replay or per reload.
 */

export type CelebrationKind =
  | "lesson_complete"
  | "daily_tasks_complete"
  | "video_complete"
  | "review_conversation_complete"
  | "badge_earned";

export interface CelebrationEvent {
  kind: CelebrationKind;
  /**
   * What was finished: a lesson or video id, or the local date for the day's
   * tasks. For a badge, the badge's id: the song function reads the badge
   * itself and only sings one the caller holds.
   */
  entityId: string;
}

/**
 * The `achievement` the song function is asked to sing about. A badge is named
 * by id and nothing else; every other kind is the kind alone.
 */
export function songAchievement(event: CelebrationEvent): { kind: CelebrationKind; badgeId?: string } {
  return event.kind === "badge_earned" ? { kind: event.kind, badgeId: event.entityId } : { kind: event.kind };
}

const SEEN_PREFIX = "hakiya:celebrated:";
const TOUCHED_PREFIX = "hakiya:celebrate:tasks-touched:";

/**
 * Kept beside localStorage because storage can be unavailable (private mode,
 * an embedded frame). Without it a blocked write would make the guard forget
 * instantly and every effect re-run would start another paid song.
 */
const seenThisSession = new Set<string>();

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function celebrationGuardKey(event: CelebrationEvent): string {
  return `${SEEN_PREFIX}${event.kind}:${event.entityId}`;
}

export function hasCelebrated(event: CelebrationEvent): boolean {
  const key = celebrationGuardKey(event);
  if (seenThisSession.has(key)) return true;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markCelebrated(event: CelebrationEvent): void {
  const key = celebrationGuardKey(event);
  seenThisSession.add(key);
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* the in-memory set still holds it for this session */
  }
}

/**
 * The name to sing: whatever the learner set, tidied. The edge function
 * sanitises it again — this only decides whether there is a name at all.
 */
export function singerName(displayName: string | null | undefined): string | null {
  const name = (displayName ?? "").replace(/\s+/g, " ").trim();
  return name.length > 0 ? name : null;
}

/**
 * "Finished the day's tasks" has no event of its own: it is derived on /today.
 * Opening that page on a day another device already finished would otherwise
 * sing to someone who did nothing here, so a day only counts once a task was
 * actually completed in this browser.
 */
export function noteTasksTouchedToday(now = new Date()): void {
  try {
    localStorage.setItem(`${TOUCHED_PREFIX}${localDateKey(now)}`, "1");
  } catch {
    /* ignore */
  }
}

export function wereTasksTouchedToday(now = new Date()): boolean {
  try {
    return localStorage.getItem(`${TOUCHED_PREFIX}${localDateKey(now)}`) === "1";
  } catch {
    return false;
  }
}
