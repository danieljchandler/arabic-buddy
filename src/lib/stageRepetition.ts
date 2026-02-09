export type Stage = 'NEW' | 'STAGE_1' | 'STAGE_2' | 'STAGE_3' | 'STAGE_4' | 'STAGE_5';
export type ReviewResult = 'correct' | 'incorrect' | 'wrong';

const STAGE_ORDER: Stage[] = ['NEW', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5'];

// Intervals in minutes
const STAGE_INTERVALS: Record<Stage, number> = {
  NEW: 0,        // immediate
  STAGE_1: 10,   // 10 minutes
  STAGE_2: 1440, // 1 day
  STAGE_3: 4320, // 3 days
  STAGE_4: 10080, // 7 days
  STAGE_5: 30240, // 21 days
};

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: 'New',
  STAGE_1: 'Stage 1',
  STAGE_2: 'Stage 2',
  STAGE_3: 'Stage 3',
  STAGE_4: 'Stage 4',
  STAGE_5: 'Stage 5',
};

export const STAGE_COLORS: Record<Stage, string> = {
  NEW: 'hsl(var(--muted-foreground))',
  STAGE_1: 'hsl(7, 52%, 36%)',
  STAGE_2: 'hsl(38, 47%, 55%)',
  STAGE_3: 'hsl(97, 17%, 37%)',
  STAGE_4: 'hsl(160, 57%, 28%)',
  STAGE_5: 'hsl(192, 22%, 23%)',
};

function nextStage(stage: Stage): Stage {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : STAGE_5;
}

function prevStage(stage: Stage): Stage {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx > 1 ? STAGE_ORDER[idx - 1] : STAGE_ORDER[1]; // min STAGE_1
}

const STAGE_5: Stage = 'STAGE_5';

export function calculateStageTransition(
  currentStage: Stage,
  result: ReviewResult
): { newStage: Stage; intervalMinutes: number; nextReviewAt: Date } {
  let newStage: Stage;

  if (result === 'correct') {
    newStage = nextStage(currentStage);
  } else if (result === 'incorrect') {
    newStage = prevStage(currentStage);
  } else {
    // 'wrong' -> reset to NEW
    newStage = 'NEW';
  }

  const intervalMinutes = STAGE_INTERVALS[newStage];
  const nextReviewAt = new Date(Date.now() + intervalMinutes * 60 * 1000);

  return { newStage, intervalMinutes, nextReviewAt };
}

export function getStageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isValidStage(s: string): s is Stage {
  return STAGE_ORDER.includes(s as Stage);
}

export { STAGE_ORDER };
